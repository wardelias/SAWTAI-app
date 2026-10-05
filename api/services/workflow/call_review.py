"""Turn stored workflow runs into compact call-review data for an LLM.

Used by the call-review MCP tools (and through them the in-app AI
Assistant) to look at how an agent's calls actually went: outcomes,
durations, per-call QA results, and transcripts. Everything here is a pure
function over run data already loaded (org-scoped) by the caller.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from pipecat.utils.enums import RealtimeFeedbackType

from api.services.workflow.qa.conversation import (
    build_conversation_structure,
    format_transcript,
)

# A connected call this short almost always means the caller hung up
# early or the agent failed to engage.
SHORT_CALL_SECONDS = 15
# Bounds what one tool result can put into the model's context.
MAX_TRANSCRIPT_CHARS = 30_000
MAX_SUMMARY_CHARS = 400

# System fields in gathered_context; everything else is data the agent
# collected (extracted variables).
_SYSTEM_CONTEXT_KEYS = {
    "call_id",
    "call_uuid",
    "trace_url",
    "trigger_uuid",
    "transfer_state",
    "external_pbx_transferred",
    "mapped_call_disposition",
    "call_disposition",
    "call_tags",
    "nodes_visited",
}


def _duration(usage_info: dict | None) -> float | None:
    raw = (usage_info or {}).get("call_duration_seconds")
    try:
        return round(float(raw), 1) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _outcome(gathered: dict | None) -> str:
    gathered = gathered or {}
    return str(
        gathered.get("mapped_call_disposition")
        or gathered.get("call_disposition")
        or "UNKNOWN"
    )


def _qa_nodes(annotations: dict | None) -> list[dict[str, Any]]:
    """Per-node QA results from every QA node that ran on the call."""
    nodes: list[dict[str, Any]] = []
    for key, result in (annotations or {}).items():
        if not key.startswith("qa_") or not isinstance(result, dict):
            continue
        for node in (result.get("node_results") or {}).values():
            if isinstance(node, dict) and not node.get("error"):
                nodes.append(node)
    return nodes


def _qa_summary(annotations: dict | None) -> dict[str, Any] | None:
    nodes = _qa_nodes(annotations)
    if not nodes:
        return None
    scores = [n["score"] for n in nodes if isinstance(n.get("score"), (int, float))]
    tags = sorted(
        {t for n in nodes for t in (n.get("tags") or []) if isinstance(t, str)}
    )
    summary = " ".join(s for n in nodes if (s := (n.get("summary") or "").strip()))
    return {
        "score": round(sum(scores) / len(scores), 1) if scores else None,
        "tags": tags,
        "summary": summary[:MAX_SUMMARY_CHARS],
    }


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def summarize_call(run: dict[str, Any]) -> dict[str, Any]:
    """One row of `list_calls`: enough to pick which calls to read."""
    gathered = run.get("gathered_context") or {}
    return {
        "call_id": run["id"],
        "started_at": _iso(run.get("created_at")),
        "duration_seconds": _duration(run.get("usage_info")),
        "outcome": _outcome(gathered),
        "state": _enum_value(run.get("state")),
        "call_type": _enum_value(run.get("call_type")),
        "tags": gathered.get("call_tags") or [],
        "qa": _qa_summary(run.get("annotations")),
    }


def compute_call_stats(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate numbers that point at where an agent struggles."""
    durations = [d for r in runs if (d := _duration(r.get("usage_info"))) is not None]
    outcomes = Counter(_outcome(r.get("gathered_context")) for r in runs)
    qa = [q for r in runs if (q := _qa_summary(r.get("annotations")))]
    qa_scores = [q["score"] for q in qa if q["score"] is not None]
    qa_tags = Counter(t for q in qa for t in q["tags"])
    low_scored = [
        summarize_call(r)["call_id"]
        for r in runs
        if (q := _qa_summary(r.get("annotations")))
        and q["score"] is not None
        and q["score"] < 6
    ]
    short = [
        r["id"]
        for r in runs
        if (d := _duration(r.get("usage_info"))) is not None and d < SHORT_CALL_SECONDS
    ]
    return {
        "calls": len(runs),
        "completed": sum(1 for r in runs if r.get("is_completed")),
        "avg_duration_seconds": round(sum(durations) / len(durations), 1)
        if durations
        else None,
        "short_calls": {
            "count": len(short),
            "threshold_seconds": SHORT_CALL_SECONDS,
            "call_ids": short[:20],
        },
        "outcomes": dict(outcomes.most_common(10)),
        "qa": {
            "calls_with_qa": len(qa),
            "avg_score": round(sum(qa_scores) / len(qa_scores), 1)
            if qa_scores
            else None,
            "top_tags": dict(qa_tags.most_common(10)),
            "low_score_call_ids": low_scored[:20],
        },
    }


def _pipeline_errors(events: list[dict]) -> list[dict[str, Any]]:
    """Runtime errors raised during the call (STT/LLM/TTS failures etc.)."""
    errors = []
    for event in events:
        if event.get("type") != RealtimeFeedbackType.PIPELINE_ERROR.value:
            continue
        payload = event.get("payload") or {}
        errors.append(
            {
                "error": str(payload.get("error", ""))[:300],
                "fatal": bool(payload.get("fatal")),
                "processor": payload.get("processor"),
                "step": event.get("node_name"),
            }
        )
    return errors[:10]


def call_detail(run: Any) -> dict[str, Any]:
    """Everything about one call an LLM needs to diagnose it."""
    gathered = dict(run.gathered_context or {})
    logs = run.logs or {}
    events = logs.get("realtime_feedback_events") or []
    conversation = build_conversation_structure(events)
    transcript = format_transcript(conversation)
    truncated = len(transcript) > MAX_TRANSCRIPT_CHARS
    return {
        "call_id": run.id,
        "workflow_id": run.workflow_id,
        "started_at": _iso(run.created_at),
        "duration_seconds": _duration(run.usage_info),
        "outcome": _outcome(gathered),
        "state": _enum_value(run.state),
        "call_type": _enum_value(run.call_type),
        "tags": gathered.get("call_tags") or [],
        "steps_visited": gathered.get("nodes_visited") or [],
        "extracted_data": {
            k: v for k, v in gathered.items() if k not in _SYSTEM_CONTEXT_KEYS
        },
        "qa": [
            {
                "step": n.get("node_name"),
                "score": n.get("score"),
                "tags": n.get("tags") or [],
                "summary": n.get("summary") or "",
                "sentiment": n.get("overall_sentiment"),
            }
            for n in _qa_nodes(run.annotations)
        ],
        "errors": _pipeline_errors(events),
        "transcript": transcript[:MAX_TRANSCRIPT_CHARS]
        or "(no transcript recorded for this call)",
        "transcript_truncated": truncated,
    }
