"""Meta (Facebook) Instant Form lead source.

A Meta connection is modeled as a long-lived "evergreen" campaign
(``source_type="meta_instant_form"``). This sync service is the ingestion half:
it polls the Graph API for new leads on the form and turns each into a
``queued_run`` scheduled ``call_after_seconds`` after the lead was submitted, so
the existing orchestrator/dispatcher/telephony stack calls them automatically.

Unlike the one-shot CSV source, this NEVER completes the campaign — the poller
calls it repeatedly and new leads trickle in indefinitely.

Connection config lives on ``campaign.orchestrator_metadata["meta"]``::

    {
        "page_id": "...",
        "form_id": "...",
        "form_name": "...",
        "credential_uuid": "...",     # -> ExternalCredential holding the token
        "call_after_seconds": 300,
        "country_hint": "US",          # optional, disambiguates local numbers
        "last_lead_time": 1719000000,  # epoch high-watermark (advanced per poll)
    }
"""

from datetime import UTC, datetime, timedelta
from typing import Optional

from loguru import logger

from api.db import db_client
from api.services.campaign.source_sync import (
    CampaignSourceSyncService,
    ValidationResult,
)
from api.services.marketing import meta_graph_client
from api.utils.telephony_address import normalize_telephony_address

# Candidate Meta field names, in priority order, for the values we care about.
_PHONE_FIELDS = (
    "phone_number",
    "phone",
    "mobile_number",
    "mobile",
    "work_phone_number",
)
_NAME_FIELDS = ("full_name", "name")


def _parse_meta_time(value: str) -> Optional[datetime]:
    """Parse Meta's ``created_time`` (e.g. ``2024-06-01T12:34:56+0000``)."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        # Fall back to fromisoformat for any offset variant.
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None


def _extract_phone(flat: dict, country_hint: Optional[str]) -> Optional[str]:
    """Pull the first present phone field and normalize to E.164 (leading +).

    Returns None if no field is present or the value isn't a real PSTN number
    (``validate_source_data`` and telephony both require a leading ``+``).
    """
    for key in _PHONE_FIELDS:
        raw = (flat.get(key) or "").strip()
        if not raw:
            continue
        try:
            normalized = normalize_telephony_address(raw, country_hint)
        except ValueError:
            continue
        if normalized.address_type == "pstn":
            return normalized.canonical
    return None


def _extract_name(flat: dict) -> str:
    for key in _NAME_FIELDS:
        val = (flat.get(key) or "").strip()
        if val:
            return val
    first = (flat.get("first_name") or "").strip()
    last = (flat.get("last_name") or "").strip()
    return " ".join(p for p in (first, last) if p)


class MetaInstantFormSyncService(CampaignSourceSyncService):
    """Polls a Meta lead form and queues new leads for calling."""

    async def validate_source(
        self, source_id: str, organization_id: Optional[int] = None
    ) -> ValidationResult:
        """No-op for the campaign-create path.

        Real validation (token can read the form) happens at connect time in the
        marketing service, which has the access token. Meta campaigns are created
        via the marketing route, not the generic campaign-create route, so this
        is only here to satisfy the abstract base.
        """
        return ValidationResult(is_valid=True)

    async def sync_source_data(self, campaign_id: int) -> int:
        """Poll the Graph API for new leads and create queued_runs.

        Returns the number of new leads queued this poll. Does not change
        campaign state (evergreen).
        """
        campaign = await db_client.get_campaign_by_id(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")

        metadata = campaign.orchestrator_metadata or {}
        meta = metadata.get("meta") or {}
        form_id = meta.get("form_id")
        credential_uuid = meta.get("credential_uuid")
        if not form_id or not credential_uuid:
            logger.warning(
                f"Campaign {campaign_id} missing meta form_id/credential_uuid; skipping poll"
            )
            return 0

        # Load the Page access token from the credential subsystem (org-scoped).
        credential = await db_client.get_credential_by_uuid(
            credential_uuid, campaign.organization_id
        )
        if not credential:
            logger.warning(
                f"Campaign {campaign_id} meta credential {credential_uuid} not found "
                "or inactive; skipping poll"
            )
            return 0
        access_token = (credential.credential_data or {}).get("token")
        if not access_token:
            logger.warning(
                f"Campaign {campaign_id} meta credential has no token; skipping poll"
            )
            return 0

        call_after_seconds = int(meta.get("call_after_seconds") or 0)
        country_hint = meta.get("country_hint")
        last_lead_time = meta.get("last_lead_time")

        candidates: dict[str, dict] = {}  # source_uuid -> queued_run payload
        max_lead_epoch = int(last_lead_time or 0)
        skipped_no_phone = 0

        try:
            async for lead in meta_graph_client.iter_leads(
                form_id, access_token, since_epoch=last_lead_time
            ):
                leadgen_id = lead.get("id")
                if not leadgen_id:
                    continue
                source_uuid = f"meta_{leadgen_id}"

                flat = meta_graph_client.flatten_field_data(lead.get("field_data"))
                phone = _extract_phone(flat, country_hint)
                if not phone:
                    skipped_no_phone += 1
                    continue

                created_dt = _parse_meta_time(lead.get("created_time")) or datetime.now(
                    UTC
                )
                scheduled_for = created_dt + timedelta(seconds=call_after_seconds)
                max_lead_epoch = max(max_lead_epoch, int(created_dt.timestamp()))

                context_variables = {
                    **flat,
                    "phone_number": phone,
                    "name": _extract_name(flat),
                    "leadgen_id": leadgen_id,
                }

                candidates[source_uuid] = {
                    "campaign_id": campaign_id,
                    "source_uuid": source_uuid,
                    "context_variables": context_variables,
                    "state": "queued",
                    "scheduled_for": scheduled_for,
                }
        except ValueError as e:
            # Graph API failure — record it but don't crash the poller sweep.
            logger.error(f"Campaign {campaign_id} Meta lead poll failed: {e}")
            await db_client.append_campaign_log(
                campaign_id=campaign_id,
                level="error",
                event="meta_poll_failed",
                message=f"Meta lead poll failed: {e}",
                details={"error": str(e)},
            )
            return 0

        # Dedupe against leads already queued from earlier overlapping polls.
        new_runs = []
        if candidates:
            existing = await db_client.get_existing_source_uuids(
                campaign_id, list(candidates.keys())
            )
            new_runs = [
                payload for uuid, payload in candidates.items() if uuid not in existing
            ]

        if new_runs:
            await db_client.bulk_create_queued_runs(new_runs)
            logger.info(
                f"Campaign {campaign_id} Meta poll queued {len(new_runs)} new lead(s) "
                f"(skipped {skipped_no_phone} without a valid phone)"
            )

        # Advance the high-watermark + sync bookkeeping. Only bump last_lead_time
        # when it actually moved forward so we never skip un-fetched leads.
        now = datetime.now(UTC)
        updates: dict = {
            "source_last_synced_at": now,
            "source_sync_status": "completed",
        }
        if max_lead_epoch > int(last_lead_time or 0):
            merged_meta = {**meta, "last_lead_time": max_lead_epoch}
            updates["orchestrator_metadata"] = {**metadata, "meta": merged_meta}
        if new_runs:
            updates["total_rows"] = (campaign.total_rows or 0) + len(new_runs)
        await db_client.update_campaign(campaign_id=campaign_id, **updates)

        return len(new_runs)
