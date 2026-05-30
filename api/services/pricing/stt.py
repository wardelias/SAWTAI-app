"""
STT (Speech-to-Text) pricing models for different providers.

Prices are per second for STT services.
"""

from decimal import Decimal
from typing import Dict

from api.services.configuration.registry import ServiceProviders

from .models import TimePricingModel

# STT pricing registry
STT_PRICING: Dict[str, Dict[str, TimePricingModel]] = {
    ServiceProviders.DEEPGRAM: {
        "nova-3-general": TimePricingModel(Decimal("0.0077") / 60),
        "nova-2": TimePricingModel(Decimal("0.0058") / 60),
        "default": TimePricingModel(Decimal("0.0077") / 60),
    },
    ServiceProviders.OPENAI: {
        "gpt-4o-transcribe": TimePricingModel(Decimal("0.015") / 60),
        "default": TimePricingModel(Decimal("0.015") / 60),
    },
    ServiceProviders.SONIOX: {
        # TODO: replace with the real Soniox real-time per-minute rate from your
        # plan (https://soniox.com/pricing). Seeded with the global default until
        # confirmed so cost tracking doesn't silently use a fabricated number.
        "stt-rt-v4": TimePricingModel(Decimal("0.0077") / 60),
        "default": TimePricingModel(Decimal("0.0077") / 60),
    },
    "default": {"default": TimePricingModel(Decimal("0.0077") / 60)},
}
