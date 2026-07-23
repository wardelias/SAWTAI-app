"""Shared single outbound-call primitive.

``place_outbound_call`` encapsulates the essential steps to dial one number and
bind the call to an AI-agent workflow: resolve the provider for a telephony
config, create the ``WorkflowRunModel``, run the quota check, build the webhook
URL and initiate the call. It is provider-agnostic (the caller ID is chosen by
the provider when ``from_number`` is None).

The campaign dispatcher predates this and keeps its own richer variant (Redis
from-number pool, concurrency slots, circuit breaker). Reactivation sequences
use this lighter primitive; campaigns can be migrated onto it later without
changing behaviour visible to callers.
"""

from datetime import UTC, datetime
from typing import Any, Dict, Optional

from loguru import logger

from api.db import db_client
from api.db.models import WorkflowRunModel
from api.enums import WorkflowRunState
from api.services.quota_service import authorize_workflow_run_start
from api.utils.common import get_backend_endpoints


class OutboundCallError(Exception):
    """Raised when an outbound call could not be placed."""


async def place_outbound_call(
    *,
    organization_id: int,
    workflow_id: int,
    to_number: str,
    run_name: str,
    telephony_configuration_id: Optional[int] = None,
    context_variables: Optional[Dict[str, Any]] = None,
    extra_initial_context: Optional[Dict[str, Any]] = None,
) -> WorkflowRunModel:
    """Place a single outbound call bound to ``workflow_id``.

    ``context_variables`` (e.g. a lead's imported attributes) are merged into
    the run's ``initial_context`` and become template variables for the agent.
    ``extra_initial_context`` lets the caller stamp linkage keys (e.g.
    ``sequence_enrollment_id``) that post-call hooks read back.

    Returns the created run on success; raises ``OutboundCallError`` otherwise.
    """
    # Lazy import: importing the telephony factory at module load can trigger a
    # circular import via the provider package (mirrors the campaign dispatcher).
    from api.services.telephony.factory import (
        get_default_telephony_provider,
        get_telephony_provider_by_id,
    )

    workflow = await db_client.get_workflow_by_id(workflow_id)
    if not workflow:
        raise OutboundCallError(f"Workflow {workflow_id} not found")

    if telephony_configuration_id:
        provider = await get_telephony_provider_by_id(
            telephony_configuration_id, organization_id
        )
    else:
        provider = await get_default_telephony_provider(organization_id)

    initial_context: Dict[str, Any] = {
        **(context_variables or {}),
        "provider": provider.PROVIDER_NAME,
        "called_number": to_number,
        "telephony_configuration_id": telephony_configuration_id,
        **(extra_initial_context or {}),
    }

    workflow_run = await db_client.create_workflow_run(
        name=run_name,
        workflow_id=workflow_id,
        mode=provider.PROVIDER_NAME,
        user_id=workflow.user_id,
        initial_context=initial_context,
        organization_id=organization_id,
    )

    quota_result = await authorize_workflow_run_start(
        workflow_id=workflow_id,
        workflow_run_id=workflow_run.id,
    )
    if not quota_result.has_quota:
        error_message = quota_result.error_message or "Quota exceeded"
        await db_client.update_workflow_run(
            run_id=workflow_run.id,
            is_completed=True,
            state=WorkflowRunState.COMPLETED.value,
            gathered_context={"error": error_message},
        )
        raise OutboundCallError(error_message)

    try:
        backend_endpoint, _ = await get_backend_endpoints()
        webhook_url = (
            f"{backend_endpoint}/api/v1/telephony/{provider.WEBHOOK_ENDPOINT}"
            f"?workflow_id={workflow_id}"
            f"&user_id={workflow.user_id}"
            f"&workflow_run_id={workflow_run.id}"
            f"&organization_id={organization_id}"
        )

        call_result = await provider.initiate_call(
            to_number=to_number,
            webhook_url=webhook_url,
            workflow_run_id=workflow_run.id,
            from_number=None,  # provider selects an active caller ID
            workflow_id=workflow_id,
            user_id=workflow.user_id,
        )

        await db_client.update_workflow_run(
            run_id=workflow_run.id,
            gathered_context={
                "provider": provider.PROVIDER_NAME,
                **(call_result.provider_metadata or {}),
            },
        )
        logger.info(
            f"Placed outbound call for run {workflow_run.id} "
            f"(call_id={call_result.call_id})"
        )
    except Exception as e:
        logger.error(f"Failed to place outbound call for run {workflow_run.id}: {e}")
        await db_client.update_workflow_run(
            run_id=workflow_run.id,
            is_completed=True,
            state=WorkflowRunState.COMPLETED.value,
            gathered_context={"error": str(e)},
            logs={
                "telephony_status_callbacks": [
                    {
                        "status": "failed",
                        "timestamp": datetime.now(UTC).isoformat(),
                        "data": {"error": str(e)},
                    }
                ]
            },
        )
        raise OutboundCallError(str(e)) from e

    return workflow_run
