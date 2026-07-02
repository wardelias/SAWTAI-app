"""Marketing lead-source connections (Meta Instant Form for v1).

Thin handlers: resolve auth + organization, delegate to the marketing service,
shape the response. All connection operations are organization-scoped.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.db.models import UserModel
from api.services.auth.depends import get_user
from api.services.marketing import meta_connection_service

router = APIRouter(prefix="/marketing")


class MetaConnectionResponse(BaseModel):
    id: int
    source_type: str
    form_id: Optional[str] = None
    form_name: Optional[str] = None
    page_id: Optional[str] = None
    workflow_id: int
    workflow_name: Optional[str] = None
    call_after_seconds: int
    max_retries: int
    enabled: bool
    state: str
    total_leads: int
    created_at: datetime


class MetaConnectionsResponse(BaseModel):
    connections: list[MetaConnectionResponse]


class ConnectMetaRequest(BaseModel):
    page_access_token: str = Field(..., min_length=1)
    form_id: str = Field(..., min_length=1, max_length=255)
    workflow_id: int
    call_after_seconds: int = Field(0, ge=0, le=86400)
    max_retries: int = Field(2, ge=0, le=10)
    page_id: Optional[str] = Field(None, max_length=255)
    country_hint: Optional[str] = Field(None, max_length=2)
    name: Optional[str] = Field(None, min_length=1, max_length=255)


class UpdateConnectionRequest(BaseModel):
    workflow_id: Optional[int] = None
    call_after_seconds: Optional[int] = Field(None, ge=0, le=86400)
    max_retries: Optional[int] = Field(None, ge=0, le=10)
    enabled: Optional[bool] = None


@router.get("/connections")
async def list_connections(
    user: UserModel = Depends(get_user),
) -> MetaConnectionsResponse:
    """List the organization's connected lead sources."""
    connections = await meta_connection_service.list_connections(
        user.selected_organization_id
    )
    return MetaConnectionsResponse(
        connections=[MetaConnectionResponse(**c) for c in connections]
    )


@router.post("/connections/meta")
async def connect_meta(
    request: ConnectMetaRequest,
    user: UserModel = Depends(get_user),
) -> MetaConnectionResponse:
    """Connect a Meta Instant Form: validate token + form, start auto-calling."""
    try:
        connection = await meta_connection_service.connect_meta(
            organization_id=user.selected_organization_id,
            user_id=user.id,
            page_access_token=request.page_access_token,
            form_id=request.form_id,
            workflow_id=request.workflow_id,
            call_after_seconds=request.call_after_seconds,
            max_retries=request.max_retries,
            page_id=request.page_id,
            country_hint=request.country_hint,
            name=request.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MetaConnectionResponse(**connection)


@router.patch("/connections/{campaign_id}")
async def update_connection(
    campaign_id: int,
    request: UpdateConnectionRequest,
    user: UserModel = Depends(get_user),
) -> MetaConnectionResponse:
    """Update a connection's agent, timing, retries, or active state."""
    try:
        connection = await meta_connection_service.update_connection(
            organization_id=user.selected_organization_id,
            campaign_id=campaign_id,
            workflow_id=request.workflow_id,
            call_after_seconds=request.call_after_seconds,
            max_retries=request.max_retries,
            enabled=request.enabled,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return MetaConnectionResponse(**connection)


@router.delete("/connections/{campaign_id}")
async def disconnect(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> dict:
    """Disconnect a lead source: stop polling and revoke the stored token."""
    ok = await meta_connection_service.disconnect(
        user.selected_organization_id, campaign_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"success": True}
