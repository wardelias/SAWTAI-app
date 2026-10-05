"""Tests for the ``leads`` campaign source: queue callable leads from the
persistent lead database, excluding DNC/suppressed, with optional status filter.

Run with:
    source venv/bin/activate && set -a && source api/.env.test && set +a \
        && python -m pytest api/tests/test_campaign_leads_source.py
"""

import uuid

import pytest

from api.services.campaign.source_sync_factory import get_sync_service


async def _make_org(db_session) -> tuple[int, int]:
    user, _ = await db_session.get_or_create_user_by_provider_id(
        f"campleads-user-{uuid.uuid4()}"
    )
    org, _ = await db_session.get_or_create_organization_by_provider_id(
        f"campleads-org-{uuid.uuid4()}", user.id
    )
    return org.id, user.id


def test_factory_resolves_leads_source():
    from api.services.campaign.sources.leads import LeadsSyncService

    assert isinstance(get_sync_service("leads"), LeadsSyncService)


@pytest.mark.asyncio
async def test_get_callable_leads_excludes_dnc_and_suppressed(db_session):
    org_id, _ = await _make_org(db_session)
    await db_session.create_lead(organization_id=org_id, phone_number="+14155550100")
    await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550101",
        dnc=True,
        status="suppressed",
    )
    await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550102", status="contacted"
    )

    all_callable = await db_session.get_callable_leads(org_id)
    assert {lead.phone_number for lead in all_callable} == {
        "+14155550100",
        "+14155550102",
    }

    only_new = await db_session.get_callable_leads(org_id, status="new")
    assert [lead.phone_number for lead in only_new] == ["+14155550100"]


@pytest.mark.asyncio
async def test_validate_source_rejects_when_no_leads(db_session):
    org_id, _ = await _make_org(db_session)
    service = get_sync_service("leads")
    result = await service.validate_source("all", organization_id=org_id)
    assert result.is_valid is False


@pytest.mark.asyncio
async def test_validate_source_exposes_lead_columns(db_session):
    org_id, _ = await _make_org(db_session)
    await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550100",
        first_name="Ada",
        attributes={"last_product": "Gold"},
    )
    service = get_sync_service("leads")
    result = await service.validate_source("all", organization_id=org_id)
    assert result.is_valid is True
    # phone_number plus attribute columns are exposed for template validation.
    assert "phone_number" in result.headers
    assert "last_product" in result.headers


@pytest.mark.asyncio
async def test_sync_source_data_queues_callable_leads(db_session):
    org_id, user_id = await _make_org(db_session)
    workflow = await db_session.create_workflow(
        name="agent", workflow_definition={}, user_id=user_id, organization_id=org_id
    )
    await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550100",
        first_name="Ada",
        attributes={"last_product": "Gold"},
    )
    await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550101",
        dnc=True,
        status="suppressed",
    )
    campaign = await db_session.create_campaign(
        name="reactivate",
        workflow_id=workflow.id,
        source_type="leads",
        source_id="all",
        user_id=user_id,
        organization_id=org_id,
    )

    service = get_sync_service("leads")
    queued = await service.sync_source_data(campaign.id)
    assert queued == 1  # DNC lead excluded

    assert await db_session.get_queued_runs_count(campaign.id, ["queued"]) == 1

    rows = await db_session.execute_raw_query(
        "SELECT context_variables FROM queued_runs WHERE campaign_id = :cid",
        {"cid": campaign.id},
    )
    ctx = rows[0]["context_variables"]
    assert ctx["phone_number"] == "+14155550100"
    assert ctx["first_name"] == "Ada"
    assert ctx["last_product"] == "Gold"
    assert ctx["lead_id"] is not None
