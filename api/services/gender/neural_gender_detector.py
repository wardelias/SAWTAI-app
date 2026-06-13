"""Neural (ECAPA-TDNN) voice gender classifier backend.

Drop-in alternative to the pitch-based :class:`F0GenderClassifier`. It wraps the
``JaesungHuh/voice-gender-classifier`` model (ECAPA-TDNN finetuned on VoxCeleb2)
and exposes the *same* streaming interface — ``add_audio(pcm, sample_rate,
num_channels) -> Optional[GenderEstimate]`` plus a ``result`` property — so the
``VoiceGenderDetector`` frame processor and everything downstream (engine
callback, ``{{caller_gender}}`` var, prompt note injection) work unchanged.

How it differs from F0:

- F0 decides incrementally from running pitch statistics. The neural model needs
  a buffered chunk, so we accumulate *voiced* audio (RMS-gated 50 ms windows) until
  we have ~3 s, then run a single forward pass, softmax the two logits, and report
  the argmax class with the max-probability as confidence. One-shot, like F0.
- ``median_f0_hz`` is 0.0 here (not applicable to this backend).
- The model loads lazily, process-wide, on the first decision (not at import), so
  importing this module never pulls torch weights. A load/inference failure yields
  an ``unknown`` result so the detector disables cleanly and never breaks a call.

Confidence flows through the same ``NOTE_MIN_CONFIDENCE`` gate in the engine, so an
uncertain (near-0.5 softmax) classification still keeps the agent on neutral address.
"""

import os
import threading
from typing import TYPE_CHECKING, Optional

import numpy as np
from loguru import logger

from api.services.gender.voice_gender_detector import (
    MAX_TOTAL_SECONDS,
    MIN_RMS,
    WINDOW_SECONDS,
    GenderEstimate,
)

if TYPE_CHECKING:  # avoid importing torch at module load
    import torch

HF_MODEL_ID = "JaesungHuh/voice-gender-classifier"
MODEL_SAMPLE_RATE = 16000

MIN_VOICED_SECONDS = 3.0  # voiced speech to buffer before a forward pass
# F0's two-class label order matches the model head: {0: male, 1: female}.

# Process-wide singleton: one model instance shared across all calls/connections.
_model = None
_model_lock = threading.Lock()
_model_failed = False


def _load_model():
    """Lazily load the ECAPA model once per process. Returns (model, device)."""
    global _model, _model_failed
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        if _model_failed:
            raise RuntimeError("ECAPA gender model previously failed to load")
        import torch  # local import: torch only loads if the backend is selected

        from api.services.gender.ecapa_model import ECAPA_gender

        device = torch.device(os.getenv("VOICE_GENDER_DEVICE", "cpu"))
        # Cap CPU threads for a single small forward pass: more threads add
        # scheduling overhead and oversubscribe a multi-worker deploy.
        if device.type == "cpu":
            try:
                torch.set_num_threads(int(os.getenv("VOICE_GENDER_TORCH_THREADS", "2")))
            except Exception:
                pass
        logger.info(f"Loading ECAPA gender model '{HF_MODEL_ID}' on {device}...")
        try:
            model = ECAPA_gender.from_pretrained(HF_MODEL_ID)
            model.eval()
            model.to(device)
        except Exception:
            _model_failed = True
            raise
        _model = (model, device)
        logger.info("ECAPA gender model loaded")
        return _model


def preload_model() -> bool:
    """Eagerly load the model (e.g. at call setup) so the first decision is fast.

    Safe to call from a worker thread. Swallows failures — the live path keeps its
    own try/except and degrades to an ``unknown`` result if the model never loads.
    Returns True on success.
    """
    try:
        _load_model()
        return True
    except Exception as e:
        logger.warning(f"ECAPA gender model preload failed (will retry lazily): {e}")
        return False


class ECAPAGenderClassifier:
    """Accumulates caller audio and classifies gender with the ECAPA model.

    Mirrors :class:`F0GenderClassifier`: feed PCM via :meth:`add_audio`; it
    returns a :class:`GenderEstimate` exactly once (``None`` before and after).
    """

    # The one-shot forward pass is CPU-heavy enough to stutter audio if run on
    # the event loop, so VoiceGenderDetector offloads add_audio to a thread.
    offload_to_thread = True

    def __init__(self) -> None:
        self._sample_rate: Optional[int] = None
        self._voiced_chunks: list[np.ndarray] = []  # int16-scale float windows
        self._voiced_samples = 0
        self._pending = np.empty(0, dtype=np.float64)
        self._total_samples = 0
        self._result: Optional[GenderEstimate] = None

    @property
    def result(self) -> Optional[GenderEstimate]:
        return self._result

    def add_audio(
        self, pcm: bytes, sample_rate: int, num_channels: int = 1
    ) -> Optional[GenderEstimate]:
        """Feed raw signed 16-bit PCM; returns an estimate when one is reached."""
        if self._result is not None or not pcm:
            return None

        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
        if num_channels > 1:
            usable = len(samples) - (len(samples) % num_channels)
            samples = samples[:usable].reshape(-1, num_channels).mean(axis=1)

        if self._sample_rate != sample_rate:
            # Sample rate changed (or first audio): restart accumulation.
            self._sample_rate = sample_rate
            self._pending = np.empty(0, dtype=np.float64)

        self._pending = np.concatenate([self._pending, samples])
        self._total_samples += len(samples)

        # Keep only voiced 50 ms windows (RMS-gated), matching F0's energy floor.
        window_size = int(WINDOW_SECONDS * sample_rate)
        while len(self._pending) >= window_size:
            window = self._pending[:window_size]
            self._pending = self._pending[window_size:]
            centered = window - window.mean()
            rms = float(np.sqrt(np.mean(centered * centered)))
            if rms >= MIN_RMS:
                self._voiced_chunks.append(window)
                self._voiced_samples += len(window)

        return self._maybe_decide()

    def _maybe_decide(self) -> Optional[GenderEstimate]:
        sr = self._sample_rate or MODEL_SAMPLE_RATE
        voiced_seconds = self._voiced_samples / sr
        total_seconds = self._total_samples / sr

        if voiced_seconds >= MIN_VOICED_SECONDS:
            self._result = self._classify(voiced_seconds)
            return self._result

        if total_seconds >= MAX_TOTAL_SECONDS:
            if voiced_seconds > 0.5:
                # Some voiced speech, just not the full target — classify anyway.
                self._result = self._classify(voiced_seconds)
            else:
                # Long call, almost no voiced speech (noise, music, silence).
                self._result = GenderEstimate(
                    gender="unknown",
                    confidence=0.0,
                    median_f0_hz=0.0,
                    voiced_seconds=voiced_seconds,
                )
            return self._result

        return None

    def _classify(self, voiced_seconds: float) -> GenderEstimate:
        try:
            import torch

            model, device = _load_model()

            voiced = np.concatenate(self._voiced_chunks)
            # int16 scale -> [-1, 1] float, matching torchaudio.load's range.
            waveform = (voiced / 32768.0).astype(np.float32)
            tensor = torch.from_numpy(waveform).unsqueeze(0)  # (1, num_samples)

            if self._sample_rate and self._sample_rate != MODEL_SAMPLE_RATE:
                from torchaudio.transforms import Resample

                tensor = Resample(
                    orig_freq=self._sample_rate, new_freq=MODEL_SAMPLE_RATE
                )(tensor)

            tensor = tensor.to(device)
            with torch.no_grad():
                logits = model.forward(tensor)
                probs = torch.softmax(logits, dim=1)[0]
            pred = int(torch.argmax(probs).item())
            confidence = float(probs[pred].item())
            gender = model.pred2gender.get(pred, "unknown")

            return GenderEstimate(
                gender=gender,
                confidence=confidence,
                median_f0_hz=0.0,
                voiced_seconds=voiced_seconds,
            )
        except Exception as e:
            logger.warning(f"ECAPA gender classification failed: {e}")
            return GenderEstimate(
                gender="unknown",
                confidence=0.0,
                median_f0_hz=0.0,
                voiced_seconds=voiced_seconds,
            )
