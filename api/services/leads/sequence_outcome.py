"""Post-call outcome handling for reactivation-sequence voice steps.

Invoked from the shared post-call completion task. It is a no-op for any run
that isn't part of a sequence. For sequence runs it records the call outcome on
the lead's timeline and, when the lead actually engaged (a real conversation,
not a no-answer/voicemail), stops the remaining cadence and marks the lead as
responded/qualified/converted — this is the "stop on response" behaviour.
"""

from typing import Any, Dict, Optional

from loguru import logger

from api.db import db_client

# Dispositions / end-reasons that mean we never reached a live person.
_NO_CONTACT = {
    "no_answer",
    "no-answer",
    "busy",
    "voicemail",
    "machine",
    "answering_machine",
    "failed",
    "canceled",
    "cancelled",
    "rejected",
    "unreachable",
}

# Dispositions that should promote the lead's lifecycle status directly.
_CONVERTED_HINTS = {"converted", "won", "sale", "booked", "meeting_booked"}
_QUALIFIED_HINTS = {"qualified", "interested", "hot"}


def _disposition(gathered: Dict[str, Any]) -> Optional[str]:
    for key in (
        "extracted_call_disposition",
        "mapped_call_disposition",
        "call_disposition",
    ):
        value = gathered.get(key)
        if value:
            return str(value).strip().lower()
    return None


def _engaged(gathered: Dict[str, Any]) -> bool:
    """Heuristic: did the lead actually have a conversation?"""
    disposition = _disposition(gathered)
    if disposition is not None:
        return disposition not in _NO_CONTACT

    # No explicit disposition — fall back to conversation depth. ``nodes_visited``
    # is recorded by the engine as it walks the workflow graph; visiting more
    # than the start node implies the lead engaged.
    nodes_visited = gathered.get("nodes_visited")
    if isinstance(nodes_visited, (list, set, tuple)):
        return len(nodes_visited) > 1
    return False


def _resulting_lead_status(gathered: Dict[str, Any]) -> str:
    disposition = _disposition(gathered) or ""
    if any(h in disposition for h in _CONVERTED_HINTS):
        return "converted"
    if any(h in disposition for h in _QUALIFIED_HINTS):
        return "qualified"
    return "responded"


async def handle_sequence_call_completion(workflow_run_id: int) -> None:
    """Record the outcome of a sequence voice step and stop the cadence on
    engagement. No-op for non-sequence runs."""
    run = await db_client.get_workflow_run_by_id(workflow_run_id)
    if not run:
        return

    initial_context = run.initial_context or {}
    enrollment_id = initial_context.get("sequence_enrollment_id")
    if not enrollment_id:
        return  # not part of a reactivation sequence

    org_id = initial_context.get("organization_id")
    lead_id = initial_context.get("lead_id")
    sequence_id = initial_context.get("sequence_id")
    step_order = initial_context.get("sequence_step_order")
    if org_id is None or lead_id is None:
        logger.warning(
            f"Sequence run {workflow_run_id} missing org/lead in context"
        )
        return

    gathered = run.gathered_context or {}
    engaged = _engaged(gathered)
    disposition = _disposition(gathered)

    await db_client.add_lead_activity(
        lead_id=lead_id,
        organization_id=org_id,
        channel="voice",
        direction="outbound",
        activity_type="call_completed",
        workflow_run_id=workflow_run_id,
        payload={
            "sequence_id": sequence_id,
            "step_order": step_order,
            "disposition": disposition,
            "engaged": engaged,
        },
    )

    if not engaged:
        return  # leave the enrollment to continue its remaining steps

    # Respect the step's stop_on_response flag (default: stop).
    stop_on_response = True
    if sequence_id is not None and step_order is not None:
        steps = await db_client.get_sequence_steps(sequence_id, org_id)
        match = next((s for s in steps if s.step_order == step_order), None)
        if match is not None:
            stop_on_response = match.stop_on_response

    new_status = _resulting_lead_status(gathered)
    await db_client.update_lead(lead_id, org_id, status=new_status)

    if stop_on_response:
        enrollment_state = "converted" if new_status == "converted" else "stopped"
        await db_client.stop_enrollment(
            enrollment_id,
            org_id,
            stop_reason=f"responded:{disposition or 'engaged'}",
            state=enrollment_state,
        )
        logger.info(
            f"Sequence enrollment {enrollment_id} stopped ({new_status}) "
            f"after engaged call {workflow_run_id}"
        )
