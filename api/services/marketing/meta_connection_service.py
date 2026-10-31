"""Lifecycle for Meta Instant Form lead connections.

A "connection" is a long-lived evergreen campaign. This service owns creating,
listing, updating, and disconnecting them, plus storing the Page access token in
the credential subsystem. Route handlers stay thin and delegate here.

Everything is organization-scoped: callers pass ``organization_id`` and we never
trust ids from the request body to imply ownership.
"""

from datetime import UTC, datetime
from typing import Any, Dict, Optional

from loguru import logger

from api.db import db_client
from api.enums import WebhookCredentialType
from api.services.campaign.runner import campaign_runner_service
from api.services.marketing import (
    meta_graph_client,
    meta_oauth_service,
    meta_webhook_service,
)
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames

SOURCE_TYPE = "meta_instant_form"


class MetaConnectionError(ValueError):
    """A connection operation failed with an operator-safe message."""


def _build_retry_config(max_retries: int) -> Dict[str, Any]:
    """Map the marketing "max retries" knob onto a campaign retry_config."""
    return {
        "enabled": max_retries > 0,
        "max_retries": max_retries,
        "retry_delay_seconds": 120,
        "retry_on_busy": True,
        "retry_on_no_answer": True,
        "retry_on_voicemail": True,
    }


def _connection_view(campaign, workflow_name: Optional[str]) -> Dict[str, Any]:
    """Shape a campaign into the marketing connection dict the UI consumes."""
    meta = (campaign.orchestrator_metadata or {}).get("meta") or {}
    retry_config = campaign.retry_config or {}
    return {
        "id": campaign.id,
        "source_type": campaign.source_type,
        "form_id": meta.get("form_id"),
        "form_name": meta.get("form_name"),
        "page_id": meta.get("page_id"),
        "page_name": meta.get("page_name"),
        "connected_via": meta.get("connected_via") or "token",
        "instant": bool(meta.get("webhook_subscribed")),
        "workflow_id": campaign.workflow_id,
        "workflow_name": workflow_name,
        "call_after_seconds": int(meta.get("call_after_seconds") or 0),
        "max_retries": int(retry_config.get("max_retries") or 0),
        "enabled": campaign.state == "running",
        "state": campaign.state,
        "total_leads": campaign.total_rows or 0,
        "created_at": campaign.created_at,
    }


async def list_connections(organization_id: int) -> list[Dict[str, Any]]:
    """List an org's Meta connections (excludes disconnected ones)."""
    campaigns = await db_client.get_campaigns_by_source_type(
        organization_id, SOURCE_TYPE
    )
    active = [
        c
        for c in campaigns
        if not ((c.orchestrator_metadata or {}).get("meta") or {}).get("disconnected")
    ]
    if not active:
        return []

    workflow_ids = list({c.workflow_id for c in active})
    workflows = await db_client.get_workflows_by_ids(workflow_ids, organization_id)
    name_map = {w.id: w.name for w in workflows}
    return [_connection_view(c, name_map.get(c.workflow_id)) for c in active]


async def _form_already_connected(organization_id: int, form_id: str) -> bool:
    campaigns = await db_client.get_campaigns_by_source_type(
        organization_id, SOURCE_TYPE
    )
    return any(
        c.source_id == form_id
        and not ((c.orchestrator_metadata or {}).get("meta") or {}).get("disconnected")
        for c in campaigns
    )


async def _subscribe_leadgen_webhook(page_id: str, page_access_token: str) -> bool:
    """Best effort: push new leads instantly. Polling still covers failures."""
    if not meta_webhook_service.webhook_enabled():
        return False
    try:
        await meta_graph_client.subscribe_page_to_leadgen(page_id, page_access_token)
        return True
    except ValueError as e:
        logger.warning(
            f"Could not subscribe Page {page_id} to leadgen webhooks ({e}); "
            "leads will arrive via polling"
        )
        return False


async def connect_meta(
    *,
    organization_id: int,
    user_id: int,
    form_id: str,
    workflow_id: int,
    call_after_seconds: int,
    max_retries: int,
    page_access_token: Optional[str] = None,
    page_id: Optional[str] = None,
    country_hint: Optional[str] = None,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate a Meta form, store its Page token, and start an evergreen campaign.

    Two ways in:

    * **Connected account** (no ``page_access_token``): ``page_id`` + ``form_id``
      come from the picker; the Page token is resolved from the org's Facebook
      login and the form must belong to that Page.
    * **Manual token**: the operator pastes a Page access token and form id.
    """
    # Verify the chosen agent (workflow) belongs to this org.
    workflow_name = await db_client.get_workflow_name(
        workflow_id, organization_id=organization_id
    )
    if not workflow_name:
        raise MetaConnectionError("Selected agent (workflow) not found")

    # Two connections on one form would call every lead twice.
    if await _form_already_connected(organization_id, form_id):
        raise MetaConnectionError(
            "This lead form is already connected. Configure the existing "
            "connection instead."
        )

    webhook_subscribed = False
    page_name: Optional[str] = None
    if page_access_token:
        connected_via = "token"
        # Validate the token can actually read the form (raises MetaGraphError).
        form = await meta_graph_client.get_form(form_id, page_access_token)
    else:
        connected_via = "oauth"
        if not page_id:
            raise MetaConnectionError("Choose a Facebook Page")
        # Raises if the Page isn't one the connected account manages.
        page = await meta_oauth_service.get_managed_page(organization_id, page_id)
        page_access_token = page["access_token"]
        page_name = page.get("name")
        forms = await meta_graph_client.list_lead_forms(page_id, page_access_token)
        picked = next((f for f in forms if f.get("id") == form_id), None)
        if picked is None:
            raise MetaConnectionError(
                "That lead form doesn't belong to the selected Facebook Page"
            )
        form = picked
        webhook_subscribed = await _subscribe_leadgen_webhook(
            page_id, page_access_token
        )
    form_name = form.get("name") or f"Form {form_id}"

    # Store the Page token in the credential subsystem (org-scoped, UUID-referenced).
    credential = await db_client.create_credential(
        organization_id=organization_id,
        user_id=user_id,
        name=f"Meta Page Token — {form_name}",
        credential_type=WebhookCredentialType.BEARER_TOKEN.value,
        credential_data={"token": page_access_token},
        description=f"Long-lived Page access token for Meta form {form_id}",
    )

    # Default telephony config (may be None until the org configures telephony —
    # leads still queue and get called once telephony is set up).
    default_cfg = await db_client.get_default_telephony_configuration(organization_id)
    telephony_configuration_id = default_cfg.id if default_cfg else None

    campaign = await db_client.create_campaign(
        name=name or form_name,
        workflow_id=workflow_id,
        source_type=SOURCE_TYPE,
        source_id=form_id,
        user_id=user_id,
        organization_id=organization_id,
        retry_config=_build_retry_config(max_retries),
        telephony_configuration_id=telephony_configuration_id,
    )

    # Merge evergreen + meta config into orchestrator_metadata and start running.
    # last_lead_time = now so we only ingest leads submitted after connection
    # (no backfill of stale pre-connection leads).
    now = datetime.now(UTC)
    metadata = {
        **(campaign.orchestrator_metadata or {}),
        "evergreen": True,
        "meta": {
            "page_id": page_id,
            "page_name": page_name,
            "form_id": form_id,
            "form_name": form_name,
            "credential_uuid": credential.credential_uuid,
            "call_after_seconds": call_after_seconds,
            "country_hint": country_hint,
            "last_lead_time": int(now.timestamp()),
            "connected_via": connected_via,
            "webhook_subscribed": webhook_subscribed,
        },
    }
    campaign = await db_client.update_campaign(
        campaign_id=campaign.id,
        orchestrator_metadata=metadata,
        state="running",
        started_at=now,
        source_last_synced_at=now,
        source_sync_status="completed",
    )

    # Kick an immediate first poll; the poller cron handles it thereafter.
    await enqueue_job(FunctionNames.POLL_META_LEADS, campaign.id)

    logger.info(
        f"Connected Meta form {form_id} ({form_name}) as evergreen campaign "
        f"{campaign.id} for org {organization_id}"
    )
    return _connection_view(campaign, workflow_name)


async def update_connection(
    *,
    organization_id: int,
    campaign_id: int,
    workflow_id: Optional[int] = None,
    call_after_seconds: Optional[int] = None,
    max_retries: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> Optional[Dict[str, Any]]:
    """Update a connection's agent / timing / retries / active state.

    Returns None if the connection isn't found for this org.
    """
    campaign = await db_client.get_campaign(campaign_id, organization_id)
    if not campaign or campaign.source_type != SOURCE_TYPE:
        return None

    updates: Dict[str, Any] = {}

    if workflow_id is not None:
        wf_name = await db_client.get_workflow_name(
            workflow_id, organization_id=organization_id
        )
        if not wf_name:
            raise MetaConnectionError("Selected agent (workflow) not found")
        updates["workflow_id"] = workflow_id

    if max_retries is not None:
        updates["retry_config"] = _build_retry_config(max_retries)

    if call_after_seconds is not None:
        metadata = campaign.orchestrator_metadata or {}
        meta = {
            **(metadata.get("meta") or {}),
            "call_after_seconds": call_after_seconds,
        }
        updates["orchestrator_metadata"] = {**metadata, "meta": meta}

    if updates:
        campaign = await db_client.update_campaign(campaign_id=campaign_id, **updates)

    # Active toggle maps to running <-> paused via the runner (guards state).
    if enabled is not None:
        if enabled and campaign.state == "paused":
            await campaign_runner_service.resume_campaign(campaign_id)
        elif not enabled and campaign.state == "running":
            await campaign_runner_service.pause_campaign(campaign_id)
        campaign = await db_client.get_campaign(campaign_id, organization_id)

    workflow_name = await db_client.get_workflow_name(
        campaign.workflow_id, organization_id=organization_id
    )
    return _connection_view(campaign, workflow_name)


async def disconnect(organization_id: int, campaign_id: int) -> bool:
    """Disconnect a Meta connection: stop polling, revoke the stored token.

    Pauses the campaign (so the poller skips it), soft-deletes the credential,
    and marks the connection disconnected so it drops out of the list. History
    (past runs) is retained. Returns False if not found for this org.
    """
    campaign = await db_client.get_campaign(campaign_id, organization_id)
    if not campaign or campaign.source_type != SOURCE_TYPE:
        return False

    if campaign.state == "running":
        try:
            await campaign_runner_service.pause_campaign(campaign_id)
        except ValueError:
            pass

    metadata = campaign.orchestrator_metadata or {}
    meta = metadata.get("meta") or {}
    credential_uuid = meta.get("credential_uuid")
    if credential_uuid:
        await db_client.delete_credential(credential_uuid, organization_id)

    meta = {**meta, "disconnected": True}
    await db_client.update_campaign(
        campaign_id=campaign_id, orchestrator_metadata={**metadata, "meta": meta}
    )

    logger.info(
        f"Disconnected Meta connection (campaign {campaign_id}) for org {organization_id}"
    )
    return True
