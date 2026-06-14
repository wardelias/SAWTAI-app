"""Tests for the deterministic Arabic feminine-address TTS text filter."""

import asyncio

from api.services.gender.arabic_gender_filter import ArabicFeminineTextFilter


def _filter(text: str, gender) -> str:
    f = ArabicFeminineTextFilter(gender=gender)
    return asyncio.run(f.filter(text))


class TestFemaleRewriting:
    def test_rewrites_suffix_address(self):
        assert _filter("شكراً لك", "female") == "شكراً لكِ"
        assert _filter("كيف حالك", "female") == "كيف حالكِ"
        assert _filter("ما اسمك؟", "female") == "ما اسمكِ؟"

    def test_rewrites_pronoun_and_verb(self):
        assert _filter("أنت", "female") == "أنتِ"
        assert _filter("هل تريد المساعدة", "female") == "هل تريدين المساعدة"

    def test_punctuation_adjacent_token(self):
        # Arabic question mark must not get glued onto the token.
        assert _filter("معك،", "female") == "معكِ،"

    def test_idempotent_on_already_feminine(self):
        assert _filter("لكِ", "female") == "لكِ"

    def test_strips_explicit_masculine_fatha(self):
        # "لكَ" (explicit masculine) -> feminine "لكِ".
        assert _filter("لكَ", "female") == "لكِ"


class TestGeneralKafSuffix:
    def test_rewrites_arbitrary_stem_suffix(self):
        # Productive 2nd-person ـك suffix on arbitrary stems.
        assert _filter("بمشروعك", "female") == "بمشروعكِ"
        assert _filter("لتفهمك", "female") == "لتفهمكِ"
        assert _filter("طلبك جاهز", "female") == "طلبكِ جاهز"
        assert _filter("مساعدتك", "female") == "مساعدتكِ"

    def test_possessive_after_root_kaf(self):
        # "your subscription" — suffix ـك after the root kaf.
        assert _filter("اشتراكك", "female") == "اشتراككِ"

    def test_idempotent(self):
        assert _filter("مشروعكِ", "female") == "مشروعكِ"

    def test_root_kaf_words_blocklisted(self):
        for w in ("ملوك", "شريك", "اشتراك", "استهلاك", "بنوك"):
            assert _filter(w, "female") == w


class TestNoFalsePositives:
    def test_unrelated_kaf_words_untouched(self):
        # Words that merely end in kaf are NOT address suffixes.
        for w in ("ملك", "سمك", "بنك", "شك"):
            assert _filter(w, "female") == w

    def test_plural_address_untouched(self):
        assert _filter("معكم", "female") == "معكم"
        assert _filter("أنتم", "female") == "أنتم"


class TestPassthrough:
    def test_male_passthrough(self):
        assert _filter("شكراً لك", "male") == "شكراً لك"

    def test_unknown_passthrough(self):
        assert _filter("شكراً لك", "unknown") == "شكراً لك"
        assert _filter("شكراً لك", None) == "شكراً لك"

    def test_english_passthrough(self):
        assert _filter("thank you", "female") == "thank you"


class TestRuntimeUpdate:
    def test_set_gender_toggles(self):
        f = ArabicFeminineTextFilter()
        assert asyncio.run(f.filter("لك")) == "لك"
        asyncio.run(f.update_settings({"gender": "female"}))
        assert asyncio.run(f.filter("لك")) == "لكِ"
        f.set_gender("male")
        assert asyncio.run(f.filter("لك")) == "لك"
