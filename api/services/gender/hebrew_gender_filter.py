"""Deterministic Hebrew gendered-address text filter for TTS.

Hebrew second-person address differs by gender in two ways, and both trip up a
text-to-speech voice when the LLM gets them wrong or leaves them ambiguous:

- **Spelling** differs for pronouns, verbs and participles (אתה/את, תרצה/תרצי,
  יכול/יכולה). The LLM sometimes keeps the masculine form of a scripted line
  even after the caller is known to be female.
- **Pronunciation only** differs for the pronoun suffix on prepositions (לך is
  "lecha" for a man, "lach" for a woman; also שלך, אותך, איתך...) and for some
  participles (רוצה "rotse"/"rotsa"). Unpointed text gives the voice no way to
  know which, so it guesses — usually masculine, sometimes "lech" (go).

Once the caller's gender is detected this filter rewrites, before synthesis:

- **Female**: masculine forms to feminine (``FEMININE_ADDRESS_MAP``), the pronoun
  אתה to the pointed feminine ``FEMININE_PRONOUN`` (so it isn't read as the
  accusative "et"), ambiguous suffix forms to their pointed feminine reading
  (``FEMININE_SUFFIX_POINTING``), and participles right after the 2nd-person
  subject (``PARTICIPLE_FEMININE_MAP``), e.g. "אתה מעוניין" -> "את מעוניינת".
- **Male**: ambiguous suffix forms to their pointed masculine reading
  (``MASCULINE_SUFFIX_POINTING``) and רוצה after the subject to its pointed
  masculine reading. Spelling is already masculine by default, so nothing
  else changes.

Unknown gender passes through untouched. Text with no Hebrew letters is never
modified, so the filter is safe to install on every TTS service.

Verb entries can collide with third-person feminine future ("היא תרצה"); forms
that commonly take an inanimate feminine subject (תהיה, תשלח) are left out.
"""

import re
from collections.abc import Mapping
from typing import Any, Optional

from loguru import logger

from pipecat.utils.text.base_text_filter import BaseTextFilter

# Hebrew points (niqqud + cantillation), stripped from a token before lookup so
# pointed and unpointed spellings resolve to the same entry.
_NIQQUD_CLASS = "֑-ׇֽֿׁׂׅׄ"
_NIQQUD_RE = re.compile(f"[{_NIQQUD_CLASS}]")
# A Hebrew word: letters (U+05D0-U+05EA) plus points. Maqaf (U+05BE) and
# punctuation split tokens.
_TOKEN_RE = re.compile(f"[א-ת{_NIQQUD_CLASS}]+")
_HAS_HEBREW_RE = re.compile("[א-ת]")

# Clitic prefixes (and / that / when) that attach to a mapped word: "ולך",
# "שתרצה", "כשתרצה". Longest first.
_PREFIXES = ("וכש", "כש", "וש", "ו", "ש")

# Adverbs that may sit between the subject and its participle ("את לא בטוחה").
_SKIPPABLE_ADVERBS = {
    "לא",
    "עדיין",
    "גם",
    "כבר",
    "באמת",
    "ממש",
    "בדיוק",
    "עכשיו",
    "כרגע",
    "בכלל",
    "אולי",
    "יותר",
}
_SUBJECTS = {"אתה", "את"}

# Pronoun-suffixed prepositions, pointed for the feminine reading.
FEMININE_SUFFIX_POINTING: dict[str, str] = {
    "לך": "לָךְ",
    "בך": "בָּךְ",
    "שלך": "שֶׁלָּךְ",
    "אותך": "אוֹתָךְ",
    "איתך": "אִיתָּךְ",
    "ממך": "מִמֵּךְ",
    "בשבילך": "בִּשְׁבִילֵךְ",
    "עליך": "עָלַיִךְ",
    "עלייך": "עָלַיִךְ",
    "אליך": "אֵלַיִךְ",
    "אלייך": "אֵלַיִךְ",
    "אצלך": "אֶצְלֵךְ",
    "עבורך": "עֲבוּרֵךְ",
}

# Same words, pointed for the masculine reading.
MASCULINE_SUFFIX_POINTING: dict[str, str] = {
    "לך": "לְךָ",
    "בך": "בְּךָ",
    "שלך": "שֶׁלְּךָ",
    "אותך": "אוֹתְךָ",
    "איתך": "אִיתְּךָ",
    "ממך": "מִמְּךָ",
    "בשבילך": "בִּשְׁבִילְךָ",
    "עליך": "עָלֶיךָ",
    "אליך": "אֵלֶיךָ",
    "אצלך": "אֶצְלְךָ",
    "עבורך": "עֲבוּרְךָ",
}

# Feminine "you", pointed so it can't be read as the accusative marker "et".
FEMININE_PRONOUN = "אַתְּ"

# Masculine -> feminine 2nd-person forms that differ in spelling.
FEMININE_ADDRESS_MAP: dict[str, str] = {
    "אתה": FEMININE_PRONOUN,
    # Future / polite-request forms (masc -> fem ־י).
    "תרצה": "תרצי",
    "תוכל": "תוכלי",
    "תצטרך": "תצטרכי",
    "תגיד": "תגידי",
    "תספר": "תספרי",
    "תבחר": "תבחרי",
    "תחכה": "תחכי",
    "תמתין": "תמתיני",
    "תאשר": "תאשרי",
    "תדע": "תדעי",
    "תעדיף": "תעדיפי",
    "תקבל": "תקבלי",
    "תשאיר": "תשאירי",
    "תתקשר": "תתקשרי",
    "תמלא": "תמלאי",
    "תרגיש": "תרגישי",
    "תבין": "תביני",
    "תחשוב": "תחשבי",
    "תנסה": "תנסי",
    "תשמע": "תשמעי",
    "תכתוב": "תכתבי",
    "תזכור": "תזכרי",
    # Imperatives.
    "חכה": "חכי",
    "המתן": "המתיני",
    "אמור": "אמרי",
    "תן": "תני",
    "קח": "קחי",
    # Direct address terms.
    "אדוני": "גבירתי",
}

# Participles / adjectives describing the caller. Only rewritten right after the
# 2nd-person subject, so the agent speaking about itself ("אני בטוח") is never
# touched.
PARTICIPLE_FEMININE_MAP: dict[str, str] = {
    "רוצה": "רוֹצָה",
    "מרוצה": "מְרֻצָּה",
    "יכול": "יכולה",
    "צריך": "צריכה",
    "מעוניין": "מעוניינת",
    "מעונין": "מעוניינת",
    "מתעניין": "מתעניינת",
    "בטוח": "בטוחה",
    "מוכן": "מוכנה",
    "פנוי": "פנויה",
    "זמין": "זמינה",
    "יודע": "יודעת",
    "חושב": "חושבת",
    "מכיר": "מכירה",
    "עובד": "עובדת",
    "זוכר": "זוכרת",
    "מסכים": "מסכימה",
    "מבין": "מבינה",
    "שומע": "שומעת",
    "מחפש": "מחפשת",
    "מעדיף": "מעדיפה",
    "גר": "גרה",
    "נמצא": "נמצאת",
    "מרגיש": "מרגישה",
}

PARTICIPLE_MASCULINE_POINTING: dict[str, str] = {
    "רוצה": "רוֹצֶה",
    "מרוצה": "מְרֻצֶּה",
}


def _strip_niqqud(token: str) -> str:
    return _NIQQUD_RE.sub("", token)


# Every participle form (either gender), used to recognize "את" as the pronoun
# (not the accusative marker) when one follows it.
_PARTICIPLE_FORMS = set(PARTICIPLE_FEMININE_MAP) | {
    _strip_niqqud(v) for v in PARTICIPLE_FEMININE_MAP.values()
}


def _split_prefix(bare: str, table: Mapping[str, str]) -> Optional[tuple[str, str]]:
    """Return ``(prefix, stem)`` when ``bare`` is a mapped word with a clitic."""
    for prefix in _PREFIXES:
        if bare.startswith(prefix) and bare[len(prefix) :] in table:
            return prefix, bare[len(prefix) :]
    return None


def _subject_stem(bare: str) -> str:
    """Strip a clitic so "ואתה" counts as the subject "אתה"."""
    for prefix in _PREFIXES:
        if bare.startswith(prefix) and bare[len(prefix) :] in _SUBJECTS:
            return bare[len(prefix) :]
    return bare


class HebrewGenderTextFilter(BaseTextFilter):
    """Make Hebrew 2nd-person address match the detected caller gender.

    Inactive until :meth:`set_gender` receives ``"male"`` or ``"female"``.
    Plug into a ``TTSService`` via its ``text_filters``.
    """

    def __init__(self, gender: Optional[str] = None):
        self._gender = gender

    def set_gender(self, gender: Optional[str]) -> None:
        """Set the caller gender ("male" / "female"; anything else disables)."""
        if gender != self._gender:
            logger.info(f"HebrewGenderTextFilter: caller gender -> {gender}")
        self._gender = gender

    async def update_settings(self, settings: Mapping[str, Any]) -> None:
        """Support runtime updates via ``{"gender": ...}``."""
        if "gender" in settings:
            self.set_gender(settings["gender"])

    async def filter(self, text: str) -> str:
        """Rewrite Hebrew caller address for the detected gender."""
        if self._gender not in ("male", "female") or not text:
            return text
        if not _HAS_HEBREW_RE.search(text):
            return text

        matches = list(_TOKEN_RE.finditer(text))
        bares = [_strip_niqqud(m.group(0)) for m in matches]
        out: list[str] = []
        last = 0
        for i, match in enumerate(matches):
            out.append(text[last : match.start()])
            out.append(self._rewrite(match.group(0), i, bares))
            last = match.end()
        out.append(text[last:])
        return "".join(out)

    def _rewrite(self, token: str, i: int, bares: list[str]) -> str:
        bare = bares[i]
        after_subject = self._follows_subject(i, bares)

        if self._gender == "female":
            if after_subject and bare in PARTICIPLE_FEMININE_MAP:
                return PARTICIPLE_FEMININE_MAP[bare]
            if bare == "את" and self._precedes_participle(i, bares):
                return FEMININE_PRONOUN
            for table in (FEMININE_ADDRESS_MAP, FEMININE_SUFFIX_POINTING):
                if bare in table:
                    return table[bare]
                split = _split_prefix(bare, table)
                if split:
                    return split[0] + table[split[1]]
            return token

        # Male: only disambiguate pronunciation; spelling is already masculine.
        if after_subject and bare in PARTICIPLE_MASCULINE_POINTING:
            return PARTICIPLE_MASCULINE_POINTING[bare]
        if bare in MASCULINE_SUFFIX_POINTING:
            return MASCULINE_SUFFIX_POINTING[bare]
        split = _split_prefix(bare, MASCULINE_SUFFIX_POINTING)
        if split:
            return split[0] + MASCULINE_SUFFIX_POINTING[split[1]]
        return token

    @staticmethod
    def _follows_subject(i: int, bares: list[str]) -> bool:
        j = i - 1
        while j >= 0 and bares[j] in _SKIPPABLE_ADVERBS:
            j -= 1
        return j >= 0 and _subject_stem(bares[j]) in _SUBJECTS

    @staticmethod
    def _precedes_participle(i: int, bares: list[str]) -> bool:
        j = i + 1
        while j < len(bares) and bares[j] in _SKIPPABLE_ADVERBS:
            j += 1
        return j < len(bares) and bares[j] in _PARTICIPLE_FORMS

    async def handle_interruption(self) -> None:
        """No buffered state to reset on interruption."""
        pass
