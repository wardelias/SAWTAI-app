"""Tests for the deterministic Hebrew gendered-address TTS text filter."""

import asyncio

from api.services.gender.hebrew_gender_filter import (
    FEMININE_PRONOUN,
    FEMININE_SUFFIX_POINTING,
    MASCULINE_SUFFIX_POINTING,
    PARTICIPLE_FEMININE_MAP,
    PARTICIPLE_MASCULINE_POINTING,
    HebrewGenderTextFilter,
    _strip_niqqud,
)


def _filter(text: str, gender) -> str:
    f = HebrewGenderTextFilter(gender=gender)
    return asyncio.run(f.filter(text))


class TestPointingTables:
    def test_pointed_forms_spell_the_same_word(self):
        # Pointing must only add niqqud, never change the letters (except the
        # feminine עלייך/אלייך spelling variants, which map to one form).
        for table in (FEMININE_SUFFIX_POINTING, MASCULINE_SUFFIX_POINTING):
            for bare, pointed in table.items():
                assert _strip_niqqud(pointed) in (bare, bare.replace("יי", "י"))
        assert _strip_niqqud(FEMININE_PRONOUN) == "את"
        assert _strip_niqqud(PARTICIPLE_FEMININE_MAP["רוצה"]) == "רוצה"
        assert _strip_niqqud(PARTICIPLE_MASCULINE_POINTING["רוצה"]) == "רוצה"

    def test_feminine_and_masculine_pointing_differ(self):
        for bare in MASCULINE_SUFFIX_POINTING:
            assert FEMININE_SUFFIX_POINTING[bare] != MASCULINE_SUFFIX_POINTING[bare]


class TestFemale:
    def test_pronoun_and_participle(self):
        assert (
            _filter("האם אתה מעוניין בהצעה?", "female")
            == f"האם {FEMININE_PRONOUN} מעוניינת בהצעה?"
        )

    def test_participle_after_adverb(self):
        assert _filter("את לא בטוח?", "female") == f"{FEMININE_PRONOUN} לא בטוחה?"

    def test_future_verbs(self):
        assert _filter("מתי תרצה?", "female") == "מתי תרצי?"
        assert _filter("כשתרצה", "female") == "כשתרצי"

    def test_suffix_pointing(self):
        assert (
            _filter("לעזור לך", "female") == "לעזור " + FEMININE_SUFFIX_POINTING["לך"]
        )
        assert _filter("ולך", "female") == "ו" + FEMININE_SUFFIX_POINTING["לך"]

    def test_agent_self_reference_untouched(self):
        assert _filter("אני יכול לעזור", "female") == "אני יכול לעזור"
        assert _filter("אני רוצה לשלוח", "female") == "אני רוצה לשלוח"

    def test_accusative_et_untouched(self):
        assert _filter("לשלוח את המסמך", "female") == "לשלוח את המסמך"

    def test_idempotent(self):
        once = _filter("אתה רוצה לך", "female")
        assert _filter(once, "female") == once


class TestMale:
    def test_suffix_pointing(self):
        assert _filter("שלך", "male") == MASCULINE_SUFFIX_POINTING["שלך"]

    def test_spelling_unchanged(self):
        assert _filter("האם אתה מעוניין?", "male") == "האם אתה מעוניין?"
        assert _filter("מתי תרצה?", "male") == "מתי תרצה?"

    def test_participle_pointing_after_subject(self):
        assert (
            _filter("אתה רוצה", "male")
            == "אתה " + PARTICIPLE_MASCULINE_POINTING["רוצה"]
        )
        assert _filter("אני רוצה", "male") == "אני רוצה"


class TestPassthrough:
    def test_unknown_gender(self):
        assert _filter("אתה רוצה לך", None) == "אתה רוצה לך"
        assert _filter("אתה רוצה לך", "unknown") == "אתה רוצה לך"

    def test_non_hebrew_text(self):
        assert _filter("thank you", "female") == "thank you"
        assert _filter("شكراً لك", "female") == "شكراً لك"

    def test_set_gender_toggles(self):
        f = HebrewGenderTextFilter()
        assert asyncio.run(f.filter("לך")) == "לך"
        asyncio.run(f.update_settings({"gender": "female"}))
        assert asyncio.run(f.filter("לך")) == FEMININE_SUFFIX_POINTING["לך"]
        f.set_gender(None)
        assert asyncio.run(f.filter("לך")) == "לך"
