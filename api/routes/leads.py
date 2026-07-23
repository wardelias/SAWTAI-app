"""API routes for the persistent lead database.

Handlers are thin: validate, resolve ``organization_id``, delegate to the lead
DB client / import service, shape the response. See api/AGENTS.md.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.db import db_client
from api.db.models import UserModel
from api.schemas.lead import (
    CreateLeadRequest,
    ImportLeadsRequest,
    ImportLeadsResponse,
    LeadActivityListResponse,
    LeadListResponse,
    LeadResponse,
    UpdateLeadRequest,
)
from api.services.auth.depends import get_user
from api.services.leads.import_service import import_leads_from_csv

router = APIRouter(prefix="/leads", tags=["leads"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


@router.get("", response_model=LeadListResponse)
async def list_leads(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: UserModel = Depends(get_user),
):
    """List leads for the current organization, filterable by status/search."""
    org_id = _require_org(user)
    leads = await db_client.list_leads(
        organization_id=org_id,
        status=status,
        search=search,
        limit=limit,
        offset=offset,
    )
    total = await db_client.count_leads(organization_id=org_id, status=status)
    status_counts = await db_client.status_counts(organization_id=org_id)
    return LeadListResponse(leads=leads, total=total, status_counts=status_counts)


@router.post("", response_model=LeadResponse, status_code=201)
async def create_lead(
    body: CreateLeadRequest,
    user: UserModel = Depends(get_user),
):
    """Create a single lead. Rejects duplicates within the organization."""
    org_id = _require_org(user)
    if not body.phone_number.startswith("+"):
        raise HTTPException(
            status_code=400,
            detail="phone_number must be E.164 (include country code, e.g. +14155550100)",
        )
    existing = await db_client.get_lead_by_phone(org_id, body.phone_number)
    if existing:
        raise HTTPException(
            status_code=409, detail="A lead with this phone number already exists"
        )
    lead = await db_client.create_lead(
        organization_id=org_id,
        phone_number=body.phone_number,
        email=body.email,
        first_name=body.first_name,
        last_name=body.last_name,
        attributes=body.attributes,
        source=body.source,
        external_id=body.external_id,
        dnc=body.dnc,
        consent_sms=body.consent_sms,
        consent_email=body.consent_email,
        timezone=body.timezone,
        status="suppressed" if body.dnc else "new",
    )
    return lead


@router.post("/import", response_model=ImportLeadsResponse)
async def import_leads(
    body: ImportLeadsRequest,
    user: UserModel = Depends(get_user),
):
    """Import leads from a CSV previously uploaded via the presigned-URL flow."""
    org_id = _require_org(user)
    try:
        result = await import_leads_from_csv(
            organization_id=org_id, file_key=body.file_key, source=body.source
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ImportLeadsResponse(
        total_rows=result.total_rows,
        imported=result.imported,
        duplicates_in_db=result.duplicates_in_db,
        duplicates_in_file=result.duplicates_in_file,
        invalid=result.invalid,
        invalid_rows=result.invalid_rows,
    )


@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(
    lead_id: int,
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    lead = await db_client.get_lead(lead_id, org_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: int,
    body: UpdateLeadRequest,
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    fields = body.model_dump(exclude_unset=True)
    lead = await db_client.update_lead(lead_id, org_id, **fields)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.get("/{lead_id}/activities", response_model=LeadActivityListResponse)
async def get_lead_activities(
    lead_id: int,
    user: UserModel = Depends(get_user),
):
    """Return the full activity timeline for a lead (org-scoped)."""
    org_id = _require_org(user)
    lead = await db_client.get_lead(lead_id, org_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    activities = await db_client.list_lead_activities(lead_id, org_id)
    return LeadActivityListResponse(activities=activities, total=len(activities))
