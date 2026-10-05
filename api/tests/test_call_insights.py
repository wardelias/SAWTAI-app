"""Tests for AI call insights (Overview page): report normalization, the
generation flow against a scripted Anthropic client, the routes, the
Redis-stored report, and the org-wide recent-calls query."""

from __future__ import annotations

import copy
import dataclasses
import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from anthropic.types.beta import BetaMessage
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.db.models import OrganizationModel, UserModel
from api.routes.agent_copilot import router
from api.services.agent_copilot import insights as insights_mod
from api.services.agent_copilot.insights import (
    INSIGHTS_SCHEMA,
    InsightsError,
    InsightsLimitError,
    generate_insights,
    normalize_report,
)
from api.services.agent_copilot.settings import EffectiveSettings
from api.services.auth.depends import get_user

SETTINGS = EffectiveSettings(
    enabled=True,
    api_key="sk-ant-org",
    key_source="organization",
    model="claude-opus-5-5",
    effort="medium",
    daily_message_limit=50,
)

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def _calls():
    return [
        {
            "call_id": 11,
            "agent_id": 1,
            "agent": "Reception",
            "started_at": "2026-10-01T12:00:00+00:00",
        },
        {
            "call_id": 12,
            "agent_id": 2,
            "agent": "Sales",
            "started_at": "2026-10-01T13:00:00+00:00",
        },
        {
            "call_id": 13,
            "agent_id": 1,
            "agent": "Reception",
            "started_at": "2026-10-01T11:00:00+00:00",
        },
    ]


def _issue(**overrides):
    issue = {
        "title": "Greeting too long",
        "severity": "high",
        "what_happened": "Callers hung up during the greeting.",
        "evidence": '"Uh, hello?"',
        "call_ids": [11, 13],
        "needs_change": True,
        "suggestion": "Keep the greeting to one sentence.",
    }
    issue.update(overrides)
    return issue


# ─── Normalization ────────────────────────────────────────────────────────


def test_normalize_report_keeps_only_analyzed_calls_and_derives_agents():
    data = {
        "summary": " Mostly fine. ",
        "issues": [
            _issue(title="Minor polish", severity="low", call_ids=[12]),
            _issue(call_ids=[11, 999, 11, 13]),
            _issue(title="Odd severity", severity="urgent", call_ids=[]),
            _issue(title="  ", call_ids=[12]),
        ],
        "working_well": ["a", "b", "c", "d"],
    }
    report = normalize_report(data, _calls())

    assert report["summary"] == "Mostly fine."
    # Sorted by severity; unknown severities become medium; empty titles dropped.
    assert [i["title"] for i in report["issues"]] == [
        "Greeting too long",
        "Odd severity",
        "Minor polish",
    ]
    top = report["issues"][0]
    # Unknown (999) and duplicate ids are removed; agents come from the calls.
    assert top["call_ids"] == [11, 13]
    assert top["agents"] == [{"id": 1, "name": "Reception"}]
    assert report["issues"][1]["severity"] == "medium"
    assert report["issues"][2]["agents"] == [{"id": 2, "name": "Sales"}]
    assert report["working_well"] == ["a", "b", "c"]
    assert report["calls_analyzed"] == 3
    assert report["calls"][1] == {
        "call_id": 12,
        "agent_id": 2,
        "agent": "Sales",
        "outcome": None,
        "started_at": "2026-10-01T13:00:00+00:00",
    }
    assert report["period"] == {
        "from": "2026-10-01T11:00:00+00:00",
        "to": "2026-10-01T13:00:00+00:00",
    }


# ─── Generation ───────────────────────────────────────────────────────────


def _run(run_id, workflow_id=1):
    return SimpleNamespace(
        id=run_id,
        workflow_id=workflow_id,
        created_at=T0 - timedelta(minutes=run_id),
        state="completed",
        call_type="inbound",
        usage_info={"call_duration_seconds": 30},
        gathered_context={"mapped_call_disposition": "HANGUP"},
        annotations={},
        logs={
            "realtime_feedback_events": [
                {
                    "type": "rtf-bot-text",
                    "timestamp": T0.isoformat(),
                    "payload": {"text": "Hello " * 2000},
                },
            ]
        },
    )


def _message(text: str, stop_reason: str = "end_turn") -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": [{"type": "text", "text": text}],
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 100, "output_tokens": 50},
        }
    )


class _FakeStream:
    def __init__(self, final):
        self._final = final

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self._final


class _FakeClient:
    def __init__(self, final):
        self.requests: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))
        self._final = final

    def _stream(self, **kwargs):
        self.requests.append(copy.deepcopy(kwargs))
        return _FakeStream(self._final)


def _patches(rows, client, consume=True):
    return (
        patch.object(
            insights_mod.db_client,
            "get_recent_completed_runs_for_org",
            AsyncMock(return_value=rows),
        ),
        patch.object(insights_mod, "get_client", return_value=client),
        patch.object(
            insights_mod, "consume_daily_message", AsyncMock(return_value=consume)
        ),
    )


async def test_generate_insights_sends_calls_and_normalizes_the_result():
    payload = {
        "summary": "Callers hang up early.",
        "issues": [_issue(call_ids=[1, 2])],
        "working_well": ["Polite"],
    }
    client = _FakeClient(_message(json.dumps(payload)))
    rows, get_client_patch, consume_patch = _patches(
        [(_run(1), "Reception"), (_run(2, workflow_id=2), "Sales")], client
    )
    with rows as rows_mock, get_client_patch, consume_patch as consume_mock:
        report = await generate_insights(11, SETTINGS)

    rows_mock.assert_awaited_once_with(11, 10)
    consume_mock.assert_awaited_once_with(11, 50)
    request = client.requests[0]
    assert request["model"] == "claude-opus-5-5"
    assert request["fallbacks"] == "default"
    assert request["output_config"] == {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": INSIGHTS_SCHEMA},
    }
    sent = json.loads(request["messages"][0]["content"])["calls"]
    assert [(c["call_id"], c["agent"]) for c in sent] == [
        (1, "Reception"),
        (2, "Sales"),
    ]
    # Long transcripts are cut to bound the request size.
    assert sent[0]["transcript"].endswith("[transcript cut]")
    assert len(sent[0]["transcript"]) < 6100

    assert report["summary"] == "Callers hang up early."
    assert report["issues"][0]["agents"] == [
        {"id": 1, "name": "Reception"},
        {"id": 2, "name": "Sales"},
    ]
    assert report["calls_analyzed"] == 2
    assert report["model"] == "claude-opus-5-5"
    assert len(report["id"]) == 12 and report["generated_at"]


async def test_no_calls_means_no_model_call_and_no_quota_used():
    client = _FakeClient(_message("{}"))
    rows, get_client_patch, consume_patch = _patches([], client)
    with rows, get_client_patch, consume_patch as consume_mock:
        report = await generate_insights(11, SETTINGS)
    assert client.requests == []
    consume_mock.assert_not_awaited()
    assert report["calls_analyzed"] == 0 and report["issues"] == []


async def test_daily_limit_stops_before_the_model_call():
    client = _FakeClient(_message("{}"))
    rows, get_client_patch, consume_patch = _patches(
        [(_run(1), "Reception")], client, consume=False
    )
    with rows, get_client_patch, consume_patch:
        with pytest.raises(InsightsLimitError):
            await generate_insights(11, SETTINGS)
    assert client.requests == []


@pytest.mark.parametrize(
    "final, message",
    [
        (_message("", "refusal"), "declined"),
        (_message('{"summary": "x"', "max_tokens"), "too long"),
        (_message("not json"), "incomplete"),
    ],
)
async def test_bad_model_results_raise_readable_errors(final, message):
    rows, get_client_patch, consume_patch = _patches(
        [(_run(1), "Reception")], _FakeClient(final)
    )
    with rows, get_client_patch, consume_patch:
        with pytest.raises(InsightsError, match=message):
            await generate_insights(11, SETTINGS)


# ─── Routes ───────────────────────────────────────────────────────────────


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=7, selected_organization_id=11
    )
    return app


def _route_patches(settings=SETTINGS, lock=True, generate=None):
    return (
        patch(
            "api.routes.agent_copilot.get_effective_settings",
            AsyncMock(return_value=settings),
        ),
        patch(
            "api.routes.agent_copilot.acquire_insights_lock",
            AsyncMock(return_value=lock),
        ),
        patch("api.routes.agent_copilot.release_insights_lock", AsyncMock()),
        patch(
            "api.routes.agent_copilot.generate_insights",
            generate or AsyncMock(return_value={"id": "r1"}),
        ),
        patch("api.routes.agent_copilot.save_insights_report", AsyncMock()),
    )


def test_get_insights_returns_the_stored_report():
    with patch(
        "api.routes.agent_copilot.load_insights_report",
        AsyncMock(return_value={"id": "r1"}),
    ) as load:
        response = TestClient(_app()).get("/agent-copilot/insights")
    assert response.json() == {"report": {"id": "r1"}}
    load.assert_awaited_once_with(11)


def test_post_insights_generates_saves_and_releases_the_lock():
    s, lock, release, generate, save = _route_patches()
    with s, lock, release as release_mock, generate as generate_mock, save as save_mock:
        response = TestClient(_app()).post("/agent-copilot/insights")
    assert response.status_code == 200
    assert response.json() == {"report": {"id": "r1"}}
    generate_mock.assert_awaited_once_with(11, SETTINGS)
    save_mock.assert_awaited_once_with(11, {"id": "r1"})
    release_mock.assert_awaited_once_with(11)


@pytest.mark.parametrize(
    "settings, lock, error, status",
    [
        (dataclasses.replace(SETTINGS, enabled=False), True, None, 403),
        (dataclasses.replace(SETTINGS, api_key=None, key_source=None), True, None, 503),
        (SETTINGS, False, None, 409),
        (SETTINGS, True, InsightsLimitError("limit"), 429),
        (SETTINGS, True, InsightsError("boom"), 502),
    ],
)
def test_post_insights_errors(settings, lock, error, status):
    generate = AsyncMock(side_effect=error) if error else None
    s, lock_p, release, generate_p, save = _route_patches(settings, lock, generate)
    with s, lock_p, release as release_mock, generate_p, save as save_mock:
        response = TestClient(_app()).post("/agent-copilot/insights")
    assert response.status_code == status
    save_mock.assert_not_awaited()
    # The lock is released whenever it was taken.
    assert release_mock.await_count == (1 if status in (429, 502) else 0)


# ─── Storage (real Redis) and query (real Postgres) ───────────────────────


async def test_report_storage_round_trip_and_lock():
    from api.services.agent_copilot import history

    org_id = 800000 + uuid.uuid4().int % 1000
    try:
        assert await history.load_insights_report(org_id) is None
        await history.save_insights_report(org_id, {"id": "abc", "issues": []})
        assert await history.load_insights_report(org_id) == {"id": "abc", "issues": []}
        assert await history.acquire_insights_lock(org_id) is True
        assert await history.acquire_insights_lock(org_id) is False
        await history.release_insights_lock(org_id)
        assert await history.acquire_insights_lock(org_id) is True
    finally:
        client = await history._client()
        await client.delete(
            history._insights_key(org_id), history._insights_key(org_id) + ":lock"
        )


async def test_recent_completed_runs_query_is_org_scoped(db_session, async_session):
    orgs, users = [], []
    for suffix in ("x", "y"):
        org = OrganizationModel(provider_id=f"insights-org-{suffix}")
        async_session.add(org)
        await async_session.flush()
        user = UserModel(
            provider_id=f"insights-user-{suffix}", selected_organization_id=org.id
        )
        async_session.add(user)
        await async_session.flush()
        orgs.append(org)
        users.append(user)

    graph = {"nodes": [], "edges": []}
    wf_a = await db_session.create_workflow(
        name="Alpha",
        workflow_definition=graph,
        user_id=users[0].id,
        organization_id=orgs[0].id,
    )
    wf_b = await db_session.create_workflow(
        name="Beta",
        workflow_definition=graph,
        user_id=users[0].id,
        organization_id=orgs[0].id,
    )
    wf_other = await db_session.create_workflow(
        name="Other",
        workflow_definition=graph,
        user_id=users[1].id,
        organization_id=orgs[1].id,
    )

    async def make_run(wf, user, org, completed):
        run = await db_session.create_workflow_run(
            name="r",
            workflow_id=wf.id,
            mode="twilio",
            user_id=user.id,
            organization_id=org.id,
        )
        if completed:
            await db_session.update_workflow_run(run.id, is_completed=True)
        return run.id

    a1 = await make_run(wf_a, users[0], orgs[0], True)
    await make_run(wf_a, users[0], orgs[0], False)  # still in progress: excluded
    b1 = await make_run(wf_b, users[0], orgs[0], True)
    await make_run(wf_other, users[1], orgs[1], True)  # other org: excluded

    rows = await db_session.get_recent_completed_runs_for_org(orgs[0].id, limit=10)
    assert [(run.id, name) for run, name in rows] == [(b1, "Beta"), (a1, "Alpha")]
    assert (
        len(await db_session.get_recent_completed_runs_for_org(orgs[0].id, limit=1))
        == 1
    )
