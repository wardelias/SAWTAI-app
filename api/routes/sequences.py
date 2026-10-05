"""API routes for reactivation sequences (multi-step lead wake-up cadences).

Handlers stay thin: validate + resolve org, delegate to the sequence DB client,
shape the response. See api/AGENTS.md.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.db import db_client
from api.db.models import UserModel
from api.schemas.sequence import (
    CreateSequenceRequest,
    EnrollLeadsRequest,
    EnrollLeadsResponse,
    EnrollmentListResponse,
    SequenceListResponse,
    SequenceResponse,
    SequenceStepResponse,
    StopEnrollmentsRequest,
    StopEnrollmentsResponse,
    UpdateSequenceRequest,
)
from api.services.auth.depends import get_user

router = APIRouter(prefix="/sequences", tags=["sequences"])

_ENROLLMENT_STATES = {"active", "completed", "stopped", "converted"}


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


async def _validate_steps(steps, organization_id: int) -> None:
    """Every voice step must reference an agent owned by the caller's org."""
    workflow_ids = {s.workflow_id for s in steps if s.channel == "voice"}
    if not workflow_ids:
        return
    found = {
        w.id
        for w in await db_client.get_workflows_by_ids(
            list(workflow_ids), organization_id
        )
    }
    for idx, step in enumerate(steps):
        if step.channel == "voice" and step.workflow_id not in found:
            raise HTTPException(
                status_code=404,
                detail=f"Step {idx + 1}: voice agent {step.workflow_id} not found",
            )


async def _workflow_names(sequences, organization_id: int) -> Dict[int, str]:
    ids = {s.workflow_id for seq in sequences for s in seq.steps if s.workflow_id}
    if not ids:
        return {}
    workflows = await db_client.get_workflows_by_ids(list(ids), organization_id)
    return {w.id: w.name for w in workflows}


def _to_response(
    sequence, names: Dict[int, str], counts: Optional[Dict[str, int]] = None
) -> SequenceResponse:
    return SequenceResponse(
        id=sequence.id,
        organization_id=sequence.organization_id,
        name=sequence.name,
        status=sequence.status,
        quiet_hours_start=sequence.quiet_hours_start,
        quiet_hours_end=sequence.quiet_hours_end,
        default_timezone=sequence.default_timezone,
        steps=[
            SequenceStepResponse(
                id=s.id,
                step_order=s.step_order,
                channel=s.channel,
                delay_seconds=s.delay_seconds,
                workflow_id=s.workflow_id,
                workflow_name=names.get(s.workflow_id) if s.workflow_id else None,
                message_template_id=s.message_template_id,
                message_text=s.message_text,
                stop_on_response=s.stop_on_response,
            )
            for s in sorted(sequence.steps, key=lambda s: s.step_order)
        ],
        enrollment_counts=counts or {},
        created_at=sequence.created_at,
        updated_at=sequence.updated_at,
    )


async def _respond(sequence, organization_id: int) -> SequenceResponse:
    names = await _workflow_names([sequence], organization_id)
    stats = await db_client.get_enrollment_stats([sequence.id], organization_id)
    return _to_response(sequence, names, stats.get(sequence.id))


@router.get("", response_model=SequenceListResponse)
async def list_sequences(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    sequences = await db_client.list_sequences(org_id)
    names = await _workflow_names(sequences, org_id)
    stats = await db_client.get_enrollment_stats([s.id for s in sequences], org_id)
    return SequenceListResponse(
        sequences=[_to_response(s, names, stats.get(s.id)) for s in sequences],
        total=len(sequences),
    )


@router.post("", response_model=SequenceResponse, status_code=201)
async def create_sequence(
    body: CreateSequenceRequest,
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    await _validate_steps(body.steps, org_id)
    sequence = await db_client.create_sequence(
        organization_id=org_id,
        created_by=user.id,
        name=body.name.strip(),
        steps=[s.model_dump() for s in body.steps],
        quiet_hours_start=body.quiet_hours_start,
        quiet_hours_end=body.quiet_hours_end,
        default_timezone=body.default_timezone,
        status=body.status,
    )
    return await _respond(sequence, org_id)


@router.get("/{sequence_id}", response_model=SequenceResponse)
async def get_sequence(sequence_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    return await _respond(sequence, org_id)


@router.patch("/{sequence_id}", response_model=SequenceResponse)
async def update_sequence(
    sequence_id: int,
    body: UpdateSequenceRequest,
    user: UserModel = Depends(get_user),
):
    """Rename, pause/resume (``status``), change quiet hours, or replace the
    steps of a sequence."""
    org_id = _require_org(user)
    existing = await db_client.get_sequence(sequence_id, org_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Sequence not found")

    fields = body.model_dump(exclude_unset=True, exclude={"steps"})
    quiet_start = fields.get("quiet_hours_start", existing.quiet_hours_start)
    quiet_end = fields.get("quiet_hours_end", existing.quiet_hours_end)
    if (quiet_start is None) != (quiet_end is None):
        raise HTTPException(
            status_code=400,
            detail="Set both quiet-hours start and end, or neither",
        )
    if "name" in fields and fields["name"] is not None:
        fields["name"] = fields["name"].strip()

    steps = None
    if body.steps is not None:
        await _validate_steps(body.steps, org_id)
        steps = [s.model_dump() for s in body.steps]

    sequence = await db_client.update_sequence(
        sequence_id, org_id, steps=steps, **fields
    )
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    return await _respond(sequence, org_id)


@router.delete("/{sequence_id}", status_code=204)
async def delete_sequence(sequence_id: int, user: UserModel = Depends(get_user)):
    """Delete a sequence and stop everyone in it. Call history on the leads is
    kept."""
    org_id = _require_org(user)
    if not await db_client.delete_sequence(sequence_id, org_id):
        raise HTTPException(status_code=404, detail="Sequence not found")


@router.post("/{sequence_id}/enroll", response_model=EnrollLeadsResponse)
async def enroll_leads(
    sequence_id: int,
    body: EnrollLeadsRequest,
    user: UserModel = Depends(get_user),
):
    """Enroll leads by id, or every callable lead with a given status."""
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")

    lead_ids: List[int] = list(body.lead_ids or [])
    if body.lead_status:
        status = body.lead_status.strip().lower()
        leads = await db_client.get_callable_leads(
            org_id, status=None if status in {"", "all", "any"} else status
        )
        lead_ids.extend(lead.id for lead in leads)
    if not lead_ids:
        return EnrollLeadsResponse(enrolled=0, skipped=0)

    result = await db_client.enroll_leads(
        sequence_id=sequence_id,
        organization_id=org_id,
        lead_ids=lead_ids,
        start_at=body.start_at,
    )
    return EnrollLeadsResponse(**result)


@router.get("/{sequence_id}/enrollments", response_model=EnrollmentListResponse)
async def list_enrollments(
    sequence_id: int,
    state: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    if state is not None and state not in _ENROLLMENT_STATES:
        raise HTTPException(status_code=400, detail=f"Unknown state: {state}")
    enrollments = await db_client.list_enrollments_for_sequence(
        sequence_id, org_id, state=state, limit=limit, offset=offset
    )
    total = await db_client.count_enrollments_for_sequence(
        sequence_id, org_id, state=state
    )
    return EnrollmentListResponse(enrollments=enrollments, total=total)


@router.post("/{sequence_id}/enrollments/stop", response_model=StopEnrollmentsResponse)
async def stop_enrollments(
    sequence_id: int,
    body: StopEnrollmentsRequest,
    user: UserModel = Depends(get_user),
):
    """Take leads out of the sequence (all in-progress leads, or the given
    enrollments). Their remaining steps are cancelled."""
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    stopped = await db_client.stop_enrollments(
        sequence_id,
        org_id,
        stop_reason="stopped_manually",
        enrollment_ids=body.enrollment_ids,
    )
    return StopEnrollmentsResponse(stopped=stopped)
