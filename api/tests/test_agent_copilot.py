"""Tests for the in-app agent copilot (services/agent_copilot + its route).

The Anthropic client is replaced by a scripted fake that emits real SDK
event/message types, so the runner's attribute access is checked against
the SDK while no network calls are made. History storage is an in-memory
dict.
"""

from __future__ import annotations

import asyncio
import copy
import dataclasses
import json
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import httpx2
import pytest
from anthropic.types.beta import (
    BetaMessage,
    BetaRawContentBlockDeltaEvent,
    BetaRawContentBlockStartEvent,
)
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from mcp.types import TextContent

from api.mcp_server import mcp
from api.mcp_server.auth import acting_as, authenticate_mcp_request
from api.routes.agent_copilot import router
from api.services.agent_copilot import runner
from api.services.agent_copilot.settings import EffectiveSettings
from api.services.agent_copilot.tools import build_tool_definitions, run_tool
from api.services.agent_copilot.transcript import build_transcript
from api.services.auth.depends import get_user

# ─── Fakes ────────────────────────────────────────────────────────────────


_SETTINGS = EffectiveSettings(
    enabled=True,
    api_key="sk-ant-org-key",
    key_source="organization",
    model="claude-sonnet-5-5",
    effort="high",
    daily_message_limit=50,
)


def _settings_patch(settings: EffectiveSettings = _SETTINGS):
    return patch(
        "api.routes.agent_copilot.get_effective_settings",
        AsyncMock(return_value=settings),
    )


def _user(org_id: int = 11, user_id: int = 7) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, selected_organization_id=org_id)


def _text_events(text: str, index: int = 0) -> list[Any]:
    return [
        BetaRawContentBlockStartEvent.model_validate(
            {
                "type": "content_block_start",
                "index": index,
                "content_block": {"type": "text", "text": ""},
            }
        ),
        BetaRawContentBlockDeltaEvent.model_validate(
            {
                "type": "content_block_delta",
                "index": index,
                "delta": {"type": "text_delta", "text": text},
            }
        ),
    ]


def _progress_events(note: str, index: int = 0) -> list[Any]:
    return [
        BetaRawContentBlockStartEvent.model_validate(
            {
                "type": "content_block_start",
                "index": index,
                "content_block": {"type": "thinking", "thinking": "", "signature": ""},
            }
        ),
        BetaRawContentBlockDeltaEvent.model_validate(
            {
                "type": "content_block_delta",
                "index": index,
                "delta": {"type": "thinking_delta", "thinking": note},
            }
        ),
    ]


def _tool_start_event(tool_id: str, name: str, index: int) -> Any:
    return BetaRawContentBlockStartEvent.model_validate(
        {
            "type": "content_block_start",
            "index": index,
            "content_block": {
                "type": "tool_use",
                "id": tool_id,
                "name": name,
                "input": {},
            },
        }
    )


def _message(content: list[dict[str, Any]], stop_reason: str) -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )


class _FakeStream:
    def __init__(
        self,
        events: list[Any],
        final: BetaMessage | None,
        raise_exc: Exception | None = None,
    ):
        self._events = events
        self._final = final
        self._raise = raise_exc

    async def __aenter__(self) -> _FakeStream:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for event in self._events:
            yield event
        if self._raise is not None:
            raise self._raise

    async def get_final_message(self) -> BetaMessage:
        assert self._final is not None
        return self._final


class _FakeClient:
    """Plays back one scripted stream per model call and records requests."""

    def __init__(self, streams: list[_FakeStream]):
        self._streams = iter(streams)
        self.requests: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **kwargs: Any) -> _FakeStream:
        self.requests.append(copy.deepcopy(kwargs))
        return next(self._streams)


@pytest.fixture
def store():
    """In-memory replacement for the Redis-backed history module."""
    data: dict[tuple, list] = {}

    async def load(org_id, user_id, conversation_id):
        return copy.deepcopy(data.get((org_id, user_id, conversation_id), []))

    async def save(org_id, user_id, conversation_id, messages):
        data[(org_id, user_id, conversation_id)] = copy.deepcopy(messages)

    with (
        patch.object(runner.history, "load_messages", load),
        patch.object(runner.history, "save_messages", save),
    ):
        yield data


_TOOLS = [
    {
        "name": "list_workflows",
        "description": "List agents",
        "input_schema": {"type": "object"},
    }
]


async def _collect(client: _FakeClient, **kwargs: Any) -> list[dict[str, Any]]:
    with (
        patch.object(runner, "get_client", return_value=client),
        patch.object(runner, "build_tool_definitions", AsyncMock(return_value=_TOOLS)),
    ):
        kwargs.setdefault("settings", _SETTINGS)
        return [event async for event in runner.run_turn(**kwargs)]


# ─── In-process MCP auth ──────────────────────────────────────────────────


async def test_acting_as_supplies_user_without_api_key_headers():
    user = MagicMock(id=3, selected_organization_id=44)
    with patch("api.mcp_server.auth.get_http_headers") as get_headers:
        with acting_as(user):
            assert await authenticate_mcp_request() is user
        get_headers.assert_not_called()


async def test_header_auth_still_required_outside_acting_as():
    with patch("api.mcp_server.auth.get_http_headers", return_value={}):
        with pytest.raises(HTTPException) as exc_info:
            await authenticate_mcp_request()
    assert exc_info.value.status_code == 401


# ─── Tool bridge ──────────────────────────────────────────────────────────


async def test_tool_definitions_mirror_mcp_tools_in_stable_order():
    definitions = await build_tool_definitions()
    registered = await mcp.list_tools()

    names = [d["name"] for d in definitions]
    assert names == sorted(t.name for t in registered)
    for definition in definitions:
        assert definition["input_schema"]["type"] == "object"
        assert definition["eager_input_streaming"] is True
    assert await build_tool_definitions() == definitions


async def test_run_tool_scopes_to_the_users_organization():
    workflow = SimpleNamespace(id=5, name="Sales", status="active", created_at=None)
    listing = AsyncMock(return_value=[workflow])
    with patch(
        "api.mcp_server.tools.workflows.db_client.get_all_workflows_for_listing",
        listing,
    ):
        outcome = await run_tool(_user(org_id=11), "list_workflows", {})

    assert not outcome.is_error
    listing.assert_awaited_once_with(organization_id=11, status="active")
    assert json.loads(outcome.content)[0]["name"] == "Sales"


async def test_run_tool_reports_not_found_as_error_result():
    with patch(
        "api.mcp_server.tools.get_workflow_code.db_client.get_workflow",
        AsyncMock(return_value=None),
    ):
        outcome = await run_tool(_user(), "get_workflow_code", {"workflow_id": 99})

    assert outcome.is_error
    assert "not found" in outcome.content


async def test_run_tool_rejects_invalid_arguments_without_running():
    get_workflow = AsyncMock()
    with patch(
        "api.mcp_server.tools.get_workflow_code.db_client.get_workflow", get_workflow
    ):
        outcome = await run_tool(_user(), "get_workflow_code", {"workflow_id": "abc"})
        malformed = await run_tool(_user(), "get_workflow_code", "not-an-object")

    assert outcome.is_error and "Invalid arguments" in outcome.content
    assert malformed.is_error and "INVALID_JSON" in malformed.content
    get_workflow.assert_not_awaited()


async def test_run_tool_unknown_tool():
    outcome = await run_tool(_user(), "drop_database", {})
    assert outcome.is_error


async def test_run_tool_flags_saved_workflow_for_the_ui():
    from fastmcp.tools.tool import ToolResult

    saved = {"saved": True, "workflow_id": 5, "name": "Sales", "version_number": 3}
    fake_tool = MagicMock()
    fake_tool.run = AsyncMock(
        return_value=ToolResult(
            content=[TextContent(type="text", text=json.dumps(saved))],
            structured_content=saved,
        )
    )
    with patch.object(mcp, "get_tool", AsyncMock(return_value=fake_tool)):
        outcome = await run_tool(
            _user(), "save_workflow", {"workflow_id": 5, "code": "x"}
        )

    assert outcome.changed_workflow_id == 5
    assert outcome.ui_summary == {
        "workflow_id": 5,
        "workflow_name": "Sales",
        "version_number": 3,
    }


# ─── Turn runner ──────────────────────────────────────────────────────────


async def test_turn_runs_tool_then_answers_and_persists_history(store):
    tool_use = {
        "type": "tool_use",
        "id": "toolu_1",
        "name": "list_workflows",
        "input": {},
    }
    client = _FakeClient(
        [
            _FakeStream(
                _progress_events("Checking your agents.")
                + [_tool_start_event("toolu_1", "list_workflows", 1)],
                _message(
                    [
                        {
                            "type": "thinking",
                            "thinking": "Checking your agents.",
                            "signature": "sig1",
                        },
                        tool_use,
                    ],
                    "tool_use",
                ),
            ),
            _FakeStream(
                _text_events("You have one agent."),
                _message([{"type": "text", "text": "You have one agent."}], "end_turn"),
            ),
        ]
    )
    run_tool_mock = AsyncMock(
        return_value=SimpleNamespace(
            content='{"result": []}', is_error=False, ui_summary={}
        )
    )
    with patch.object(runner, "run_tool", run_tool_mock):
        events = await _collect(
            client,
            user=_user(),
            conversation_id="c1",
            message="What agents do I have?",
            editor_workflow=(5, "Sales"),
        )

    assert [e["type"] for e in events] == [
        "step_start",
        "progress",
        "tool_start",
        "tool_end",
        "step_start",
        "text",
        "done",
    ]
    assert events[3] == {
        "type": "tool_end",
        "id": "toolu_1",
        "name": "list_workflows",
        "ok": True,
    }
    run_tool_mock.assert_awaited_once()

    first = client.requests[0]
    assert first["model"] == _SETTINGS.model
    assert first["output_config"] == {"effort": _SETTINGS.effort}
    assert first["fallbacks"] == "default"
    assert first["thinking"]["display"] == "updates"
    assert first["tools"] == _TOOLS
    user_blocks = first["messages"][0]["content"]
    assert "agent #5" in user_blocks[0]["text"]
    assert user_blocks[1]["text"] == "What agents do I have?"

    # The second call replays the first response unchanged plus the result.
    second_messages = client.requests[1]["messages"]
    assert second_messages[1]["content"][0]["signature"] == "sig1"
    assert second_messages[2]["content"][0]["tool_use_id"] == "toolu_1"

    saved = store[(11, 7, "c1")]
    assert [m["role"] for m in saved] == ["user", "assistant", "user", "assistant"]
    assert saved[-1]["content"] == [{"type": "text", "text": "You have one agent."}]


async def test_next_turn_appends_to_unchanged_history(store):
    prior = [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
        {
            "role": "assistant",
            "content": [{"type": "thinking", "thinking": "", "signature": "s"}],
        },
    ]
    store[(11, 7, "c1")] = copy.deepcopy(prior)
    client = _FakeClient(
        [
            _FakeStream(
                _text_events("ok"),
                _message([{"type": "text", "text": "ok"}], "end_turn"),
            )
        ]
    )

    await _collect(client, user=_user(), conversation_id="c1", message="again")

    sent = client.requests[0]["messages"]
    assert sent[:2] == prior
    assert sent[2] == {"role": "user", "content": [{"type": "text", "text": "again"}]}


async def test_truncated_tool_call_is_never_executed(store):
    tool_use = {
        "type": "tool_use",
        "id": "toolu_1",
        "name": "save_workflow",
        "input": {"workflow_id": 1},
    }
    client = _FakeClient([_FakeStream([], _message([tool_use], "max_tokens"))])
    run_tool_mock = AsyncMock()
    with patch.object(runner, "run_tool", run_tool_mock):
        events = await _collect(
            client, user=_user(), conversation_id="c1", message="rebuild it"
        )

    run_tool_mock.assert_not_awaited()
    assert events[-2]["type"] == "error"
    assert events[-1] == {"type": "done"}
    # Only the user's message is kept; the dangling tool_use is not.
    assert store[(11, 7, "c1")] == [
        {"role": "user", "content": [{"type": "text", "text": "rebuild it"}]}
    ]


async def test_unparseable_tool_json_retries_the_step(store):
    client = _FakeClient(
        [
            _FakeStream(
                _text_events("partial"), None, raise_exc=ValueError("bad json")
            ),
            _FakeStream(
                _text_events("done"),
                _message([{"type": "text", "text": "done"}], "end_turn"),
            ),
        ]
    )
    events = await _collect(client, user=_user(), conversation_id="c1", message="go")

    types = [e["type"] for e in events]
    assert types == ["step_start", "text", "step_retry", "step_start", "text", "done"]
    assert len(client.requests) == 2


async def test_api_error_ends_turn_with_readable_message(store):
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = anthropic.RateLimitError(
        "rate limited", response=httpx2.Response(429, request=request), body=None
    )
    client = _FakeClient([_FakeStream([], None, raise_exc=error)])

    events = await _collect(client, user=_user(), conversation_id="c1", message="go")

    assert events[-2] == {"type": "error", "message": runner.api_error_message(error)}
    assert events[-1] == {"type": "done"}


# ─── Route ────────────────────────────────────────────────────────────────


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: _user()
    return app


def _sse_events(body: str) -> list[dict[str, Any]]:
    return [
        json.loads(line[len("data: ") :])
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


def test_status_reports_missing_api_key():
    unconfigured = dataclasses.replace(_SETTINGS, api_key=None, key_source=None)
    with _settings_patch(unconfigured):
        response = TestClient(_app()).get("/agent-copilot/status")
    assert response.json() == {"enabled": True, "configured": False, "model": None}


def test_status_reports_ready():
    with _settings_patch():
        response = TestClient(_app()).get("/agent-copilot/status")
    assert response.json() == {
        "enabled": True,
        "configured": True,
        "model": _SETTINGS.model,
    }


def test_chat_returns_503_without_api_key():
    unconfigured = dataclasses.replace(_SETTINGS, api_key=None, key_source=None)
    with _settings_patch(unconfigured):
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi"}
        )
    assert response.status_code == 503
    assert "Settings" in response.json()["detail"]


def test_chat_returns_403_when_turned_off():
    with _settings_patch(dataclasses.replace(_SETTINGS, enabled=False)):
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi"}
        )
    assert response.status_code == 403


def test_chat_streams_events_and_releases_lock():
    async def fake_turn(**kwargs):
        assert kwargs["editor_workflow"] == (5, "Sales")
        assert kwargs["settings"] is _SETTINGS
        yield {"type": "text", "text": "Hello"}
        yield {"type": "done"}

    release = AsyncMock()
    consume = AsyncMock(return_value=True)
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.acquire_turn_lock", AsyncMock(return_value=True)
        ),
        patch("api.routes.agent_copilot.release_turn_lock", release),
        patch("api.routes.agent_copilot.consume_daily_message", consume),
        patch("api.routes.agent_copilot.run_turn", fake_turn),
        patch(
            "api.routes.agent_copilot.db_client.get_workflow",
            AsyncMock(return_value=SimpleNamespace(id=5, name="Sales")),
        ) as get_workflow,
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi", "workflow_id": 5}
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _sse_events(response.text)
    assert events[0]["type"] == "conversation"
    assert events[1:] == [{"type": "text", "text": "Hello"}, {"type": "done"}]
    get_workflow.assert_awaited_once_with(5, organization_id=11)
    release.assert_awaited_once_with(11, 7, events[0]["conversation_id"])
    consume.assert_awaited_once_with(11, _SETTINGS.daily_message_limit)


def test_chat_rejects_workflow_from_another_organization():
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.db_client.get_workflow",
            AsyncMock(return_value=None),
        ),
        patch("api.routes.agent_copilot.acquire_turn_lock", AsyncMock()) as acquire,
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi", "workflow_id": 99}
        )
    assert response.status_code == 404
    acquire.assert_not_awaited()


def test_chat_returns_409_while_a_reply_is_running():
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.acquire_turn_lock", AsyncMock(return_value=False)
        ),
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/chat",
            json={
                "message": "hi",
                "conversation_id": "6f1c2a52-8a0e-4c3e-9d3a-1f2b3c4d5e6f",
            },
        )
    assert response.status_code == 409


def test_chat_rejects_non_uuid_conversation_id():
    with _settings_patch():
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi", "conversation_id": "x:y"}
        )
    assert response.status_code == 422


# ─── History store (real Redis, as in CI) ─────────────────────────────────


async def test_history_round_trip_is_scoped_per_user_and_locked():
    from api.services.agent_copilot import history

    conversation_id = str(uuid.uuid4())
    messages = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]

    await history.save_messages(11, 7, conversation_id, messages)
    try:
        assert await history.load_messages(11, 7, conversation_id) == messages
        # Another user (or org) with the same conversation id sees nothing.
        assert await history.load_messages(11, 8, conversation_id) == []
        assert await history.load_messages(12, 7, conversation_id) == []

        assert await history.acquire_turn_lock(11, 7, conversation_id) is True
        assert await history.acquire_turn_lock(11, 7, conversation_id) is False
        await history.release_turn_lock(11, 7, conversation_id)
        assert await history.acquire_turn_lock(11, 7, conversation_id) is True
    finally:
        await history.release_turn_lock(11, 7, conversation_id)
        client = await history._client()
        await client.delete(history._key(11, 7, conversation_id))


def test_chat_returns_429_when_daily_limit_reached():
    release = AsyncMock()
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.acquire_turn_lock", AsyncMock(return_value=True)
        ),
        patch("api.routes.agent_copilot.release_turn_lock", release),
        patch(
            "api.routes.agent_copilot.consume_daily_message",
            AsyncMock(return_value=False),
        ),
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi"}
        )
    assert response.status_code == 429
    release.assert_awaited_once()


def test_chat_sends_keepalives_while_the_model_works():
    async def slow_turn(**kwargs):
        await asyncio.sleep(0.2)
        yield {"type": "done"}

    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.acquire_turn_lock", AsyncMock(return_value=True)
        ),
        patch("api.routes.agent_copilot.release_turn_lock", AsyncMock()),
        patch(
            "api.routes.agent_copilot.consume_daily_message",
            AsyncMock(return_value=True),
        ),
        patch("api.routes.agent_copilot.run_turn", slow_turn),
        patch("api.routes.agent_copilot._KEEPALIVE_SECONDS", 0.05),
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/chat", json={"message": "hi"}
        )
    assert ": keepalive" in response.text
    assert _sse_events(response.text)[-1] == {"type": "done"}


def test_conversation_endpoint_returns_transcript_or_404():
    stored = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
    load = AsyncMock(side_effect=[stored, []])
    conversation_id = "6f1c2a52-8a0e-4c3e-9d3a-1f2b3c4d5e6f"
    with patch("api.routes.agent_copilot.load_messages", load):
        client = TestClient(_app())
        found = client.get(f"/agent-copilot/conversations/{conversation_id}")
        missing = client.get(f"/agent-copilot/conversations/{conversation_id}")
        malformed = client.get("/agent-copilot/conversations/not-a-uuid")

    assert found.json() == {
        "conversation_id": conversation_id,
        "messages": [{"role": "user", "text": "hi"}],
    }
    load.assert_any_await(11, 7, conversation_id)
    assert missing.status_code == 404
    assert malformed.status_code == 404


def test_build_transcript_mirrors_the_live_stream():
    history = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "<editor_context>agent #5</editor_context>"},
                {"type": "text", "text": "Make it friendlier"},
            ],
        },
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "Reading it.", "signature": "s"},
                {
                    "type": "tool_use",
                    "id": "t1",
                    "name": "get_workflow_code",
                    "input": {},
                },
            ],
        },
        {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}],
        },
        {
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": "t2", "name": "save_workflow", "input": {}},
                {"type": "tool_use", "id": "t3", "name": "save_workflow", "input": {}},
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "t2",
                    "content": json.dumps(
                        {"saved": False, "error_code": "parse_error"}
                    ),
                },
                {
                    "type": "tool_result",
                    "tool_use_id": "t3",
                    "content": json.dumps(
                        {"saved": True, "workflow_id": 5, "name": "Sales"}
                    ),
                },
            ],
        },
        {"role": "assistant", "content": [{"type": "text", "text": "Done."}]},
    ]

    assert build_transcript(history) == [
        {"role": "user", "text": "Make it friendlier"},
        {
            "role": "assistant",
            "parts": [
                {"kind": "progress", "text": "Reading it."},
                {
                    "kind": "tool",
                    "id": "t1",
                    "name": "get_workflow_code",
                    "status": "ok",
                },
                {
                    "kind": "tool",
                    "id": "t2",
                    "name": "save_workflow",
                    "status": "error",
                },
                {
                    "kind": "tool",
                    "id": "t3",
                    "name": "save_workflow",
                    "status": "ok",
                    "workflowId": 5,
                    "workflowName": "Sales",
                },
                {"kind": "text", "text": "Done."},
            ],
        },
    ]


async def test_daily_message_limit_counts_per_organization():
    from api.services.agent_copilot import history

    org_id = 900000 + uuid.uuid4().int % 1000
    try:
        assert await history.consume_daily_message(org_id, 2) is True
        assert await history.consume_daily_message(org_id, 2) is True
        assert await history.consume_daily_message(org_id, 2) is False
        assert await history.consume_daily_message(org_id + 1, 2) is True
        assert await history.consume_daily_message(org_id, 0) is True
    finally:
        client = await history._client()
        for key in await client.keys(f"agent_copilot:quota:{org_id}*"):
            await client.delete(key)
        for key in await client.keys(f"agent_copilot:quota:{org_id + 1}*"):
            await client.delete(key)


# ─── Organization settings ────────────────────────────────────────────────


def test_resolve_settings_prefers_the_organizations_key_and_limit():
    from api.services.agent_copilot import settings as settings_mod

    with (
        patch.object(settings_mod, "ANTHROPIC_API_KEY", "sk-platform"),
        patch.object(settings_mod, "AGENT_COPILOT_DAILY_MESSAGE_LIMIT", 200),
    ):
        own = settings_mod.resolve_settings(
            {
                "api_key": "sk-org",
                "model": "claude-sonnet-5-5",
                "daily_message_limit": 1000,
            }
        )
        platform = settings_mod.resolve_settings({"daily_message_limit": 1000})
        platform_lower = settings_mod.resolve_settings({"daily_message_limit": 20})
        defaults = settings_mod.resolve_settings({})
        off = settings_mod.resolve_settings({"enabled": False})
        bad = settings_mod.resolve_settings({"model": "gpt-x", "effort": "turbo"})

    assert (own.api_key, own.key_source, own.model) == (
        "sk-org",
        "organization",
        "claude-sonnet-5-5",
    )
    # Their own key: their own limit, even above the platform cap.
    assert own.daily_message_limit == 1000
    # The platform key: the platform cap always applies; orgs may go lower.
    assert (platform.api_key, platform.key_source) == ("sk-platform", "platform")
    assert platform.daily_message_limit == 200
    assert platform_lower.daily_message_limit == 20
    assert defaults.model == "claude-opus-5-5" and defaults.enabled
    assert off.enabled is False and off.available is False
    assert (bad.model, bad.effort) == ("claude-opus-5-5", "medium")

    with patch.object(settings_mod, "ANTHROPIC_API_KEY", None):
        none = settings_mod.resolve_settings({})
    assert (none.api_key, none.key_source, none.available) == (None, None, False)
    # No key anywhere: the platform cap doesn't apply (there's no platform key).
    assert none.daily_message_limit == 0


def _settings_store(initial: dict | None = None):
    """Patch the route's settings storage with an in-memory dict."""
    store = {"value": dict(initial or {})}

    async def load(org_id):
        assert org_id == 11
        return dict(store["value"])

    async def save(org_id, value):
        assert org_id == 11
        store["value"] = dict(value)

    return store, (
        patch("api.routes.agent_copilot.load_stored_settings", load),
        patch("api.routes.agent_copilot.save_stored_settings", save),
    )


def test_settings_get_masks_the_api_key():
    store, (load, save) = _settings_store(
        {"api_key": "sk-ant-secret-1234", "model": "claude-sonnet-5-5"}
    )
    with load, save:
        body = TestClient(_app()).get("/agent-copilot/settings").json()

    assert body["api_key"] != "sk-ant-secret-1234"
    assert body["api_key"].endswith("1234")
    assert body["has_own_key"] is True
    assert body["model"] == "claude-sonnet-5-5"
    assert body["supported_models"] == ["claude-opus-5-5", "claude-sonnet-5-5"]


def test_settings_put_verifies_and_stores_a_new_key():
    store, (load, save) = _settings_store()
    verify = AsyncMock()
    with load, save, patch("api.routes.agent_copilot.verify_api_key", verify):
        response = TestClient(_app()).put(
            "/agent-copilot/settings",
            json={
                "enabled": True,
                "api_key": " sk-ant-new-key-9999 ",
                "model": "claude-opus-5-5",
                "effort": "high",
                "daily_message_limit": 75,
            },
        )

    assert response.status_code == 200
    verify.assert_awaited_once_with("sk-ant-new-key-9999", "claude-opus-5-5")
    assert store["value"] == {
        "enabled": True,
        "api_key": "sk-ant-new-key-9999",
        "model": "claude-opus-5-5",
        "effort": "high",
        "daily_message_limit": 75,
    }
    assert response.json()["effective_daily_message_limit"] == 75
    assert "9999" in response.json()["api_key"]
    assert response.json()["api_key"] != "sk-ant-new-key-9999"


def test_settings_put_with_masked_key_keeps_it_without_reverifying():
    from api.services.configuration.masking import mask_key

    store, (load, save) = _settings_store(
        {"api_key": "sk-ant-secret-1234", "model": "claude-opus-5-5"}
    )
    verify = AsyncMock()
    with load, save, patch("api.routes.agent_copilot.verify_api_key", verify):
        TestClient(_app()).put(
            "/agent-copilot/settings",
            json={
                "api_key": mask_key("sk-ant-secret-1234"),
                "model": "claude-opus-5-5",
                "effort": "low",
            },
        )

    verify.assert_not_awaited()
    assert store["value"]["api_key"] == "sk-ant-secret-1234"
    assert store["value"]["effort"] == "low"


def test_settings_put_rechecks_the_key_when_the_model_changes():
    from api.services.configuration.masking import mask_key

    store, (load, save) = _settings_store(
        {"api_key": "sk-ant-secret-1234", "model": "claude-opus-5-5"}
    )
    verify = AsyncMock()
    with load, save, patch("api.routes.agent_copilot.verify_api_key", verify):
        TestClient(_app()).put(
            "/agent-copilot/settings",
            json={
                "api_key": mask_key("sk-ant-secret-1234"),
                "model": "claude-sonnet-5-5",
            },
        )
    verify.assert_awaited_once_with("sk-ant-secret-1234", "claude-sonnet-5-5")


def test_settings_put_empty_key_removes_it():
    store, (load, save) = _settings_store({"api_key": "sk-ant-secret-1234"})
    with load, save:
        response = TestClient(_app()).put(
            "/agent-copilot/settings", json={"api_key": "", "model": "claude-opus-5-5"}
        )
    assert response.status_code == 200
    assert "api_key" not in store["value"]
    assert response.json()["has_own_key"] is False


def test_settings_put_rejects_an_invalid_key_without_saving():
    from api.services.agent_copilot import InvalidApiKeyError

    store, (load, save) = _settings_store({"model": "claude-opus-5-5"})
    verify = AsyncMock(
        side_effect=InvalidApiKeyError("Anthropic rejected this API key.")
    )
    with load, save, patch("api.routes.agent_copilot.verify_api_key", verify):
        response = TestClient(_app()).put(
            "/agent-copilot/settings",
            json={"api_key": "sk-bad", "model": "claude-opus-5-5"},
        )
    assert response.status_code == 400
    assert response.json()["detail"] == "Anthropic rejected this API key."
    assert store["value"] == {"model": "claude-opus-5-5"}


def test_settings_put_validates_model_effort_and_limit():
    store, (load, save) = _settings_store()
    with load, save:
        client = TestClient(_app())
        bad_model = client.put("/agent-copilot/settings", json={"model": "gpt-5"})
        bad_effort = client.put("/agent-copilot/settings", json={"effort": "turbo"})
        bad_limit = client.put(
            "/agent-copilot/settings", json={"daily_message_limit": -1}
        )
    assert [r.status_code for r in (bad_model, bad_effort, bad_limit)] == [
        422,
        422,
        422,
    ]


async def test_verify_api_key_maps_anthropic_errors():
    from api.services.agent_copilot import InvalidApiKeyError
    from api.services.agent_copilot import settings as settings_mod

    request = httpx2.Request("GET", "https://api.anthropic.com/v1/models/x")
    cases = [
        (
            anthropic.AuthenticationError(
                "bad", response=httpx2.Response(401, request=request), body=None
            ),
            "rejected",
        ),
        (
            anthropic.NotFoundError(
                "nf", response=httpx2.Response(404, request=request), body=None
            ),
            "can't use",
        ),
        (None, None),
    ]
    for error, expected in cases:
        client = MagicMock()
        client.models.retrieve = AsyncMock(side_effect=error)
        client.close = AsyncMock()
        with patch.object(
            settings_mod.anthropic, "AsyncAnthropic", return_value=client
        ):
            if expected is None:
                await settings_mod.verify_api_key("sk", "claude-opus-5-5")
            else:
                with pytest.raises(InvalidApiKeyError, match=expected):
                    await settings_mod.verify_api_key("sk", "claude-opus-5-5")
        client.close.assert_awaited_once()


def test_runner_keeps_one_client_per_api_key():
    from api.services.agent_copilot import client as client_mod

    client_mod._clients.clear()
    a1 = client_mod.get_client("sk-a")
    a2 = client_mod.get_client("sk-a")
    b = client_mod.get_client("sk-b")
    assert a1 is a2 and a1 is not b
    client_mod._clients.clear()
