"""Voice-based gender detection for live calls.

Estimates the caller's gender from the fundamental frequency (F0) of their
voice during the first seconds of a call. Built for grammatically gendered
languages (Arabic, Hebrew) where the agent must pick second-person verb
forms, pronouns, and adjectives to sound natural.

Two parts:

- ``F0GenderClassifier``: pure-numpy accumulator + classifier. Feed it raw
  PCM, it returns a ``GenderEstimate`` once it has heard enough voiced
  speech. Fully testable without a pipeline.
- ``VoiceGenderDetector``: thin pipecat ``FrameProcessor`` that feeds caller
  audio into the classifier and fires a one-shot async callback.

Why F0 instead of a neural classifier: adult male and female voices separate
well on pitch (male ~85-155 Hz, female ~165-255 Hz), F0 periodicity survives
8 kHz telephony audio (autocorrelation recovers the fundamental from the
harmonics even when the band-pass cuts the fundamental itself), it needs no
model download, and it is language-independent. Voices in the overlap band
are reported with low confidence so the agent keeps neutral address instead
of misgendering the caller.
"""

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Protocol, runtime_checkable

import numpy as np
from loguru import logger
from pipecat.frames.frames import Frame, InputAudioRawFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------

WINDOW_SECONDS = 0.05  # analysis window; >= 3 pitch periods at 60 Hz
MIN_F0_HZ = 65.0  # below this is mains hum / rumble, not voice
MAX_F0_HZ = 400.0  # above this is not an adult speaking voice
VOICING_AUTOCORR_THRESHOLD = 0.60  # normalized autocorrelation peak
MIN_RMS = 200.0  # int16-scale energy floor for a window to count

MALE_MAX_F0_HZ = 148.0  # median F0 below this → male
FEMALE_MIN_F0_HZ = 182.0  # median F0 above this → female
AMBIGUOUS_CENTER_HZ = 165.0  # tie-breaker inside the overlap band

MIN_VOICED_WINDOWS = 30  # ~1.5 s of voiced speech before deciding
AMBIGUOUS_MAX_VOICED_WINDOWS = 120  # ~6 s: force a low-confidence call
MAX_TOTAL_SECONDS = 45.0  # give up (unknown) after this much audio

NOTE_MIN_CONFIDENCE = 0.70  # below this, callers get neutral address

# Acting on "female" (a prompt note AND a deterministic Arabic feminine rewrite)
# is aggressive: mis-feminizing a male caller is a glaring, audible error, while
# missing a real female is a softer miss. So require higher confidence before
# applying feminine address than the neutral note threshold. Raise toward 0.90+
# if a male voice is still occasionally feminized.
FEMININE_MIN_CONFIDENCE = 0.85


@dataclass
class GenderEstimate:
    """Result of voice-based gender estimation."""

    gender: str  # "male" | "female" | "unknown"
    confidence: float  # 0.0 - 1.0
    median_f0_hz: float  # 0.0 when unknown
    voiced_seconds: float  # how much voiced speech informed the estimate


@runtime_checkable
class GenderClassifier(Protocol):
    """Streaming gender-classifier backend interface.

    Both :class:`F0GenderClassifier` and the neural ``ECAPAGenderClassifier``
    implement this so :class:`VoiceGenderDetector` can use either backend.
    """

    @property
    def result(self) -> Optional[GenderEstimate]: ...

    def add_audio(
        self, pcm: bytes, sample_rate: int, num_channels: int = 1
    ) -> Optional[GenderEstimate]: ...


def estimate_window_f0(window: np.ndarray, sample_rate: int) -> Optional[float]:
    """Estimate F0 of one audio window via normalized autocorrelation.

    Args:
        window: float64 mono samples (int16 scale), DC not yet removed.
        sample_rate: sample rate in Hz.

    Returns:
        F0 in Hz, or None if the window is silent/unvoiced.
    """
    x = window - window.mean()
    rms = float(np.sqrt(np.mean(x * x)))
    if rms < MIN_RMS:
        return None

    n = len(x)
    lag_min = int(sample_rate / MAX_F0_HZ)
    lag_max = min(int(sample_rate / MIN_F0_HZ), n - 1)
    if lag_min < 1 or lag_min >= lag_max:
        return None

    ac = np.correlate(x, x, mode="full")[n - 1 :]
    if ac[0] <= 0:
        return None
    ac = ac / ac[0]

    search = ac[lag_min : lag_max + 1]
    peak_idx = int(np.argmax(search))
    lag = lag_min + peak_idx
    peak = float(search[peak_idx])
    if peak < VOICING_AUTOCORR_THRESHOLD:
        return None

    # Octave-error correction: autocorrelation peaks at every multiple of the
    # true period, and noise can push a subharmonic (half F0) above the true
    # peak. If the half-lag neighborhood scores nearly as high, prefer it.
    half = lag // 2
    if half >= lag_min:
        lo = max(lag_min, half - 2)
        hi = min(lag_max, half + 2)
        half_peak_idx = lo + int(np.argmax(ac[lo : hi + 1]))
        if ac[half_peak_idx] >= 0.85 * peak:
            lag = half_peak_idx

    # Parabolic interpolation around the chosen lag for sub-sample precision.
    if 1 <= lag < len(ac) - 1:
        y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
        denom = y0 - 2 * y1 + y2
        if abs(denom) > 1e-12:
            offset = 0.5 * (y0 - y2) / denom
            if abs(offset) < 1.0:
                return sample_rate / (lag + float(offset))

    return sample_rate / lag


class F0GenderClassifier:
    """Accumulates caller audio and classifies gender from median F0.

    Feed PCM via :meth:`add_audio`; it returns a :class:`GenderEstimate`
    exactly once (and ``None`` before and after that).
    """

    def __init__(self) -> None:
        self._sample_rate: Optional[int] = None
        self._pending = np.empty(0, dtype=np.float64)
        self._voiced_f0s: list[float] = []
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

        window_size = int(WINDOW_SECONDS * sample_rate)
        while len(self._pending) >= window_size:
            window = self._pending[:window_size]
            self._pending = self._pending[window_size:]
            f0 = estimate_window_f0(window, sample_rate)
            if f0 is not None:
                self._voiced_f0s.append(f0)

        return self._maybe_decide()

    def _maybe_decide(self) -> Optional[GenderEstimate]:
        voiced = len(self._voiced_f0s)
        sr = self._sample_rate or 8000
        total_seconds = self._total_samples / sr

        if voiced >= MIN_VOICED_WINDOWS:
            median = float(np.median(self._voiced_f0s))
            clearly_male = median <= MALE_MAX_F0_HZ
            clearly_female = median >= FEMALE_MIN_F0_HZ
            if clearly_male or clearly_female or voiced >= AMBIGUOUS_MAX_VOICED_WINDOWS:
                self._result = self._build_estimate(median, voiced)
                return self._result

        if total_seconds >= MAX_TOTAL_SECONDS:
            # Long call, almost no classifiable voiced speech (noise, music,
            # speakerphone…). Stop trying so we don't burn CPU all call.
            self._result = GenderEstimate(
                gender="unknown",
                confidence=0.0,
                median_f0_hz=0.0,
                voiced_seconds=voiced * WINDOW_SECONDS,
            )
            return self._result

        return None

    def _build_estimate(self, median: float, voiced: int) -> GenderEstimate:
        if median <= MALE_MAX_F0_HZ:
            gender = "male"
            base = 0.60 + min(0.38, (MALE_MAX_F0_HZ - median) / 100.0)
        elif median >= FEMALE_MIN_F0_HZ:
            gender = "female"
            base = 0.60 + min(0.38, (median - FEMALE_MIN_F0_HZ) / 100.0)
        else:
            # Overlap band: lean to the nearer side but stay low-confidence so
            # downstream keeps neutral address.
            gender = "male" if median < AMBIGUOUS_CENTER_HZ else "female"
            base = 0.50

        # Penalize inconsistent pitch tracks (noise, two speakers, music).
        q1, q3 = np.percentile(self._voiced_f0s, [25, 75])
        if (q3 - q1) > 55.0:
            base -= 0.15

        return GenderEstimate(
            gender=gender,
            confidence=max(0.30, min(0.98, base)),
            median_f0_hz=median,
            voiced_seconds=voiced * WINDOW_SECONDS,
        )


class VoiceGenderDetector(FrameProcessor):
    """Pipecat processor that detects caller gender from inbound audio.

    Sits directly after ``transport.input()`` so it only ever sees caller
    audio. Passes every frame through untouched; once the classifier reaches
    a decision it fires ``on_gender_detected(estimate)`` exactly once and
    stops analyzing for the rest of the call.
    """

    def __init__(
        self,
        *,
        on_gender_detected: Callable[[GenderEstimate], Awaitable[None]],
        classifier: Optional["GenderClassifier"] = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._on_gender_detected = on_gender_detected
        # Default to the pitch-based backend; swap in any classifier exposing the
        # same ``add_audio(...) -> Optional[GenderEstimate]`` / ``result`` interface.
        self._classifier = classifier or F0GenderClassifier()
        self._done = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if (
            not self._done
            and direction == FrameDirection.DOWNSTREAM
            and isinstance(frame, InputAudioRawFrame)
        ):
            try:
                # Heavy backends (neural inference) run off the event loop so a
                # forward pass can't stall audio; cheap backends (F0) run inline.
                if getattr(self._classifier, "offload_to_thread", False):
                    estimate = await asyncio.to_thread(
                        self._classifier.add_audio,
                        frame.audio,
                        frame.sample_rate,
                        frame.num_channels,
                    )
                else:
                    estimate = self._classifier.add_audio(
                        frame.audio, frame.sample_rate, frame.num_channels
                    )
            except Exception as e:
                logger.warning(f"Voice gender detection failed, disabling: {e}")
                self._done = True
                estimate = None

            if estimate is not None:
                self._done = True
                logger.info(
                    f"Voice gender detected: {estimate.gender} "
                    f"(confidence={estimate.confidence:.2f}, "
                    f"f0={estimate.median_f0_hz:.0f}Hz, "
                    f"voiced={estimate.voiced_seconds:.1f}s)"
                )
                if estimate.gender != "unknown":
                    try:
                        await self._on_gender_detected(estimate)
                    except Exception as e:
                        logger.error(f"on_gender_detected callback failed: {e}")

        await self.push_frame(frame, direction)


def make_gender_classifier(backend: str) -> GenderClassifier:
    """Build a gender-classifier backend by name.

    ``"ecapa"`` → neural ``ECAPAGenderClassifier`` (ECAPA-TDNN, more accurate, pulls
    torch) — the live-pipeline default. ``"f0"`` → pitch-based :class:`F0GenderClassifier`
    (no model, telephony-robust, lightweight fallback). The neural module is imported
    lazily so torch only loads when the ECAPA backend is actually selected. Unknown or
    empty values fall back to F0 with a warning (the safe, dependency-free choice).
    """
    normalized = (backend or "f0").strip().lower()
    if normalized == "ecapa":
        from api.services.gender.neural_gender_detector import ECAPAGenderClassifier

        return ECAPAGenderClassifier()
    if normalized != "f0":
        logger.warning(
            f"Unknown voice gender backend '{backend}', falling back to 'f0'"
        )
    return F0GenderClassifier()
