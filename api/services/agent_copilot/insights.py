"""Call insights: analyze an organization's most recent calls with Claude.

Reads the last completed calls across all agents (transcripts, outcomes,
QA results, runtime errors) and asks Claude, through structured outputs,
for the issues callers ran into, with evidence and a concrete fix for
each. The latest report is stored per organization so the Overview page
can show it without re-running the analysis on every visit.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import anthropic
from loguru import logger

from api.db import db_client
from api.services.agent_copilot.client import (
    api_error_detail,
    api_error_message,
    get_client,
    remember_compat_request,
    uses_compat_request,
)
from api.services.agent_copilot.history import consume_daily_message
from api.services.agent_copilot.settings import EffectiveSettings
from api.services.workflow.call_review import call_detail

CALLS_TO_ANALYZE = 10
_TRANSCRIPT_CHARS_PER_CALL = 6_000
_MAX_TOKENS = 32_000
_MAX_ISSUES = 8
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}

INSIGHTS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "what_happened": {"type": "string"},
                    "evidence": {"type": "string"},
                    "call_ids": {"type": "array", "items": {"type": "integer"}},
                    "needs_change": {"type": "boolean"},
                    "suggestion": {"type": "string"},
                },
                "required": [
                    "title",
                    "severity",
                    "what_happened",
                    "evidence",
                    "call_ids",
                    "needs_change",
                    "suggestion",
                ],
                "additionalProperties": False,
            },
        },
        "working_well": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "issues", "working_well"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = """\
You review a business's most recent phone calls handled by its AI voice agents and report what callers struggled with, so the owner can fix it.

The user message is JSON with the calls. Each has the agent that handled it, outcome, duration, the steps it went through, QA results (when the business runs QA), runtime errors, and the transcript (`assistant` is the voice agent, `user` is the caller).

Return:
- summary: 2-3 plain sentences on how these calls went overall.
- issues: problems callers actually ran into, most impactful first; merge duplicates. Report only what the calls show. For each issue:
  - title: short and specific, e.g. "Agent can't answer pricing questions".
  - severity: high = calls failed or callers left frustrated; medium = friction but the call recovered; low = polish.
  - what_happened: what the caller experienced, in 1-2 sentences.
  - evidence: one short quote or concrete detail from a transcript.
  - call_ids: the calls that show it.
  - needs_change: true when changing the agent (its instructions, steps, transfer rules, or knowledge) would fix it; false when the cause is outside the agent (a provider outage, a wrong number).
  - suggestion: the concrete change, written as an instruction, e.g. "In the greeting, keep it to one sentence and ask how you can help right away." When needs_change is false, say what the business should do instead.
- working_well: up to 3 short notes on what the calls show is working.

If the calls show no real problems, return an empty issues list. Never invent calls, quotes, or numbers. Write for a business owner: no technical jargon such as nodes, edges, prompts-as-code, or JSON.
"""


class InsightsError(Exception):
    """The analysis couldn't be produced; the message is user-facing."""


class InsightsLimitError(InsightsError):
    """The organization's daily AI Assistant allowance is used up."""


def _call_digest(run: Any, agent_name: str) -> dict[str, Any]:
    detail = call_detail(run)
    transcript = detail.pop("transcript")
    if len(transcript) > _TRANSCRIPT_CHARS_PER_CALL:
        transcript = transcript[:_TRANSCRIPT_CHARS_PER_CALL] + "\n[transcript cut]"
    detail.pop("transcript_truncated", None)
    return {
        **detail,
        "agent_id": run.workflow_id,
        "agent": agent_name,
        "transcript": transcript,
    }


def normalize_report(
    data: dict[str, Any], calls: list[dict[str, Any]]
) -> dict[str, Any]:
    """Keep only references to analyzed calls and derive agents from them.

    The model's call ids are checked against the calls it was given, and
    the agents an issue concerns come from those calls rather than from
    the model, so links in the UI always point at real, in-scope records.
    """
    agents_by_call = {c["call_id"]: (c["agent_id"], c["agent"]) for c in calls}
    issues = []
    for item in (data.get("issues") or [])[:_MAX_ISSUES]:
        call_ids = list(
            dict.fromkeys(i for i in item.get("call_ids") or [] if i in agents_by_call)
        )
        agents = list(dict.fromkeys(agents_by_call[i] for i in call_ids))
        severity = item.get("severity")
        issues.append(
            {
                "title": str(item.get("title", "")).strip(),
                "severity": severity if severity in _SEVERITY_ORDER else "medium",
                "what_happened": str(item.get("what_happened", "")).strip(),
                "evidence": str(item.get("evidence", "")).strip(),
                "suggestion": str(item.get("suggestion", "")).strip(),
                "needs_change": bool(item.get("needs_change")),
                "call_ids": call_ids,
                "agents": [{"id": aid, "name": name} for aid, name in agents],
            }
        )
    issues.sort(key=lambda i: _SEVERITY_ORDER[i["severity"]])
    started = [c["started_at"] for c in calls if c.get("started_at")]
    return {
        "summary": str(data.get("summary", "")).strip(),
        "issues": [i for i in issues if i["title"]],
        "working_well": [str(w) for w in (data.get("working_well") or [])][:3],
        "calls_analyzed": len(calls),
        "call_ids": [c["call_id"] for c in calls],
        # For linking each call to its page in the UI.
        "calls": [
            {
                "call_id": c["call_id"],
                "agent_id": c["agent_id"],
                "agent": c["agent"],
                "outcome": c.get("outcome"),
                "started_at": c.get("started_at"),
            }
            for c in calls
        ],
        "period": {"from": min(started), "to": max(started)} if started else None,
    }


def _new_report(**fields: Any) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:12],
        "generated_at": datetime.now(UTC).isoformat(),
        **fields,
    }


async def generate_insights(
    organization_id: int, settings: EffectiveSettings
) -> dict[str, Any]:
    """Analyze the organization's latest calls and return a new report.

    Caller checks that the assistant is available and holds the insights
    lock. Raises InsightsError (or InsightsLimitError) with a readable
    message on failure.
    """
    rows = await db_client.get_recent_completed_runs_for_org(
        organization_id, CALLS_TO_ANALYZE
    )
    if not rows:
        return _new_report(
            model=None,
            summary="There are no completed calls to analyze yet. Make a few test or live calls, then run the analysis.",
            issues=[],
            working_well=[],
            calls_analyzed=0,
            call_ids=[],
            calls=[],
            period=None,
        )

    if not await consume_daily_message(organization_id, settings.daily_message_limit):
        raise InsightsLimitError(
            "Your organization has reached today's AI Assistant limit. It resets at midnight UTC."
        )

    calls = [_call_digest(run, name) for run, name in rows]
    assert settings.api_key is not None, "caller checks settings.available"
    client = get_client(settings.api_key)
    body = json.dumps({"calls": calls}, default=str)

    async def request(compat: bool) -> Any:
        # Compat mode drops the beta-gated refusal fallback for accounts or
        # models that reject it (see runner._request_options).
        extra = (
            {}
            if compat
            else {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        )
        async with client.beta.messages.stream(
            model=settings.model,
            max_tokens=_MAX_TOKENS,
            output_config={
                "effort": settings.effort,
                "format": {"type": "json_schema", "schema": INSIGHTS_SCHEMA},
            },
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": body}],
            **extra,
        ) as stream:
            return await stream.get_final_message()

    compat = uses_compat_request(settings.api_key, settings.model)
    try:
        try:
            response = await request(compat)
        except anthropic.BadRequestError as e:
            if compat:
                raise
            logger.warning(
                f"call insights request rejected (org {organization_id}, model "
                f"{settings.model}): {api_error_detail(e)}; retrying without "
                "optional features"
            )
            response = await request(True)
            remember_compat_request(settings.api_key, settings.model)
    except anthropic.APIError as e:
        logger.warning(f"call insights API error (org {organization_id}): {e}")
        raise InsightsError(api_error_message(e, settings.model))

    if response.stop_reason == "refusal":
        raise InsightsError("The assistant declined to analyze these calls.")
    if response.stop_reason == "max_tokens":
        raise InsightsError("The analysis ran too long. Please try again.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning(f"call insights returned non-JSON for org {organization_id}")
        raise InsightsError("The analysis came back incomplete. Please try again.")

    logger.info(
        f"call insights org={organization_id} model={response.model} "
        f"calls={len(calls)} in={response.usage.input_tokens} out={response.usage.output_tokens}"
    )
    return _new_report(model=response.model, **normalize_report(data, calls))
