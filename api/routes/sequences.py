"""API routes for reactivation sequences (multi-step lead wake-up cadences).

Handlers stay thin: validate + resolve org, delegate to the sequence DB client,
shape the response. See api/AGENTS.md.
"""

from fastapi import APIRouter, Depends, HTTPException

from api.db import db_client
from api.db.models import UserModel
from api.schemas.sequence import (
    CreateSequenceRequest,
    EnrollLeadsRequest,
    EnrollLeadsResponse,
    EnrollmentListResponse,
    SequenceListResponse,
    SequenceResponse,
    UpdateSequenceRequest,
)
from api.services.auth.depends import get_user

router = APIRouter(prefix="/sequences", tags=["sequences"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


async def _validate_steps(steps, organization_id: int) -> None:
    """Every voice step must reference a workflow owned by the caller's org."""
    if not steps:
        raise HTTPException(status_code=400, detail="A sequence needs at least one step")
    for idx, step in enumerate(steps):
        if step.channel == "voice":
            if not step.workflow_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Step {idx + 1}: voice steps require a workflow_id",
                )
            workflow = await db_client.get_workflow(
                step.workflow_id, organization_id=organization_id
            )
            if not workflow:
                raise HTTPException(
                    status_code=404,
                    detail=f"Step {idx + 1}: workflow {step.workflow_id} not found",
                )


@router.get("", response_model=SequenceListResponse)
async def list_sequences(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    sequences = await db_client.list_sequences(org_id)
    return SequenceListResponse(sequences=sequences, total=len(sequences))


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
        name=body.name,
        steps=[s.model_dump() for s in body.steps],
        quiet_hours_start=body.quiet_hours_start,
        quiet_hours_end=body.quiet_hours_end,
        default_timezone=body.default_timezone,
        status=body.status,
    )
    return sequence


@router.get("/{sequence_id}", response_model=SequenceResponse)
async def get_sequence(sequence_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    return sequence


@router.patch("/{sequence_id}", response_model=SequenceResponse)
async def update_sequence(
    sequence_id: int,
    body: UpdateSequenceRequest,
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    fields = body.model_dump(exclude_unset=True)
    sequence = await db_client.update_sequence(sequence_id, org_id, **fields)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    return sequence


@router.post("/{sequence_id}/enroll", response_model=EnrollLeadsResponse)
async def enroll_leads(
    sequence_id: int,
    body: EnrollLeadsRequest,
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    result = await db_client.enroll_leads(
        sequence_id=sequence_id,
        organization_id=org_id,
        lead_ids=body.lead_ids,
        start_at=body.start_at,
    )
    return EnrollLeadsResponse(**result)


@router.get("/{sequence_id}/enrollments", response_model=EnrollmentListResponse)
async def list_enrollments(sequence_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    sequence = await db_client.get_sequence(sequence_id, org_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    enrollments = await db_client.list_enrollments_for_sequence(sequence_id, org_id)
    return EnrollmentListResponse(enrollments=enrollments, total=len(enrollments))
