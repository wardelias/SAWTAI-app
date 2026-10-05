"""In-app agent copilot: a chat assistant that creates and edits agents.

Drives the same tool surface as the MCP server (`api/mcp_server/`) from a
Claude tool-use loop, so edits made in chat are saved as drafts exactly as
an external MCP client's would be.
"""

from api.services.agent_copilot.history import (
    acquire_insights_lock,
    acquire_turn_lock,
    consume_daily_message,
    load_insights_report,
    load_messages,
    release_insights_lock,
    release_turn_lock,
    save_insights_report,
)
from api.services.agent_copilot.insights import (
    InsightsError,
    InsightsLimitError,
    generate_insights,
)
from api.services.agent_copilot.runner import run_turn
from api.services.agent_copilot.settings import (
    EFFORT_LEVELS,
    SUPPORTED_MODELS,
    EffectiveSettings,
    InvalidApiKeyError,
    get_effective_settings,
    load_stored_settings,
    resolve_settings,
    save_stored_settings,
    verify_api_key,
)
from api.services.agent_copilot.transcript import build_transcript

__all__ = [
    "EFFORT_LEVELS",
    "InsightsError",
    "InsightsLimitError",
    "acquire_insights_lock",
    "generate_insights",
    "load_insights_report",
    "release_insights_lock",
    "save_insights_report",
    "SUPPORTED_MODELS",
    "EffectiveSettings",
    "InvalidApiKeyError",
    "acquire_turn_lock",
    "build_transcript",
    "consume_daily_message",
    "get_effective_settings",
    "load_messages",
    "load_stored_settings",
    "release_turn_lock",
    "resolve_settings",
    "run_turn",
    "save_stored_settings",
    "verify_api_key",
]
