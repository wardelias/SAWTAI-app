"""Outbound SMS for reactivation sequences.

Sends through the organization's outbound telephony configuration (the same
one voice steps dial from). Only providers that implement ``send_sms`` can
text; today that is Twilio.
"""

from typing import Optional

from api.db import db_client


class SmsError(Exception):
    """Raised when an SMS could not be sent."""


async def send_sms(
    *,
    organization_id: int,
    to_number: str,
    body: str,
    telephony_configuration_id: Optional[int] = None,
) -> str:
    """Send ``body`` to ``to_number``. Returns the provider message id."""
    # Lazy import: mirrors outbound.py (telephony factory import cycle).
    from api.services.telephony.factory import get_telephony_provider_by_id
    from api.services.telephony.outbound_readiness import (
        resolve_outbound_configuration_id,
    )

    if not body.strip():
        raise SmsError("SMS step has no message text")

    try:
        config_id = await resolve_outbound_configuration_id(
            telephony_configuration_id, organization_id, db=db_client
        )
        provider = await get_telephony_provider_by_id(config_id, organization_id)
    except Exception as e:
        raise SmsError(f"No usable telephony configuration for SMS: {e}") from e

    sender = getattr(provider, "send_sms", None)
    if sender is None:
        raise SmsError(
            f"SMS is not supported for {provider.PROVIDER_NAME} — use a Twilio "
            "telephony configuration to send texts"
        )
    try:
        return await sender(to_number=to_number, body=body)
    except Exception as e:
        raise SmsError(str(e)) from e
