"""Per-organization AI assistant settings.

An organization can bring its own Anthropic API key and choose the model,
effort, and a daily message limit from the Settings page. Without its own
key it falls back to the platform key (``ANTHROPIC_API_KEY``), and then
the platform's daily limit always applies so one tenant can't run up the
platform's bill. Stored like other org secrets (Langfuse, model keys) in
``organization_configurations`` and masked whenever it is read back.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import anthropic

from api.constants import (
    AGENT_COPILOT_DAILY_MESSAGE_LIMIT,
    AGENT_COPILOT_EFFORT,
    AGENT_COPILOT_MODEL,
    ANTHROPIC_API_KEY,
)
from api.db import db_client
from api.enums import OrganizationConfigurationKey

_KEY = OrganizationConfigurationKey.AGENT_COPILOT_SETTINGS.value

# The request shape the runner sends (adaptive thinking with display
# "updates", fallbacks "default") is accepted by these models.
SUPPORTED_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5")
EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")

KeySource = Literal["organization", "platform"]


@dataclass(frozen=True)
class EffectiveSettings:
    """What a chat turn for one organization actually runs with."""

    enabled: bool
    api_key: str | None
    key_source: KeySource | None
    model: str
    effort: str
    # Messages per UTC day; 0 means unlimited.
    daily_message_limit: int

    @property
    def available(self) -> bool:
        return self.enabled and self.api_key is not None


async def load_stored_settings(organization_id: int) -> dict[str, Any]:
    config = await db_client.get_configuration(organization_id, _KEY)
    return dict(config.value) if config and config.value else {}


async def save_stored_settings(organization_id: int, value: dict[str, Any]) -> None:
    await db_client.upsert_configuration(organization_id, _KEY, value)


def resolve_settings(stored: dict[str, Any]) -> EffectiveSettings:
    org_key = stored.get("api_key") or None
    api_key = org_key or ANTHROPIC_API_KEY
    key_source: KeySource | None = (
        "organization" if org_key else "platform" if ANTHROPIC_API_KEY else None
    )

    model = stored.get("model") or AGENT_COPILOT_MODEL
    if model not in SUPPORTED_MODELS:
        model = SUPPORTED_MODELS[0]
    effort = stored.get("effort") or AGENT_COPILOT_EFFORT
    if effort not in EFFORT_LEVELS:
        effort = "medium"

    org_limit = stored.get("daily_message_limit")
    org_limit = org_limit if isinstance(org_limit, int) and org_limit >= 0 else None
    if key_source != "platform":
        # Their key, their bill: the organization's own limit (default none).
        # With no key at all, only an organization key can enable the
        # assistant, so report the limit that will apply once one is added.
        limit = org_limit or 0
    else:
        # Platform key: the platform cap always applies; an org may go lower.
        platform = AGENT_COPILOT_DAILY_MESSAGE_LIMIT
        candidates = [v for v in (platform, org_limit) if v]
        limit = min(candidates) if candidates else 0

    return EffectiveSettings(
        enabled=stored.get("enabled", True) is not False,
        api_key=api_key,
        key_source=key_source,
        model=model,
        effort=effort,
        daily_message_limit=limit,
    )


async def get_effective_settings(organization_id: int) -> EffectiveSettings:
    return resolve_settings(await load_stored_settings(organization_id))


class InvalidApiKeyError(Exception):
    """The key was rejected, or can't use the chosen model."""


async def verify_api_key(api_key: str, model: str) -> None:
    """Check the key works and can use ``model``.

    Uses the Models API, which costs nothing per token.
    """
    client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=1, timeout=15.0)
    try:
        await client.models.retrieve(model)
    except anthropic.AuthenticationError:
        raise InvalidApiKeyError("Anthropic rejected this API key.")
    except anthropic.PermissionDeniedError:
        raise InvalidApiKeyError("This API key doesn't have access to the API.")
    except anthropic.NotFoundError:
        raise InvalidApiKeyError(f"This API key can't use {model}.")
    except anthropic.APIConnectionError:
        raise InvalidApiKeyError(
            "Couldn't reach Anthropic to check the key. Try again."
        )
    finally:
        await client.close()
