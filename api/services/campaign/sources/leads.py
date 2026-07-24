"""Campaign source that draws from the persistent ``leads`` database instead of
an uploaded CSV.

The campaign's ``source_id`` holds a lead-status filter (e.g. ``"new"``,
``"unresponsive"``, or ``"all"``). Only callable leads are queued — DNC and
suppressed leads are always excluded, mirroring the reactivation engine.
"""

from typing import Any, Dict, List, Optional

from loguru import logger

from api.db import db_client
from api.services.campaign.source_sync import (
    CampaignSourceSyncService,
    ValidationError,
    ValidationResult,
)


def _normalized_status(source_id: Optional[str]) -> Optional[str]:
    if not source_id or source_id.strip().lower() in {"", "all", "any"}:
        return None
    return source_id.strip()


def _lead_context(lead) -> Dict[str, Any]:
    """Build the per-lead template context the agent sees on the call. Imported
    attributes are the base; identity fields overlay them."""
    ctx: Dict[str, Any] = dict(lead.attributes or {})
    ctx.update(
        {
            "phone_number": lead.phone_number,
            "first_name": lead.first_name or "",
            "last_name": lead.last_name or "",
            "email": lead.email or "",
            "lead_id": lead.id,
        }
    )
    return ctx


class LeadsSyncService(CampaignSourceSyncService):
    """Queues callable leads from the persistent lead database."""

    async def validate_source(
        self, source_id: str, organization_id: Optional[int] = None
    ) -> ValidationResult:
        if organization_id is None:
            return ValidationResult(
                is_valid=False,
                error=ValidationError(message="Organization is required"),
            )

        leads = await db_client.get_callable_leads(
            organization_id, status=_normalized_status(source_id)
        )
        if not leads:
            return ValidationResult(
                is_valid=False,
                error=ValidationError(
                    message="No callable leads match this filter. Import leads or "
                    "pick a different status (DNC/suppressed leads are excluded)."
                ),
            )

        # Present the leads as headers+rows so the shared phone/duplicate and
        # template-variable validation behaves exactly like the CSV source.
        contexts = [_lead_context(lead) for lead in leads]
        headers = sorted({key for ctx in contexts for key in ctx.keys()})
        rows = [[str(ctx.get(h, "")) for h in headers] for ctx in contexts]
        return self.validate_source_data(headers, rows)

    async def sync_source_data(self, campaign_id: int) -> int:
        """Snapshot the matching leads into queued_runs for this campaign."""
        campaign = await db_client.get_campaign_by_id(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")

        leads = await db_client.get_callable_leads(
            campaign.organization_id, status=_normalized_status(campaign.source_id)
        )

        queued_runs: List[Dict[str, Any]] = []
        for lead in leads:
            queued_runs.append(
                {
                    "campaign_id": campaign_id,
                    "source_uuid": f"lead_{lead.id}",
                    "context_variables": _lead_context(lead),
                    "state": "queued",
                }
            )

        if queued_runs:
            await db_client.bulk_create_queued_runs(queued_runs)
            logger.info(
                f"Queued {len(queued_runs)} leads for campaign {campaign_id}"
            )

        await db_client.update_campaign(
            campaign_id=campaign_id,
            total_rows=len(queued_runs),
            source_sync_status="completed",
        )
        return len(queued_runs)
