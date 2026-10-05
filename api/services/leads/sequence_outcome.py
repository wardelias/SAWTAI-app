"""Post-call outcome handling for calls placed to leads.

Invoked when a call ends — from the post-call completion task for connected
calls and from the telephony status path for calls that never connected
(no-answer, busy, failed). It is a no-op for runs that aren't tied to a lead.

Two kinds of runs are tied to a lead:

* **Reactivation-sequence voice steps** (``sequence_enrollment_id`` in the
  run's initial_context). The outcome is recorded on the lead's timeline; an
  engaged lead stops the remaining cadence and is marked
  responded/qualified/converted ("stop on response"); otherwise the next step
  is scheduled, timed from when this call ended.
* **Campaign calls to leads-database leads** (campaign ``source_type`` of
  ``leads``). The outcome is recorded on the lead and its lifecycle status is
  updated; engaging on a campaign call also stops the lead's active sequences.

A lead who asks not to be called again (an opt-out disposition) is flagged
DNC and suppressed everywhere.
"""

import re
from datetime import UTC, datetime
from typing import Any, Dict, Optional

from loguru import logger

from api.db import db_client
from api.services.leads.sequence_orchestrator import (
    mark_contacted,
    resume_after_call,
)

# Dispositions / end-reasons that mean we never had a conversation with a
# live person (unconnected call, voicemail, silence, or our own failure).
_NO_CONTACT = {
    "no_answer",
    "busy",
    "voicemail",
    "voicemail_detected",
    "machine",
    "answering_machine",
    "failed",
    "error",
    "canceled",
    "cancelled",
    "rejected",
    "unreachable",
    "pipeline_error",
    "unexpected_error",
    "system_cancelled",
    "user_idle_max_duration_exceeded",
}

# End reasons the engine records when no outcome was extracted. They say how
# the call ended, not whether anyone talked — decided by user speech instead.
_SYSTEM_END_REASONS = {
    "user_hangup",
    "end_call",
    "call_duration_exceeded",
    "completed",
}

_OPT_OUT = {
    "dnc",
    "do_not_call",
    "donotcall",
    "opt_out",
    "opted_out",
    "optout",
    "unsubscribe",
    "unsubscribed",
    "stop_calling",
    "remove_me",
}
_NEGATIONS = {"not", "no", "never", "un", "cancel", "cancelled", "canceled", "lost"}
_CONVERTED_HINTS = {"converted", "won", "sale", "sold", "booked", "purchased", "paid"}
_QUALIFIED_HINTS = {"qualified", "interested", "hot", "warm"}


def _normalize(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def _disposition(gathered: Dict[str, Any]) -> Optional[str]:
    for key in (
        "extracted_call_disposition",
        "mapped_call_disposition",
        "call_disposition",
    ):
        value = gathered.get(key)
        if value:
            return _normalize(value)
    return None


def _engaged(gathered: Dict[str, Any]) -> bool:
    """Did the lead actually have a conversation with the agent?"""
    disposition = _disposition(gathered)
    if disposition in _NO_CONTACT:
        return False

    call_tags = gathered.get("call_tags") or []
    if isinstance(call_tags, (list, tuple, set)) and "user_speech" in call_tags:
        return True

    # An outcome extracted from the conversation (e.g. "interested") implies
    # one took place; a bare end reason doesn't.
    if disposition and disposition not in _SYSTEM_END_REASONS:
        return True

    # Fallback: the conversation progressed beyond the start node.
    nodes_visited = gathered.get("nodes_visited")
    if isinstance(nodes_visited, (list, set, tuple)):
        return len(nodes_visited) > 1
    return False


def _opted_out(gathered: Dict[str, Any]) -> bool:
    disposition = _disposition(gathered) or ""
    return disposition in _OPT_OUT


def _resulting_lead_status(gathered: Dict[str, Any]) -> str:
    tokens = set((_disposition(gathered) or "").split("_"))
    if not tokens & _NEGATIONS:
        if tokens & _CONVERTED_HINTS:
            return "converted"
        if tokens & _QUALIFIED_HINTS:
            return "qualified"
    return "responded"


async def handle_lead_call_completion(workflow_run_id: int) -> None:
    """Record the outcome of a call placed to a lead (sequence step or
    leads-database campaign). No-op for any other run. Idempotent."""
    run = await db_client.get_workflow_run_by_id(workflow_run_id)
    if not run:
        return

    initial_context = run.initial_context or {}
    if initial_context.get("sequence_enrollment_id"):
        await _handle_sequence_call(run, initial_context)
    elif initial_context.get("lead_id") and getattr(run, "campaign_id", None):
        await _handle_campaign_call(run, initial_context)


# Kept for callers/tests written against the original sequence-only name.
handle_sequence_call_completion = handle_lead_call_completion


async def _record_outcome(
    *,
    lead_id: int,
    org_id: int,
    workflow_run_id: int,
    gathered: Dict[str, Any],
    payload: Dict[str, Any],
) -> bool:
    """Append the ``call_completed`` timeline entry. Returns False if this run
    was already recorded (duplicate completion event)."""
    if await db_client.lead_activity_exists(
        lead_id, org_id, workflow_run_id, "call_completed"
    ):
        return False
    await db_client.add_lead_activity(
        lead_id=lead_id,
        organization_id=org_id,
        channel="voice",
        direction="outbound",
        activity_type="call_completed",
        workflow_run_id=workflow_run_id,
        payload={
            **payload,
            "disposition": _disposition(gathered),
            "engaged": _engaged(gathered),
        },
    )
    return True


async def _apply_opt_out(lead_id: int, org_id: int) -> None:
    await db_client.update_lead(lead_id, org_id, dnc=True, status="suppressed")
    for enrollment in await db_client.get_active_enrollments_for_lead(lead_id, org_id):
        await db_client.stop_enrollment(enrollment.id, org_id, stop_reason="opted_out")


async def _handle_sequence_call(run, initial_context: Dict[str, Any]) -> None:
    workflow_run_id = run.id
    enrollment_id = initial_context.get("sequence_enrollment_id")
    org_id = initial_context.get("organization_id")
    lead_id = initial_context.get("lead_id")
    sequence_id = initial_context.get("sequence_id")
    step_order = initial_context.get("sequence_step_order")
    if org_id is None or lead_id is None:
        logger.warning(f"Sequence run {workflow_run_id} missing org/lead in context")
        return

    gathered = run.gathered_context or {}
    if not await _record_outcome(
        lead_id=lead_id,
        org_id=org_id,
        workflow_run_id=workflow_run_id,
        gathered=gathered,
        payload={
            "sequence_id": sequence_id,
            "step_order": step_order,
            "workflow_id": run.workflow_id,
        },
    ):
        return

    disposition = _disposition(gathered)
    if _opted_out(gathered):
        await _apply_opt_out(lead_id, org_id)
        logger.info(f"Lead {lead_id} opted out on run {workflow_run_id}")
        return

    if _engaged(gathered):
        stop_on_response = True
        if sequence_id is not None and step_order is not None:
            steps = await db_client.get_sequence_steps(sequence_id, org_id)
            match = next((s for s in steps if s.step_order == step_order), None)
            if match is not None:
                stop_on_response = match.stop_on_response

        new_status = _resulting_lead_status(gathered)
        # A conversion always ends the cadence; otherwise honour the step's
        # "stop on response" flag. When it's off the lead keeps being worked,
        # so they aren't marked responded (which would suppress them).
        if stop_on_response or new_status == "converted":
            await db_client.update_lead(lead_id, org_id, status=new_status)
            await db_client.stop_enrollment(
                enrollment_id,
                org_id,
                stop_reason=f"responded:{disposition or 'engaged'}",
                state="converted" if new_status == "converted" else "stopped",
            )
            logger.info(
                f"Sequence enrollment {enrollment_id} stopped ({new_status}) "
                f"after engaged call {workflow_run_id}"
            )
            return

    # Not stopping: schedule the next step, timed from the end of this call.
    await resume_after_call(enrollment_id, org_id, lead_id, workflow_run_id)


async def _handle_campaign_call(run, initial_context: Dict[str, Any]) -> None:
    campaign = await db_client.get_campaign_by_id(run.campaign_id)
    if campaign is None or campaign.source_type != "leads":
        return  # lead_id only means a leads-database lead for this source
    org_id = campaign.organization_id
    try:
        lead_id = int(initial_context["lead_id"])
    except (TypeError, ValueError):
        return
    lead = await db_client.get_lead(lead_id, org_id)
    if lead is None:
        return

    gathered = run.gathered_context or {}
    if not await _record_outcome(
        lead_id=lead_id,
        org_id=org_id,
        workflow_run_id=run.id,
        gathered=gathered,
        payload={"campaign_id": campaign.id, "workflow_id": run.workflow_id},
    ):
        return
    await db_client.update_lead(lead_id, org_id, last_contacted_at=datetime.now(UTC))

    if _opted_out(gathered):
        await _apply_opt_out(lead_id, org_id)
        return

    if not _engaged(gathered):
        await mark_contacted(lead_id, org_id, lead.status)
        return

    new_status = _resulting_lead_status(gathered)
    if lead.status != "converted":
        await db_client.update_lead(lead_id, org_id, status=new_status)
    # They talked to us — stop any wake-up sequence still chasing them.
    for enrollment in await db_client.get_active_enrollments_for_lead(lead_id, org_id):
        await db_client.stop_enrollment(
            enrollment.id,
            org_id,
            stop_reason=f"responded:campaign_{campaign.id}",
            state="converted" if new_status == "converted" else "stopped",
        )
