"""Hamsa text-to-speech service.

Integrates Hamsa's realtime TTS API (https://docs.tryhamsa.com) — Arabic-focused
TTS with per-dialect voices and Arabic/English code-switching. The realtime
endpoint returns a complete WAV response which we parse and stream out as raw
PCM frames, resampling to the pipeline rate.
"""

from collections.abc import AsyncGenerator
from dataclasses import dataclass, field

import aiohttp
from loguru import logger

from pipecat.audio.utils import create_stream_resampler
from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import NOT_GIVEN, TTSSettings, _NotGiven
from pipecat.services.tts_service import TTSService
from pipecat.utils.tracing.service_decorators import traced_tts

DEFAULT_BASE_URL = "https://api.tryhamsa.com"

# Dialect codes accepted by the realtime TTS endpoint.
HAMSA_DIALECTS = [
    "msa",  # Modern Standard Arabic
    "pls",  # Palestinian
    "egy",  # Egyptian
    "syr",  # Syrian
    "irq",  # Iraqi
    "jor",  # Jordanian
    "leb",  # Lebanese
    "ksa",  # Saudi
    "uae",  # Emirati
    "bah",  # Bahraini
    "qat",  # Qatari
    "kuw",  # Kuwaiti
    "oma",  # Omani
    "ar-sa",  # Arabic - Gulf
    "en",  # English
]


def parse_wav_header(data: bytes) -> tuple[int, int] | None:
    """Parse a (possibly partial) RIFF/WAVE header.

    Args:
        data: Bytes from the start of the response body.

    Returns:
        ``(data_offset, sample_rate)`` where ``data_offset`` is the byte offset
        of the first PCM sample, or ``None`` if more bytes are needed to finish
        parsing.

    Raises:
        ValueError: If the data is not a WAV stream or is not 16-bit mono PCM.
    """
    if len(data) < 12:
        return None
    if data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("response is not a RIFF/WAVE audio stream")

    offset = 12
    fmt: tuple[int, int, int, int] | None = None
    while True:
        if len(data) < offset + 8:
            return None
        chunk_id = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        body_start = offset + 8
        if chunk_id == b"fmt ":
            if len(data) < body_start + 16:
                return None
            audio_format = int.from_bytes(data[body_start : body_start + 2], "little")
            channels = int.from_bytes(data[body_start + 2 : body_start + 4], "little")
            sample_rate = int.from_bytes(
                data[body_start + 4 : body_start + 8], "little"
            )
            bits = int.from_bytes(data[body_start + 14 : body_start + 16], "little")
            fmt = (audio_format, channels, sample_rate, bits)
        elif chunk_id == b"data":
            if fmt is None:
                raise ValueError("WAV 'data' chunk appeared before 'fmt '")
            audio_format, channels, sample_rate, bits = fmt
            if audio_format != 1 or bits != 16:
                raise ValueError(
                    f"unsupported WAV format (format={audio_format}, bits={bits}); "
                    "expected 16-bit PCM"
                )
            if channels != 1:
                raise ValueError(f"unsupported channel count {channels}; expected mono")
            return body_start, sample_rate
        # Chunk bodies are word-aligned: odd sizes carry a pad byte.
        offset = body_start + chunk_size + (chunk_size & 1)


@dataclass
class HamsaTTSSettings(TTSSettings):
    """Settings for HamsaTTSService.

    Parameters:
        dialect: Hamsa dialect code (e.g. "msa", "egy", "ksa", "en"). The
            selected voice must belong to this dialect.
    """

    dialect: str | None | _NotGiven = field(default_factory=lambda: NOT_GIVEN)


class HamsaTTSService(TTSService):
    """Text-to-speech service using Hamsa's realtime TTS API.

    Sends text to ``POST /v1/realtime/tts`` and streams the returned WAV body
    as raw PCM audio frames. Supports Hamsa's prebuilt per-dialect voices as
    well as custom cloned-voice UUIDs.

    API reference: https://docs.tryhamsa.com/api-reference/endpoint/rt-generate-tts
    """

    Settings = HamsaTTSSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        sample_rate: int | None = None,
        settings: Settings | None = None,
        **kwargs,
    ):
        """Initialize the Hamsa TTS service.

        Args:
            api_key: Hamsa API key.
            base_url: Hamsa API base URL.
            sample_rate: Output audio sample rate in Hz. If None, uses pipeline default.
            settings: Runtime-updatable settings (voice, dialect).
            **kwargs: Additional arguments passed to parent TTSService.
        """
        default_settings = self.Settings(
            model="default",
            voice="Salem",
            language=None,
            dialect="msa",
        )
        if settings is not None:
            default_settings.apply_update(settings)

        super().__init__(
            sample_rate=sample_rate,
            push_start_frame=True,
            push_stop_frames=True,
            settings=default_settings,
            **kwargs,
        )

        self._api_key = api_key
        self._tts_url = f"{base_url.rstrip('/')}/v1/realtime/tts"
        self._session: aiohttp.ClientSession | None = None
        self._resampler = create_stream_resampler()

    def can_generate_metrics(self) -> bool:
        """Check if this service can generate processing metrics."""
        return True

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def cleanup(self):
        """Close the owned aiohttp session."""
        await super().cleanup()
        if self._session and not self._session.closed:
            await self._session.close()

    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        """Generate TTS audio from text using Hamsa's realtime API.

        Args:
            text: The text to synthesize into speech.
            context_id: The context ID for tracking audio frames.

        Yields:
            Frame: Audio frames containing the synthesized speech.
        """
        logger.debug(f"{self}: Generating TTS [{text}]")

        headers = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "speaker": self._settings.voice,
            "dialect": self._settings.dialect,
            "mulaw": False,
        }

        try:
            session = await self._get_session()
            async with session.post(
                self._tts_url, headers=headers, json=payload
            ) as response:
                if response.status != 200:
                    body = (await response.text())[:300]
                    yield ErrorFrame(
                        error=f"Hamsa TTS error: HTTP {response.status} {body}"
                    )
                    return

                await self.start_tts_usage_metrics(text)

                header_buffer = bytearray()
                wav_info: tuple[int, int] | None = None
                in_rate = 0
                # Carries an odd trailing byte across chunks so the resampler
                # always sees whole 16-bit samples.
                pcm_remainder = b""

                async for chunk in response.content.iter_chunked(self.chunk_size):
                    if not chunk:
                        continue

                    if wav_info is None:
                        header_buffer.extend(chunk)
                        wav_info = parse_wav_header(bytes(header_buffer))
                        if wav_info is None:
                            continue
                        data_offset, in_rate = wav_info
                        pcm = bytes(header_buffer[data_offset:])
                        header_buffer.clear()
                    else:
                        pcm = chunk

                    pcm = pcm_remainder + pcm
                    if len(pcm) % 2:
                        pcm, pcm_remainder = pcm[:-1], pcm[-1:]
                    else:
                        pcm_remainder = b""
                    if not pcm:
                        continue

                    audio = await self._resampler.resample(
                        pcm, in_rate, self.sample_rate
                    )
                    if not audio:
                        continue

                    await self.stop_ttfb_metrics()
                    yield TTSAudioRawFrame(
                        audio=audio,
                        sample_rate=self.sample_rate,
                        num_channels=1,
                        context_id=context_id,
                    )

                if wav_info is None:
                    yield ErrorFrame(
                        error="Hamsa TTS error: response ended before a complete WAV header"
                    )
        except ValueError as e:
            yield ErrorFrame(error=f"Hamsa TTS error: {e}")
        except Exception as e:
            yield ErrorFrame(error=f"Hamsa TTS error: {e}", exception=e)
        finally:
            await self.stop_ttfb_metrics()
