"""In-app agent copilot: a chat assistant that creates and edits agents.

Drives the same tool surface as the MCP server (`api/mcp_server/`) from a
Claude tool-use loop, so edits made in chat are saved as drafts exactly as
an external MCP client's would be.
"""

from api.services.agent_copilot.history import (
    acquire_turn_lock,
    consume_daily_message,
    load_messages,
    release_turn_lock,
)
from api.services.agent_copilot.runner import is_enabled, run_turn
from api.services.agent_copilot.transcript import build_transcript

__all__ = [
    "acquire_turn_lock",
    "build_transcript",
    "consume_daily_message",
    "is_enabled",
    "load_messages",
    "release_turn_lock",
    "run_turn",
]
