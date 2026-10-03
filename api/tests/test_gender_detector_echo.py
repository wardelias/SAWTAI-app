"""VoiceGenderDetector must not classify echo of the agent's own voice.

A female agent voice leaking back into the inbound audio (speakerphone,
laptop speakers, line echo) used to be classified as the caller, so male
callers were addressed as female.
"""

import asyncio

import numpy as np
import pytest

from api.services.gender import voice_gender_detector as vgd
from api.services.gender.voice_gender_detector import (
    GenderEstimate,
    VoiceGenderDetector,
)
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    InputAudioRawFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

SR = 16000


def _voice(f0: float, seconds: float) -> bytes:
    t = np.arange(int(seconds * SR)) / SR
    sig = sum((8000.0 / h) * np.sin(2 * np.pi * f0 * h * t) for h in range(1, 9))
    return np.clip(sig, -32000, 32000).astype(np.int16).tobytes()


class _RecordingClassifier:
    """Counts the audio it is fed; decides after a fixed number of bytes."""

    def __init__(self, decide_after_bytes: int):
        self.fed = 0
        self._decide_after = decide_after_bytes
        self.result = None

    def add_audio(self, pcm, sample_rate, num_channels=1):
        self.fed += len(pcm)
        if self.result is None and self.fed >= self._decide_after:
            self.result = GenderEstimate("male", 0.95, 110.0, 2.0)
            return self.result
        return None


@pytest.fixture
def detector(monkeypatch):
    # Bypass FrameProcessor plumbing (start/link) — only our logic is under test.
    async def _noop_process(self, frame, direction):
        return None

    async def _noop_push(self, frame, direction=FrameDirection.DOWNSTREAM):
        return None

    monkeypatch.setattr(FrameProcessor, "process_frame", _noop_process)
    monkeypatch.setattr(FrameProcessor, "push_frame", _noop_push)

    detected: list[GenderEstimate] = []

    async def _on_detected(estimate):
        detected.append(estimate)

    clf = _RecordingClassifier(decide_after_bytes=len(_voice(110.0, 1.0)))
    det = VoiceGenderDetector(on_gender_detected=_on_detected, classifier=clf)
    return det, clf, detected


def _feed(det, pcm: bytes):
    frame = InputAudioRawFrame(audio=pcm, sample_rate=SR, num_channels=1)
    asyncio.run(det.process_frame(frame, FrameDirection.DOWNSTREAM))


def test_audio_ignored_while_agent_speaks(detector):
    det, clf, detected = detector
    asyncio.run(det.process_frame(BotStartedSpeakingFrame(), FrameDirection.UPSTREAM))
    _feed(det, _voice(220.0, 3.0))  # echo of a female agent voice
    assert clf.fed == 0
    assert detected == []


def test_echo_tail_after_agent_stops(detector, monkeypatch):
    det, clf, detected = detector
    now = [1000.0]
    monkeypatch.setattr(vgd.time, "monotonic", lambda: now[0])
    asyncio.run(det.process_frame(BotStartedSpeakingFrame(), FrameDirection.UPSTREAM))
    asyncio.run(det.process_frame(BotStoppedSpeakingFrame(), FrameDirection.UPSTREAM))
    _feed(det, _voice(220.0, 1.0))  # still inside the echo tail
    assert clf.fed == 0
    now[0] += vgd.BOT_ECHO_TAIL_SECONDS + 0.01
    _feed(det, _voice(110.0, 1.0))  # the caller, after the tail
    assert clf.fed > 0
    assert [e.gender for e in detected] == ["male"]


def test_caller_audio_analyzed_when_agent_silent(detector):
    det, clf, detected = detector
    _feed(det, _voice(110.0, 1.0))
    assert clf.fed > 0
    assert len(detected) == 1
