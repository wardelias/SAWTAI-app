"""Marketing lead-source connections (Meta Instant Form for v1).

Thin handlers: resolve auth + organization, delegate to the marketing service,
shape the response. All connection operations are organization-scoped, except
the Meta webhook, which is authenticated by Meta's request signature instead.
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from loguru import logger
from pydantic import BaseModel, Field

from api.db.models import UserModel
from api.services.auth.depends import get_user
from api.services.marketing import (
    meta_connection_service,
    meta_oauth_service,
    meta_webhook_service,
)

router = APIRouter(prefix="/marketing")


class MetaAccountResponse(BaseModel):
    oauth_configured: bool
    connected: bool
    needs_reconnect: bool = False
    meta_user_id: Optional[str] = None
    meta_user_name: Optional[str] = None
    connected_at: Optional[datetime] = None
    token_expires_at: Optional[datetime] = None


class MetaAuthorizeUrlResponse(BaseModel):
    authorize_url: str


class CompleteMetaOAuthRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=2048)
    state: str = Field(..., min_length=1, max_length=2048)


class MetaPage(BaseModel):
    id: str
    name: str
    picture_url: Optional[str] = None
    can_read_leads: bool


class MetaPagesResponse(BaseModel):
    pages: list[MetaPage]


class MetaLeadForm(BaseModel):
    id: str
    name: str
    status: Optional[str] = None
    leads_count: Optional[int] = None
    created_time: Optional[str] = None


class MetaLeadFormsResponse(BaseModel):
    forms: list[MetaLeadForm]


class MetaConnectionResponse(BaseModel):
    id: int
    source_type: str
    form_id: Optional[str] = None
    form_name: Optional[str] = None
    page_id: Optional[str] = None
    page_name: Optional[str] = None
    connected_via: str = "token"
    instant: bool = False
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
    # Omit to use the org's connected Facebook account (requires page_id).
    page_access_token: Optional[str] = Field(None, min_length=1)
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


@router.get("/meta/account")
async def get_meta_account(
    user: UserModel = Depends(get_user),
) -> MetaAccountResponse:
    """Whether one-click connect is available and which Facebook account is linked."""
    account = await meta_oauth_service.get_account(user.selected_organization_id)
    return MetaAccountResponse(**account)


@router.post("/meta/oauth/start")
async def start_meta_oauth(
    user: UserModel = Depends(get_user),
) -> MetaAuthorizeUrlResponse:
    """Return the Facebook Login URL to send the browser to."""
    try:
        url = meta_oauth_service.create_authorize_url(
            user.selected_organization_id, user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MetaAuthorizeUrlResponse(authorize_url=url)


@router.post("/meta/oauth/complete")
async def complete_meta_oauth(
    request: CompleteMetaOAuthRequest,
    user: UserModel = Depends(get_user),
) -> MetaAccountResponse:
    """Finish Facebook Login with the code + state from the redirect."""
    try:
        account = await meta_oauth_service.complete_oauth(
            organization_id=user.selected_organization_id,
            user_id=user.id,
            code=request.code,
            state=request.state,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MetaAccountResponse(**account)


@router.delete("/meta/account")
async def disconnect_meta_account(
    user: UserModel = Depends(get_user),
) -> dict:
    """Unlink the Facebook account. Connected forms keep calling leads."""
    await meta_oauth_service.disconnect_account(user.selected_organization_id)
    return {"success": True}


@router.get("/meta/pages")
async def list_meta_pages(
    user: UserModel = Depends(get_user),
) -> MetaPagesResponse:
    """Facebook Pages the connected account manages."""
    try:
        pages = await meta_oauth_service.list_pages(user.selected_organization_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MetaPagesResponse(pages=[MetaPage(**p) for p in pages])


@router.get("/meta/pages/{page_id}/forms")
async def list_meta_lead_forms(
    page_id: str,
    user: UserModel = Depends(get_user),
) -> MetaLeadFormsResponse:
    """Instant Forms on one of the connected account's Pages."""
    try:
        forms = await meta_oauth_service.list_forms(
            user.selected_organization_id, page_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MetaLeadFormsResponse(forms=[MetaLeadForm(**f) for f in forms])


@router.get("/meta/webhook", include_in_schema=False)
async def verify_meta_webhook(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
) -> PlainTextResponse:
    """Meta's webhook subscription handshake (public, verify-token protected)."""
    challenge = meta_webhook_service.verify_subscription(
        hub_mode, hub_verify_token, hub_challenge
    )
    if challenge is None:
        raise HTTPException(status_code=403, detail="Verification failed")
    return PlainTextResponse(challenge)


@router.post("/meta/webhook", include_in_schema=False)
async def receive_meta_webhook(request: Request) -> dict:
    """Leadgen push from Meta (public, signature protected): poll matching forms now."""
    if not meta_webhook_service.webhook_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    raw_body = await request.body()
    if not meta_webhook_service.verify_signature(
        raw_body, request.headers.get("X-Hub-Signature-256")
    ):
        raise HTTPException(status_code=403, detail="Invalid signature")
    try:
        payload = json.loads(raw_body)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    try:
        await meta_webhook_service.handle_leadgen_payload(payload)
    except Exception as e:
        # Ack anyway: Meta retries failed deliveries for hours, and the
        # poller will still pick these leads up on its next sweep.
        logger.error(f"Meta leadgen webhook handling failed: {e}")
    return {"success": True}


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
    """Connect a Meta Instant Form and start auto-calling its new leads.

    Send ``page_id`` + ``form_id`` from the picker to use the connected
    Facebook account, or ``page_access_token`` + ``form_id`` to connect by hand.
    """
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
