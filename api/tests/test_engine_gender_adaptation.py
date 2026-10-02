"""Tests for PipecatEngine's handling of voice gender detection results."""

import asyncio
from types import SimpleNamespace

from api.services.gender.arabic_gender_filter import ArabicFeminineTextFilter
from api.services.gender.hebrew_gender_filter import HebrewGenderTextFilter
from api.services.gender.voice_gender_detector import GenderEstimate
from api.services.workflow.pipecat_engine import PipecatEngine


def _engine(language=None):
    """Minimal stand-in carrying only the state the gender methods touch."""
    engine = SimpleNamespace(
        _call_context_vars={"caller_gender": "unknown"},
        _caller_profile_note=None,
        _language=language,
        _gender_text_filters=[ArabicFeminineTextFilter(), HebrewGenderTextFilter()],
        _current_node=None,
    )
    return engine


def _detect(engine, gender, confidence):
    estimate = GenderEstimate(gender, confidence, 0.0, 3.0)
    asyncio.run(PipecatEngine.handle_caller_gender_detected(engine, estimate))


def _filter_all(engine, text):
    for f in engine._gender_text_filters:
        text = asyncio.run(f.filter(text))
    return text


class TestPendingNote:
    def test_enable_sets_pending_note(self):
        engine = _engine("arabic")
        PipecatEngine.enable_gender_adaptation(engine)
        assert "NOT YET KNOWN" in engine._caller_profile_note

    def test_english_agent_gets_no_note(self):
        engine = _engine("English")
        PipecatEngine.enable_gender_adaptation(engine)
        assert engine._caller_profile_note is None


class TestDetectionHandling:
    def test_confident_female_applies_note_filters_and_var(self):
        engine = _engine("arabic")
        PipecatEngine.enable_gender_adaptation(engine)
        _detect(engine, "female", 0.95)
        assert engine._call_context_vars["caller_gender"] == "female"
        assert "GENDER: FEMALE" in engine._caller_profile_note
        assert _filter_all(engine, "شكراً لك") == "شكراً لكِ"

    def test_confident_male_activates_hebrew_pointing(self):
        engine = _engine("hebrew")
        _detect(engine, "male", 0.9)
        assert engine._call_context_vars["caller_gender"] == "male"
        assert _filter_all(engine, "לך") != "לך"

    def test_low_confidence_keeps_neutral(self):
        engine = _engine("arabic")
        PipecatEngine.enable_gender_adaptation(engine)
        _detect(engine, "female", 0.75)  # above note bar, below feminine bar
        assert engine._call_context_vars["caller_gender"] == "unknown"
        assert engine._call_context_vars["caller_gender_detected"] == "female"
        assert "NOT YET KNOWN" in engine._caller_profile_note
        assert _filter_all(engine, "شكراً لك") == "شكراً لك"
