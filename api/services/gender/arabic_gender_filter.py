"""Deterministic Arabic feminine-address text filter for TTS.

Undiacritized Arabic spells masculine and feminine second-person address
identically (e.g. ``أساعدك``), so a default TTS voice pronounces them as
masculine. When the caller is detected as **female**, this filter rewrites
common masculine second-person address tokens to their explicit feminine
(diacritized) forms *before* synthesis — so correct pronunciation does not
depend on the LLM remembering to add tashkeel.

Two transforms, applied only for female callers:

- **Explicit map** (``FEMININE_ADDRESS_MAP``) for forms that are not just a
  ـك suffix — verbs (تريد → تريدين), pronouns (أنت → أنتِ), and common words.
- **General ـك suffix rule**: add a kasra to any word-final second-person kaf
  (مشروعك → مشروعكِ، لتفهمك → لتفهمكِ), so arbitrary stems are covered.
  Guarded by a minimum length and a ``ROOT_KAF_EXCEPTIONS`` blocklist so words
  whose final kaf is a root letter (ملك، بنك، شريك، اشتراك) are never touched.

Other safeguards:

- **Female only.** Male/unknown callers pass through unchanged — masculine is
  already the TTS default, so there is nothing to fix.
- **Idempotent.** Already-feminine text maps to itself.

The exception list is conversational and non-exhaustive; if a root-kaf word is
wrongly feminized, add it to ``ROOT_KAF_EXCEPTIONS``.

The map is intentionally small and editable; extend it with dialect forms as
needed. Verb entries (e.g. ``تريد`` → ``تريدين``) are higher-coverage but can
collide with third-person feminine ("she wants"); drop them if that matters.
"""

import re
from collections.abc import Mapping
from typing import Any, Optional

from loguru import logger

from pipecat.utils.text.base_text_filter import BaseTextFilter

# Arabic combining diacritics (tashkeel). Stripped from a token before lookup
# so "لكَ" and "لك" both resolve to the feminine "لكِ".
_TASHKEEL = "ًٌٍَُِّْٰ"
_TASHKEEL_RE = re.compile(f"[{_TASHKEEL}]")

# A "word" for our purposes: a run of Arabic letters + tashkeel (U+0621–U+0652
# plus superscript alef U+0670). This range starts at 0621, so Arabic
# punctuation below it (،=060C ؛=061B ؟=061F) is naturally excluded and never
# glued onto a token.
_TOKEN_RE = re.compile(r"[ء-ْٰ]+")

# Quick "does this contain Arabic letters at all" check.
_HAS_ARABIC_RE = re.compile(r"[ء-ي]")

# Masculine (bare) -> feminine (diacritized) second-person address forms.
FEMININE_ADDRESS_MAP: dict[str, str] = {
    # Prepositional / pronoun suffixes — unambiguously 2nd person.
    "لك": "لكِ",
    "بك": "بكِ",
    "معك": "معكِ",
    "عليك": "عليكِ",
    "إليك": "إليكِ",
    "اليك": "إليكِ",
    "منك": "منكِ",
    "عنك": "عنكِ",
    "فيك": "فيكِ",
    "عندك": "عندكِ",
    "لديك": "لديكِ",
    "إنك": "إنكِ",
    "انك": "إنكِ",
    "أنت": "أنتِ",
    "انت": "أنتِ",
    # Common noun + 2nd-person possessive (address context).
    "اسمك": "اسمكِ",
    "حالك": "حالكِ",
    "رقمك": "رقمكِ",
    "بريدك": "بريدكِ",
    "طلبك": "طلبكِ",
    "حسابك": "حسابكِ",
    # Common 2nd-person present verbs (masc -> fem ـين). May collide with
    # third-person feminine; remove if that becomes a problem.
    "تريد": "تريدين",
    "تستطيع": "تستطيعين",
    "تحتاج": "تحتاجين",
    "تعرف": "تعرفين",
    "تود": "تودين",
    # Common imperative.
    "تفضل": "تفضلي",
}


# The second-person ـك suffix attaches to arbitrary stems (مشروعك، طلبك،
# لتفهمك), so beyond the explicit map above we also add a kasra to any
# word-final kaf — EXCEPT where that kaf is a root letter, not a suffix.
_KAF = "ك"
MIN_KAF_SUFFIX_LEN = 4  # below this, a final kaf is almost always a root letter

# Words whose final kaf is part of the root (NOT a 2nd-person suffix) and must
# never be feminized. Conversational, non-exhaustive — extend as needed. Note
# that the *possessed* forms (e.g. اشتراكك "your subscription") end in ـكك and
# are correctly feminized; only the bare standalone words are listed here.
ROOT_KAF_EXCEPTIONS: set[str] = {
    "ملك", "ملوك", "ملاك", "أملاك", "مملوك", "مالك",
    "سمك", "بنك", "بنوك", "شك", "شكوك",
    "فلك", "سلك", "أسلاك", "سلوك",
    "شريك", "ديك", "ديوك", "شباك", "سواك", "مسك", "شوك",
    "معارك", "جمارك", "مبارك", "محرك", "مدارك",
    "إدراك", "اشتراك", "استهلاك", "احتكاك", "ارتباك", "انهماك", "إمساك",
    # Ownership verbs (root ملك) — final kaf is a root letter, not a suffix.
    "تملك", "أملك", "املك", "يملك", "نملك", "تمتلك", "يمتلك", "نمتلك", "امتلك",
}


def _strip_tashkeel(token: str) -> str:
    return _TASHKEEL_RE.sub("", token)


def _feminize_kaf_suffix(token: str, bare: str, exceptions: set[str]) -> str:
    """Add a kasra to a word-final 2nd-person ـك suffix; else return unchanged."""
    if len(bare) < MIN_KAF_SUFFIX_LEN or not bare.endswith(_KAF):
        return token
    if bare in exceptions:
        return token
    # Drop any trailing diacritic on the final kaf (masculine fatha or an
    # existing kasra) and re-add the kasra — idempotent and correct.
    stripped = token.rstrip(_TASHKEEL)
    if stripped.endswith(_KAF):
        return stripped + "ِ"
    return token


class ArabicFeminineTextFilter(BaseTextFilter):
    """Rewrite masculine 2nd-person Arabic address to feminine for female callers.

    Active only while the configured gender is ``"female"``; otherwise text is
    returned unchanged. Plug into a ``TTSService`` via its ``text_filters`` and
    flip it on with :meth:`set_gender` once voice gender detection is confident.
    """

    def __init__(
        self,
        gender: Optional[str] = None,
        extra_map: Optional[Mapping[str, str]] = None,
    ):
        """Initialize the filter.

        Args:
            gender: Initial caller gender ("female" activates rewriting).
            extra_map: Optional additional masculine->feminine entries (e.g.
                dialect forms) merged over the defaults.
        """
        self._gender = gender
        merged = dict(FEMININE_ADDRESS_MAP)
        if extra_map:
            merged.update(extra_map)
        # Look up on the bare (tashkeel-stripped) masculine form.
        self._bare_map = {_strip_tashkeel(k): v for k, v in merged.items()}
        self._kaf_exceptions = set(ROOT_KAF_EXCEPTIONS)

    def set_gender(self, gender: Optional[str]) -> None:
        """Set the caller gender; only ``"female"`` enables rewriting."""
        if gender != self._gender:
            logger.info(f"ArabicFeminineTextFilter: caller gender -> {gender}")
        self._gender = gender

    async def update_settings(self, settings: Mapping[str, Any]) -> None:
        """Support runtime updates via ``{"gender": ...}``."""
        if "gender" in settings:
            self.set_gender(settings["gender"])

    async def filter(self, text: str) -> str:
        """Apply feminine address rewriting when the caller is female."""
        if self._gender != "female" or not text or not _HAS_ARABIC_RE.search(text):
            return text

        def _replace(match: re.Match) -> str:
            token = match.group(0)
            bare = _strip_tashkeel(token)
            # Explicit map (verbs, pronouns, common forms) takes precedence,
            # then the general word-final ـك suffix rule.
            if bare in self._bare_map:
                return self._bare_map[bare]
            return _feminize_kaf_suffix(token, bare, self._kaf_exceptions)

        return _TOKEN_RE.sub(_replace, text)

    async def handle_interruption(self) -> None:
        """No buffered state to reset on interruption."""
        pass
