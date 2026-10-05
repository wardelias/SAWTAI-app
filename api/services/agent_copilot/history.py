"""Server-side conversation history for the agent copilot.

History stays on the server (never round-tripped through the browser)
because Claude's thinking blocks and tool results must be replayed
byte-for-byte on the next request: the history is append-only, and an
edited prefix is rejected by the API. Conversations are keyed by
organization and user, so one user can never load another's history, and
expire after a day of inactivity.
"""

from __future__ import annotations

import json
from typing import Any

import redis.asyncio as aioredis

from api.constants import REDIS_URL

_TTL_SECONDS = 24 * 60 * 60
# Upper bound on one reply (tool loop included); the lock self-expires if a
# worker dies mid-turn so the conversation never stays stuck.
_LOCK_TTL_SECONDS = 10 * 60

_redis: aioredis.Redis | None = None


async def _client() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


def _key(organization_id: int, user_id: int, conversation_id: str) -> str:
    return f"agent_copilot:conv:{organization_id}:{user_id}:{conversation_id}"


async def load_messages(
    organization_id: int, user_id: int, conversation_id: str
) -> list[dict[str, Any]]:
    raw = await (await _client()).get(_key(organization_id, user_id, conversation_id))
    return json.loads(raw) if raw else []


async def save_messages(
    organization_id: int,
    user_id: int,
    conversation_id: str,
    messages: list[dict[str, Any]],
) -> None:
    await (await _client()).set(
        _key(organization_id, user_id, conversation_id),
        json.dumps(messages),
        ex=_TTL_SECONDS,
    )


async def acquire_turn_lock(
    organization_id: int, user_id: int, conversation_id: str
) -> bool:
    """Claim the conversation for one reply. False if a reply is running."""
    key = _key(organization_id, user_id, conversation_id) + ":lock"
    return bool(await (await _client()).set(key, "1", nx=True, ex=_LOCK_TTL_SECONDS))


async def release_turn_lock(
    organization_id: int, user_id: int, conversation_id: str
) -> None:
    key = _key(organization_id, user_id, conversation_id) + ":lock"
    await (await _client()).delete(key)
