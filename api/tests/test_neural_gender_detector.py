"""Tests for the neural (ECAPA) voice gender classifier backend.

The streaming/buffering and GenderEstimate-mapping logic is tested with a fake
model patched into ``_load_model`` so CI does not download weights. An opt-in test
(``RUN_ECAPA_MODEL_TEST=1``) exercises the real model end to end.

All tests require torch; they skip cleanly where it isn't installed (e.g. the
default dev box that only runs the F0 backend).
"""

import os

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from api.services.gender import neural_gender_detector as ngd  # noqa: E402
from api.services.gender.neural_gender_detector import (  # noqa: E402
    ECAPAGenderClassifier,
)


def synth_voice(f0: float, seconds: float, sample_rate: int, amp: float = 8000.0) -> bytes:
    """Harmonic-rich periodic signal resembling voiced speech (int16 PCM)."""
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    sig = np.zeros_like(t)
    for h in range(1, 9):
        sig += (amp / h) * np.sin(2 * np.pi * f0 * h * t)
    return np.clip(sig, -32000, 32000).astype(np.int16).tobytes()


def silence(seconds: float, sample_rate: int) -> bytes:
    return np.zeros(int(seconds * sample_rate), dtype=np.int16).tobytes()


class _FakeModel:
    """Stand-in for ECAPA_gender: fixed logits, real pred2gender mapping."""

    pred2gender = {0: "male", 1: "female"}

    def __init__(self, logits):
        self._logits = logits

    def forward(self, tensor):  # noqa: ANN001
        return torch.tensor([self._logits], dtype=torch.float32)


@pytest.fixture
def patch_model(monkeypatch):
    """Patch the process-wide loader to return a fake model + CPU device."""

    def _install(logits):
        monkeypatch.setattr(
            ngd, "_load_model", lambda: (_FakeModel(logits), torch.device("cpu"))
        )

    return _install


class TestECAPAGenderClassifierStreaming:
    def test_classifies_male_from_logits(self, patch_model):
        patch_model([4.0, -4.0])  # strongly class 0 = male
        clf = ECAPAGenderClassifier()
        result = clf.add_audio(synth_voice(110.0, 3.5, 16000), 16000)
        assert result is not None
        assert result.gender == "male"
        assert 0.0 <= result.confidence <= 1.0
        assert result.confidence > 0.9
        assert result.median_f0_hz == 0.0  # not applicable to this backend
        assert result.voiced_seconds >= ngd.MIN_VOICED_SECONDS

    def test_classifies_female_from_logits(self, patch_model):
        patch_model([-4.0, 4.0])  # strongly class 1 = female
        clf = ECAPAGenderClassifier()
        result = clf.add_audio(synth_voice(220.0, 3.5, 16000), 16000)
        assert result is not None
        assert result.gender == "female"
        assert result.confidence > 0.9

    def test_low_confidence_near_decision_boundary(self, patch_model):
        # Near-equal logits → softmax ~0.5, which the engine's NOTE_MIN_CONFIDENCE
        # gate treats as "stay neutral".
        patch_model([0.05, 0.0])
        clf = ECAPAGenderClassifier()
        result = clf.add_audio(synth_voice(165.0, 3.5, 16000), 16000)
        assert result is not None
        assert result.confidence < 0.7

    def test_waits_for_enough_voiced_audio(self, patch_model):
        patch_model([4.0, -4.0])
        clf = ECAPAGenderClassifier()
        # 1 s of voiced speech is below the 3 s buffer target → no decision yet.
        assert clf.add_audio(synth_voice(110.0, 1.0, 16000), 16000) is None
        assert clf.result is None

    def test_silence_gives_unknown_after_timeout(self, patch_model):
        patch_model([4.0, -4.0])
        clf = ECAPAGenderClassifier()
        result = clf.add_audio(silence(ngd.MAX_TOTAL_SECONDS + 1.0, 16000), 16000)
        assert result is not None
        assert result.gender == "unknown"
        assert result.confidence == 0.0

    def test_result_is_one_shot(self, patch_model):
        patch_model([4.0, -4.0])
        clf = ECAPAGenderClassifier()
        first = clf.add_audio(synth_voice(110.0, 3.5, 16000), 16000)
        assert first is not None
        again = clf.add_audio(synth_voice(110.0, 3.5, 16000), 16000)
        assert again is None
        assert clf.result is first

    def test_chunked_feed_reaches_decision(self, patch_model):
        patch_model([-4.0, 4.0])
        sr = 16000
        pcm = synth_voice(220.0, 4.0, sr)
        chunk_bytes = int(0.02 * sr) * 2  # 20 ms of int16
        clf = ECAPAGenderClassifier()
        result = None
        for i in range(0, len(pcm), chunk_bytes):
            result = clf.add_audio(pcm[i : i + chunk_bytes], sr)
            if result:
                break
        assert result is not None
        assert result.gender == "female"

    def test_inference_failure_yields_unknown(self, monkeypatch):
        # A model that raises during forward must not crash the detector.
        class _Boom:
            pred2gender = {0: "male", 1: "female"}

            def forward(self, tensor):  # noqa: ANN001
                raise RuntimeError("boom")

        monkeypatch.setattr(
            ngd, "_load_model", lambda: (_Boom(), torch.device("cpu"))
        )
        clf = ECAPAGenderClassifier()
        result = clf.add_audio(synth_voice(110.0, 3.5, 16000), 16000)
        assert result is not None
        assert result.gender == "unknown"
        assert result.confidence == 0.0


@pytest.mark.skipif(
    os.getenv("RUN_ECAPA_MODEL_TEST") != "1",
    reason="set RUN_ECAPA_MODEL_TEST=1 to download and run the real ECAPA model",
)
class TestRealModel:
    def test_real_model_returns_valid_estimate(self):
        clf = ECAPAGenderClassifier()
        result = clf.add_audio(synth_voice(120.0, 3.5, 16000), 16000)
        assert result is not None
        assert result.gender in ("male", "female", "unknown")
        assert 0.0 <= result.confidence <= 1.0
