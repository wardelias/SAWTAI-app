import struct
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from api.services.configuration.registry import (
    HamsaTTSConfiguration,
    ServiceProviders,
)
from api.services.pipecat.hamsa_tts import parse_wav_header
from api.services.pipecat.service_factory import create_tts_service


def make_wav_header(
    *,
    sample_rate: int = 24000,
    channels: int = 1,
    bits: int = 16,
    audio_format: int = 1,
    data_size: int = 0,
    extra_chunk: bytes = b"",
) -> bytes:
    fmt_body = struct.pack(
        "<HHIIHH",
        audio_format,
        channels,
        sample_rate,
        sample_rate * channels * bits // 8,
        channels * bits // 8,
        bits,
    )
    chunks = b"fmt " + struct.pack("<I", len(fmt_body)) + fmt_body
    chunks += extra_chunk
    chunks += b"data" + struct.pack("<I", data_size)
    return b"RIFF" + struct.pack("<I", 4 + len(chunks) + data_size) + b"WAVE" + chunks


class TestParseWavHeader:
    def test_valid_header(self):
        header = make_wav_header(sample_rate=24000)
        data_offset, sample_rate = parse_wav_header(header)
        assert sample_rate == 24000
        assert data_offset == len(header)

    def test_skips_unknown_chunks(self):
        extra = b"LIST" + struct.pack("<I", 6) + b"abcdef"
        header = make_wav_header(sample_rate=16000, extra_chunk=extra)
        data_offset, sample_rate = parse_wav_header(header)
        assert sample_rate == 16000
        assert data_offset == len(header)

    def test_partial_header_returns_none(self):
        header = make_wav_header()
        for cut in (0, 4, 11, 20, len(header) - 1):
            assert parse_wav_header(header[:cut]) is None

    def test_not_riff_raises(self):
        with pytest.raises(ValueError, match="RIFF"):
            parse_wav_header(b'{"code": 400}' + b"\x00" * 32)

    def test_stereo_raises(self):
        with pytest.raises(ValueError, match="channel"):
            parse_wav_header(make_wav_header(channels=2))

    def test_non_pcm_raises(self):
        # 7 = mu-law
        with pytest.raises(ValueError, match="16-bit PCM"):
            parse_wav_header(make_wav_header(audio_format=7, bits=8))


class TestHamsaTTSConfiguration:
    def test_default_values(self):
        config = HamsaTTSConfiguration(api_key="test-key")
        assert config.provider == ServiceProviders.HAMSA
        assert config.model == "default"
        assert config.voice == "Salem"
        assert config.dialect == "msa"

    def test_custom_voice_and_dialect(self):
        config = HamsaTTSConfiguration(
            api_key="test-key", voice="Mariam", dialect="egy"
        )
        assert config.voice == "Mariam"
        assert config.dialect == "egy"


class TestHamsaTTSServiceFactory:
    def test_create_hamsa_tts_service(self):
        user_config = SimpleNamespace(
            tts=SimpleNamespace(
                provider=ServiceProviders.HAMSA.value,
                api_key="test-key",
                model="default",
                voice="Mariam",
                dialect="egy",
            )
        )
        audio_config = SimpleNamespace(transport_in_sample_rate=16000)

        with patch(
            "api.services.pipecat.service_factory.HamsaTTSService"
        ) as mock_service:
            from api.services.pipecat.hamsa_tts import HamsaTTSService

            mock_service.Settings = HamsaTTSService.Settings
            create_tts_service(user_config, audio_config)

        assert mock_service.call_count == 1
        kwargs = mock_service.call_args.kwargs
        assert kwargs["api_key"] == "test-key"
        assert kwargs["settings"].voice == "Mariam"
        assert kwargs["settings"].dialect == "egy"

    def test_create_hamsa_tts_service_defaults_missing_fields(self):
        user_config = SimpleNamespace(
            tts=SimpleNamespace(
                provider=ServiceProviders.HAMSA.value,
                api_key="test-key",
                model="default",
                voice=None,
                dialect=None,
            )
        )
        audio_config = SimpleNamespace(transport_in_sample_rate=16000)

        with patch(
            "api.services.pipecat.service_factory.HamsaTTSService"
        ) as mock_service:
            from api.services.pipecat.hamsa_tts import HamsaTTSService

            mock_service.Settings = HamsaTTSService.Settings
            create_tts_service(user_config, audio_config)

        kwargs = mock_service.call_args.kwargs
        assert kwargs["settings"].voice == "Salem"
        assert kwargs["settings"].dialect == "msa"
