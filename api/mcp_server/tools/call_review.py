"""MCP tools for reviewing how an agent's calls went.

`get_call_stats` → where an agent struggles, `list_calls` → which calls to
look at, `get_call` → the transcript, collected data, and QA of one call.
All reads are scoped to the caller's organization.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from api.db import db_client
from api.mcp_server.auth import authenticate_mcp_request
from api.mcp_server.tracing import traced_tool
from api.services.workflow.call_review import (
    call_detail,
    compute_call_stats,
    summarize_call,
)

_MAX_DAYS = 90
_MAX_LIST = 100
_MAX_STATS_CALLS = 500


async def _require_workflow(workflow_id: int, organization_id: int) -> Any:
    workflow = await db_client.get_workflow(
        workflow_id, organization_id=organization_id
    )
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow {workflow_id} not found")
    return workflow


def _since(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=max(1, min(days, _MAX_DAYS)))


@traced_tool
async def get_call_stats(workflow_id: int, days: int = 7) -> dict[str, Any]:
    """Summarize an agent's recent calls to find where it struggles.

    Covers up to the 500 most recent calls in the last `days` (1-90).
    Returns call count, completed count, average duration, short calls
    (likely hang-ups; with their call_ids), outcome (disposition) counts,
    and QA results: average score (1-10), most common QA tags, and
    low-scoring call_ids. Use it first when reviewing an agent, then read
    the problem calls with `get_call`.
    """
    user = await authenticate_mcp_request()
    org_id = user.selected_organization_id
    workflow = await _require_workflow(workflow_id, org_id)
    runs = await db_client.get_workflow_runs_for_review(
        workflow_id, org_id, since=_since(days), limit=_MAX_STATS_CALLS
    )
    return {
        "workflow_id": workflow_id,
        "agent_name": workflow.name,
        "days": max(1, min(days, _MAX_DAYS)),
        **compute_call_stats(runs),
    }


@traced_tool
async def list_calls(
    workflow_id: int,
    days: int = 7,
    limit: int = 20,
    outcome: str | None = None,
) -> dict[str, Any]:
    """List an agent's recent calls, newest first.

    Each call has call_id, started_at, duration_seconds, outcome
    (disposition, e.g. XFER or UNKNOWN), state, call_type, tags, and its
    QA result (score 1-10, tags, short summary) when QA ran. Filter with
    `outcome` (exact match) and look back `days` (1-90); `limit` is 1-100.
    Read a call's transcript with `get_call`.
    """
    user = await authenticate_mcp_request()
    org_id = user.selected_organization_id
    await _require_workflow(workflow_id, org_id)
    limit = max(1, min(limit, _MAX_LIST))
    # Over-fetch when filtering so the filter still fills the page.
    runs = await db_client.get_workflow_runs_for_review(
        workflow_id,
        org_id,
        since=_since(days),
        limit=_MAX_STATS_CALLS if outcome else limit,
    )
    calls = [summarize_call(run) for run in runs]
    if outcome:
        calls = [c for c in calls if c["outcome"].lower() == outcome.lower()]
    return {"workflow_id": workflow_id, "calls": calls[:limit]}


@traced_tool
async def get_call(call_id: int) -> dict[str, Any]:
    """Read one call: transcript, data the agent collected, and QA results.

    Returns call_id, workflow_id, started_at, duration_seconds, outcome,
    steps_visited (the agent steps the call went through), extracted_data,
    per-step QA (score 1-10, tags, summary, sentiment), runtime `errors`
    (speech/LLM/voice failures during the call), and the transcript
    with timestamps (`assistant` is the agent, `user` is the caller,
    `tool_call` marks tool use). Long transcripts are truncated
    (`transcript_truncated: true`).
    """
    user = await authenticate_mcp_request()
    run = await db_client.get_workflow_run(
        call_id, organization_id=user.selected_organization_id
    )
    if not run:
        raise HTTPException(status_code=404, detail=f"Call {call_id} not found")
    return call_detail(run)
