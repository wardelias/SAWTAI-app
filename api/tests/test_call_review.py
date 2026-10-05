"""Tests for call review: the summarizing functions, the MCP tools, and the
org-scoped DB query behind them."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from api.db.models import OrganizationModel, UserModel
from api.mcp_server.auth import acting_as
from api.mcp_server.tools.call_review import get_call, get_call_stats, list_calls
from api.services.workflow.call_review import (
    call_detail,
    compute_call_stats,
    summarize_call,
)

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def _qa(score, tags, summary="Caller was confused by pricing."):
    return {
        "qa_7": {
            "node_results": {
                "n1": {
                    "node_name": "Greeting",
                    "score": score,
                    "tags": tags,
                    "summary": summary,
                    "overall_sentiment": "negative",
                },
                "n2": {"node_name": "Broken", "error": "llm failed"},
            },
            "model": "gpt-x",
        },
        "webhook_1": {"status": "ok"},
    }


def _run(run_id, *, duration=None, outcome=None, score=None, tags=(), completed=True):
    return {
        "id": run_id,
        "created_at": T0 - timedelta(minutes=run_id),
        "state": SimpleNamespace(value="completed"),
        "is_completed": completed,
        "call_type": "inbound",
        "mode": "twilio",
        "usage_info": {"call_duration_seconds": str(duration)}
        if duration is not None
        else {},
        "gathered_context": {"mapped_call_disposition": outcome} if outcome else {},
        "annotations": _qa(score, list(tags)) if score is not None else {},
    }


# ─── Pure functions ───────────────────────────────────────────────────────


def test_summarize_call_extracts_outcome_duration_and_qa():
    summary = summarize_call(
        _run(3, duration=42.25, outcome="XFER", score=4, tags=["confused"])
    )

    assert summary == {
        "call_id": 3,
        "started_at": (T0 - timedelta(minutes=3)).isoformat(),
        "duration_seconds": 42.2,
        "outcome": "XFER",
        "state": "completed",
        "call_type": "inbound",
        "tags": [],
        "qa": {
            "score": 4.0,
            "tags": ["confused"],
            "summary": "Caller was confused by pricing.",
        },
    }
    # No QA, no duration, no disposition: explicit nulls / UNKNOWN.
    bare = summarize_call(_run(4))
    assert (bare["qa"], bare["duration_seconds"], bare["outcome"]) == (
        None,
        None,
        "UNKNOWN",
    )


def test_compute_call_stats_points_at_problems():
    runs = [
        _run(1, duration=8, outcome="HANGUP", score=3, tags=["confused", "repeated"]),
        _run(2, duration=120, outcome="XFER", score=9, tags=["resolved"]),
        _run(3, duration=5, outcome="HANGUP", score=None, completed=False),
        _run(4, duration=60, outcome="XFER", score=5, tags=["confused"]),
    ]
    stats = compute_call_stats(runs)

    assert stats["calls"] == 4
    assert stats["completed"] == 3
    assert stats["avg_duration_seconds"] == 48.2
    assert stats["short_calls"] == {
        "count": 2,
        "threshold_seconds": 15,
        "call_ids": [1, 3],
    }
    assert stats["outcomes"] == {"HANGUP": 2, "XFER": 2}
    assert stats["qa"] == {
        "calls_with_qa": 3,
        "avg_score": 5.7,
        "top_tags": {"confused": 2, "repeated": 1, "resolved": 1},
        "low_score_call_ids": [1, 4],
    }
    assert compute_call_stats([])["avg_duration_seconds"] is None


def test_call_detail_renders_transcript_data_qa_and_errors():
    def ev(t, kind, payload, **extra):
        return {
            "type": kind,
            "timestamp": (T0 + timedelta(seconds=t)).isoformat(),
            "payload": payload,
            **extra,
        }

    run = SimpleNamespace(
        id=9,
        workflow_id=5,
        created_at=T0,
        state="completed",
        call_type="inbound",
        usage_info={"call_duration_seconds": 31},
        gathered_context={
            "mapped_call_disposition": "XFER",
            "call_id": "CA123",
            "trace_url": "https://trace",
            "nodes_visited": ["Greeting", "Qualify"],
            "customer_name": "Dana",
        },
        annotations=_qa(6, ["pricing"]),
        logs={
            "realtime_feedback_events": [
                ev(0, "rtf-bot-text", {"text": "Hi, how can I help?"}),
                ev(
                    3,
                    "rtf-user-transcription",
                    {"text": "How much is it?", "final": True},
                ),
                ev(4, "rtf-user-transcription", {"text": "How mu", "final": False}),
                ev(6, "rtf-function-call-start", {"function_name": "lookup_price"}),
                ev(
                    8,
                    "rtf-pipeline-error",
                    {"error": "TTS timeout", "fatal": False, "processor": "tts"},
                    node_name="Qualify",
                ),
            ]
        },
    )
    detail = call_detail(run)

    assert detail["outcome"] == "XFER"
    assert detail["steps_visited"] == ["Greeting", "Qualify"]
    # System fields stay out of the collected data.
    assert detail["extracted_data"] == {"customer_name": "Dana"}
    assert detail["qa"] == [
        {
            "step": "Greeting",
            "score": 6,
            "tags": ["pricing"],
            "summary": "Caller was confused by pricing.",
            "sentiment": "negative",
        }
    ]
    assert detail["errors"] == [
        {"error": "TTS timeout", "fatal": False, "processor": "tts", "step": "Qualify"}
    ]
    assert detail["transcript"].splitlines() == [
        "[0.0s] assistant: Hi, how can I help?",
        "[3.0s] user: How much is it?",
        "[6.0s] [tool_call]: lookup_price",
    ]
    assert detail["transcript_truncated"] is False


def test_call_detail_handles_calls_without_events():
    run = SimpleNamespace(
        id=1,
        workflow_id=1,
        created_at=None,
        state=None,
        call_type=None,
        usage_info=None,
        gathered_context=None,
        annotations=None,
        logs=None,
    )
    detail = call_detail(run)
    assert detail["transcript"] == "(no transcript recorded for this call)"
    assert detail["qa"] == [] and detail["errors"] == []


# ─── MCP tools: org scoping ───────────────────────────────────────────────


def _user(org_id=11):
    user = MagicMock()
    user.id = 7
    user.selected_organization_id = org_id
    return user


async def test_tools_scope_every_read_to_the_callers_organization():
    runs = [_run(1, duration=8, outcome="HANGUP"), _run(2, duration=90, outcome="XFER")]
    get_workflow = AsyncMock(return_value=SimpleNamespace(id=5, name="Sales"))
    review_query = AsyncMock(return_value=runs)
    with (
        patch("api.mcp_server.tools.call_review.db_client.get_workflow", get_workflow),
        patch(
            "api.mcp_server.tools.call_review.db_client.get_workflow_runs_for_review",
            review_query,
        ),
        acting_as(_user(org_id=11)),
    ):
        stats = await get_call_stats(5, days=500)
        listed = await list_calls(5, limit=1)
        hangups = await list_calls(5, outcome="hangup")

    get_workflow.assert_awaited_with(5, organization_id=11)
    for call in review_query.await_args_list:
        assert call.args[:2] == (5, 11)
    # days is clamped to 90.
    assert (
        stats["days"] == 90 and stats["agent_name"] == "Sales" and stats["calls"] == 2
    )
    assert [c["call_id"] for c in listed["calls"]] == [1]
    assert [c["call_id"] for c in hangups["calls"]] == [1]


async def test_tools_404_for_another_organizations_agent_or_call():
    with (
        patch(
            "api.mcp_server.tools.call_review.db_client.get_workflow",
            AsyncMock(return_value=None),
        ),
        patch(
            "api.mcp_server.tools.call_review.db_client.get_workflow_run",
            AsyncMock(return_value=None),
        ) as get_run,
        acting_as(_user(org_id=11)),
    ):
        with pytest.raises(HTTPException) as stats_err:
            await get_call_stats(99)
        with pytest.raises(HTTPException) as call_err:
            await get_call(1234)

    assert stats_err.value.status_code == 404
    assert call_err.value.status_code == 404
    get_run.assert_awaited_once_with(1234, organization_id=11)


# ─── DB query (real Postgres) ─────────────────────────────────────────────


async def test_review_query_is_org_scoped_newest_first_and_windowed(
    db_session, async_session
):
    orgs, users = [], []
    for suffix in ("a", "b"):
        org = OrganizationModel(provider_id=f"call-review-org-{suffix}")
        async_session.add(org)
        await async_session.flush()
        user = UserModel(
            provider_id=f"call-review-user-{suffix}", selected_organization_id=org.id
        )
        async_session.add(user)
        await async_session.flush()
        orgs.append(org)
        users.append(user)

    graph = {"nodes": [], "edges": []}
    wf = await db_session.create_workflow(
        name="Review me",
        workflow_definition=graph,
        user_id=users[0].id,
        organization_id=orgs[0].id,
    )
    run_ids = []
    for i in range(3):
        run = await db_session.create_workflow_run(
            name=f"run {i}",
            workflow_id=wf.id,
            mode="smallwebrtc",
            user_id=users[0].id,
            organization_id=orgs[0].id,
        )
        await db_session.update_workflow_run(
            run.id,
            usage_info={"call_duration_seconds": 10 + i},
            annotations=_qa(5 + i, ["t"]),
            gathered_context={"mapped_call_disposition": "XFER"},
        )
        run_ids.append(run.id)

    since = datetime.now(UTC) - timedelta(days=1)
    rows = await db_session.get_workflow_runs_for_review(
        wf.id, orgs[0].id, since=since, limit=2
    )
    assert [r["id"] for r in rows] == sorted(run_ids, reverse=True)[:2]
    assert rows[0]["usage_info"] == {"call_duration_seconds": 12}
    assert rows[0]["gathered_context"]["mapped_call_disposition"] == "XFER"
    assert "logs" not in rows[0]

    # Another organization sees nothing, and the time window applies.
    assert (
        await db_session.get_workflow_runs_for_review(
            wf.id, orgs[1].id, since=since, limit=10
        )
        == []
    )
    future = datetime.now(UTC) + timedelta(days=1)
    assert (
        await db_session.get_workflow_runs_for_review(
            wf.id, orgs[0].id, since=future, limit=10
        )
        == []
    )
