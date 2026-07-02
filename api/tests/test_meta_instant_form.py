"""Tests for the Meta Instant Form lead source + evergreen campaign behavior.

Covers the ingestion service (normalization, scheduling, dedupe, error handling,
never-completes) and the orchestrator evergreen guard.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.campaign.sources.meta_instant_form import MetaInstantFormSyncService

MODULE = "api.services.campaign.sources.meta_instant_form"


def _lead(lead_id: str, phone: str, created: str = "2024-06-01T12:00:00+0000", **extra):
    field_data = [{"name": "full_name", "values": ["Jane Doe"]}]
    if phone is not None:
        field_data.append({"name": "phone_number", "values": [phone]})
    for k, v in extra.items():
        field_data.append({"name": k, "values": [v]})
    return {"id": lead_id, "created_time": created, "field_data": field_data}


def _campaign(**meta_overrides):
    meta = {
        "form_id": "FORM123",
        "credential_uuid": "cred-uuid",
        "call_after_seconds": 300,
        "last_lead_time": 1000,
        **meta_overrides,
    }
    return SimpleNamespace(
        id=42,
        organization_id=7,
        orchestrator_metadata={"evergreen": True, "meta": meta},
        total_rows=0,
        retry_config={},
    )


def _agen(leads):
    async def gen(*args, **kwargs):
        for lead in leads:
            yield lead

    return gen


def _patched_db(existing=None):
    """Return a mocked db_client with sensible defaults for a poll."""
    db = MagicMock()
    db.get_campaign_by_id = AsyncMock(return_value=_campaign())
    db.get_credential_by_uuid = AsyncMock(
        return_value=SimpleNamespace(credential_data={"token": "TOKEN"})
    )
    db.get_existing_source_uuids = AsyncMock(return_value=set(existing or []))
    db.bulk_create_queued_runs = AsyncMock()
    db.update_campaign = AsyncMock()
    db.append_campaign_log = AsyncMock()
    return db


class TestMetaInstantFormSync:
    @pytest.mark.asyncio
    async def test_queues_new_leads_with_schedule_offset(self):
        db = _patched_db()
        leads = [_lead("L1", "+1 (555) 123-0001"), _lead("L2", "+15551230002")]
        with (
            patch(f"{MODULE}.db_client", db),
            patch(f"{MODULE}.meta_graph_client.iter_leads", _agen(leads)),
        ):
            count = await MetaInstantFormSyncService().sync_source_data(42)

        assert count == 2
        db.bulk_create_queued_runs.assert_awaited_once()
        runs = db.bulk_create_queued_runs.call_args.args[0]
        by_uuid = {r["source_uuid"]: r for r in runs}
        assert set(by_uuid) == {"meta_L1", "meta_L2"}

        r1 = by_uuid["meta_L1"]
        assert r1["campaign_id"] == 42
        assert r1["state"] == "queued"
        # Phone normalized to E.164.
        assert r1["context_variables"]["phone_number"] == "+15551230001"
        assert r1["context_variables"]["leadgen_id"] == "L1"
        assert r1["context_variables"]["name"] == "Jane Doe"
        # scheduled_for = created_time (12:00:00Z) + call_after (300s) = 12:05:00Z
        assert r1["scheduled_for"] == datetime(
            2024, 6, 1, 12, 5, 0, tzinfo=timezone.utc
        )

    @pytest.mark.asyncio
    async def test_dedupes_already_queued_leads(self):
        db = _patched_db(existing={"meta_L1"})
        leads = [_lead("L1", "+15551230001"), _lead("L2", "+15551230002")]
        with (
            patch(f"{MODULE}.db_client", db),
            patch(f"{MODULE}.meta_graph_client.iter_leads", _agen(leads)),
        ):
            count = await MetaInstantFormSyncService().sync_source_data(42)

        assert count == 1
        runs = db.bulk_create_queued_runs.call_args.args[0]
        assert [r["source_uuid"] for r in runs] == ["meta_L2"]

    @pytest.mark.asyncio
    async def test_skips_leads_without_valid_phone(self):
        db = _patched_db()
        leads = [
            _lead("L1", None),
            _lead("L2", "not-a-phone"),
            _lead("L3", "+15551230003"),
        ]
        with (
            patch(f"{MODULE}.db_client", db),
            patch(f"{MODULE}.meta_graph_client.iter_leads", _agen(leads)),
        ):
            count = await MetaInstantFormSyncService().sync_source_data(42)

        assert count == 1
        runs = db.bulk_create_queued_runs.call_args.args[0]
        assert [r["source_uuid"] for r in runs] == ["meta_L3"]

    @pytest.mark.asyncio
    async def test_never_marks_campaign_complete(self):
        db = _patched_db()
        leads = [_lead("L1", "+15551230001")]
        with (
            patch(f"{MODULE}.db_client", db),
            patch(f"{MODULE}.meta_graph_client.iter_leads", _agen(leads)),
        ):
            await MetaInstantFormSyncService().sync_source_data(42)

        # Every update_campaign call must leave state alone (evergreen).
        for call in db.update_campaign.call_args_list:
            assert "state" not in call.kwargs

    @pytest.mark.asyncio
    async def test_advances_last_lead_time_watermark(self):
        db = _patched_db()
        leads = [_lead("L1", "+15551230001", created="2024-06-01T12:00:00+0000")]
        with (
            patch(f"{MODULE}.db_client", db),
            patch(f"{MODULE}.meta_graph_client.iter_leads", _agen(leads)),
        ):
            await MetaInstantFormSyncService().sync_source_data(42)

        # last_lead_time should advance to the newest lead's epoch.
        meta_updates = [
            c.kwargs["orchestrator_metadata"]
            for c in db.update_campaign.call_args_list
            if "orchestrator_metadata" in c.kwargs
        ]
        assert meta_updates, "expected orchestrator_metadata to be updated"
        expected_epoch = int(
            datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp()
        )
        assert meta_updates[-1]["meta"]["last_lead_time"] == expected_epoch

    @pytest.mark.asyncio
    async def test_graph_error_logs_and_returns_zero(self):
        db = _patched_db()

        def _boom(*args, **kwargs):
            async def gen():
                raise ValueError("Invalid OAuth access token")
                yield  # pragma: no cover

            return gen()

        with (
            patch(f"{MODULE}.db_client", db),
            patch(f"{MODULE}.meta_graph_client.iter_leads", _boom),
        ):
            count = await MetaInstantFormSyncService().sync_source_data(42)

        assert count == 0
        db.bulk_create_queued_runs.assert_not_awaited()
        db.append_campaign_log.assert_awaited_once()
        assert db.append_campaign_log.call_args.kwargs["event"] == "meta_poll_failed"

    @pytest.mark.asyncio
    async def test_missing_credential_skips_poll(self):
        db = _patched_db()
        db.get_credential_by_uuid = AsyncMock(return_value=None)
        with patch(f"{MODULE}.db_client", db):
            count = await MetaInstantFormSyncService().sync_source_data(42)

        assert count == 0
        db.bulk_create_queued_runs.assert_not_awaited()


class TestEvergreenGuard:
    @pytest.mark.asyncio
    async def test_evergreen_campaign_never_completes(self):
        from api.services.campaign.campaign_orchestrator import CampaignOrchestrator

        orch = CampaignOrchestrator(redis_client=AsyncMock())
        campaign = SimpleNamespace(id=1, orchestrator_metadata={"evergreen": True})
        assert await orch._should_mark_complete(campaign) is False
