"""Tests for voice-based gender detection (F0 classifier + prompt composition)."""

from types import SimpleNamespace

import numpy as np
import pytest

from api.services.gender.voice_gender_detector import (
    AMBIGUOUS_MAX_VOICED_WINDOWS,
    NOTE_MIN_CONFIDENCE,
    F0GenderClassifier,
    GenderEstimate,
    estimate_window_f0,
)
from api.services.workflow.pipecat_engine_context_composer import (
    build_caller_profile_note,
    compose_system_prompt_for_node,
)

# ---------------------------------------------------------------------------
# Signal synthesis helpers
# ---------------------------------------------------------------------------


def synth_voice(
    f0: float,
    seconds: float,
    sample_rate: int,
    harmonics: int = 8,
    amp: float = 8000.0,
    include_fundamental: bool = True,
) -> bytes:
    """Synthesize a harmonic-rich periodic signal resembling voiced speech."""
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    sig = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        if h == 1 and not include_fundamental:
            continue
        sig += (amp / h) * np.sin(2 * np.pi * f0 * h * t)
    sig = np.clip(sig, -32000, 32000)
    return sig.astype(np.int16).tobytes()


def silence(seconds: float, sample_rate: int) -> bytes:
    return np.zeros(int(seconds * sample_rate), dtype=np.int16).tobytes()


def white_noise(seconds: float, sample_rate: int, amp: float = 5000.0) -> bytes:
    rng = np.random.default_rng(42)
    sig = rng.normal(0, amp, int(seconds * sample_rate))
    return np.clip(sig, -32000, 32000).astype(np.int16).tobytes()


# ---------------------------------------------------------------------------
# estimate_window_f0
# ---------------------------------------------------------------------------


class TestEstimateWindowF0:
    def test_detects_known_f0(self):
        sr = 16000
        pcm = synth_voice(120.0, 0.05, sr)
        window = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
        f0 = estimate_window_f0(window, sr)
        assert f0 is not None
        assert abs(f0 - 120.0) < 6.0

    def test_silence_is_unvoiced(self):
        sr = 8000
        window = np.zeros(400, dtype=np.float64)
        assert estimate_window_f0(window, sr) is None

    def test_noise_is_unvoiced(self):
        sr = 8000
        pcm = white_noise(0.05, sr)
        window = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
        assert estimate_window_f0(window, sr) is None


# ---------------------------------------------------------------------------
# F0GenderClassifier
# ---------------------------------------------------------------------------


class TestF0GenderClassifier:
    def test_male_voice_detected(self):
        clf = F0GenderClassifier()
        result = clf.add_audio(synth_voice(110.0, 3.0, 8000), 8000)
        assert result is not None
        assert result.gender == "male"
        assert result.confidence >= NOTE_MIN_CONFIDENCE
        assert abs(result.median_f0_hz - 110.0) < 8.0

    def test_female_voice_detected(self):
        clf = F0GenderClassifier()
        result = clf.add_audio(synth_voice(220.0, 3.0, 16000), 16000)
        assert result is not None
        assert result.gender == "female"
        assert result.confidence >= NOTE_MIN_CONFIDENCE
        assert abs(result.median_f0_hz - 220.0) < 10.0

    def test_telephony_missing_fundamental(self):
        # Telephony band-pass cuts below ~300 Hz: the fundamental itself may
        # be gone, but autocorrelation recovers the period from harmonics.
        clf = F0GenderClassifier()
        pcm = synth_voice(120.0, 3.0, 8000, include_fundamental=False)
        result = clf.add_audio(pcm, 8000)
        assert result is not None
        assert result.gender == "male"
        assert abs(result.median_f0_hz - 120.0) < 8.0

    def test_silence_gives_no_result(self):
        clf = F0GenderClassifier()
        assert clf.add_audio(silence(5.0, 8000), 8000) is None
        assert clf.result is None

    def test_noise_gives_no_result(self):
        clf = F0GenderClassifier()
        assert clf.add_audio(white_noise(5.0, 8000), 8000) is None
        assert clf.result is None

    def test_ambiguous_band_low_confidence(self):
        # 165 Hz sits in the male/female overlap: the classifier should hold
        # out for more audio and then return a low-confidence estimate that
        # stays below the prompt-note threshold (neutral address preserved).
        clf = F0GenderClassifier()
        seconds_needed = (AMBIGUOUS_MAX_VOICED_WINDOWS + 10) * 0.05
        result = clf.add_audio(synth_voice(165.0, seconds_needed, 8000), 8000)
        assert result is not None
        assert result.gender in ("male", "female")
        assert result.confidence < NOTE_MIN_CONFIDENCE

    def test_result_is_one_shot(self):
        clf = F0GenderClassifier()
        first = clf.add_audio(synth_voice(110.0, 3.0, 8000), 8000)
        assert first is not None
        again = clf.add_audio(synth_voice(110.0, 1.0, 8000), 8000)
        assert again is None
        assert clf.result is first

    def test_chunked_feed_matches_bulk(self):
        # Real pipelines deliver ~20 ms frames; chunked feeding must reach
        # the same conclusion as one big buffer.
        sr = 8000
        pcm = synth_voice(210.0, 3.0, sr)
        chunk_bytes = int(0.02 * sr) * 2  # 20 ms of int16
        clf = F0GenderClassifier()
        result = None
        for i in range(0, len(pcm), chunk_bytes):
            result = clf.add_audio(pcm[i : i + chunk_bytes], sr)
            if result:
                break
        assert result is not None
        assert result.gender == "female"

    def test_stereo_downmix(self):
        sr = 16000
        mono = np.frombuffer(synth_voice(110.0, 3.0, sr), dtype=np.int16)
        stereo = np.repeat(mono, 2).tobytes()
        clf = F0GenderClassifier()
        result = clf.add_audio(stereo, sr, num_channels=2)
        assert result is not None
        assert result.gender == "male"


# ---------------------------------------------------------------------------
# Prompt composition with caller profile note
# ---------------------------------------------------------------------------


def _make_node_and_workflow():
    node = SimpleNamespace(prompt="You are a helpful agent.", add_global_prompt=False)
    workflow = SimpleNamespace(global_node_id=None, nodes={})
    return node, workflow


class TestCallerProfileNoteComposition:
    def test_note_appended_when_present(self):
        node, workflow = _make_node_and_workflow()
        note = build_caller_profile_note("female")
        prompt = compose_system_prompt_for_node(
            node=node,
            workflow=workflow,
            format_prompt=lambda s: s,
            has_recordings=False,
            caller_profile_note=note,
        )
        assert "You are a helpful agent." in prompt
        assert "most likely female" in prompt
        assert "Arabic or Hebrew" in prompt

    def test_female_note_includes_pronunciation_guidance(self):
        # Female callers get the tashkeel/feminine-form guidance so Arabic TTS
        # doesn't fall back to masculine pronunciation (e.g. أساعدك -> أساعِدُكِ).
        note = build_caller_profile_note("female")
        assert "tashkeel" in note
        assert "ـكِ" in note  # feminine kaf with kasra
        assert "أساعِدُكِ" in note

    def test_male_note_has_no_pronunciation_guidance(self):
        note = build_caller_profile_note("male")
        assert "most likely male" in note
        assert "tashkeel" not in note

    def test_no_note_by_default(self):
        node, workflow = _make_node_and_workflow()
        prompt = compose_system_prompt_for_node(
            node=node,
            workflow=workflow,
            format_prompt=lambda s: s,
            has_recordings=False,
        )
        assert "CALLER PROFILE" not in prompt
