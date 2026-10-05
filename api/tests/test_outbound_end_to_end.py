"""End-to-end outbound flows with only the carrier HTTP call faked.

Runs with production session semantics (``prod_db``). A real Twilio
telephony configuration + caller ID is stored, so readiness
checks, provider instantiation, caller-ID pools, concurrency slots (Redis),
definition pinning and post-call lead handling all run for real:

* Campaign from the Leads database: create (API) → start (API) → source sync
  task → batch dispatch → call outcome recorded on the lead.
* Reactivation sequence voice step through the real telephony resolver.

Run with:
    source venv/bin/activate && set -a && source api/.env.test && set +a \
        && python -m pytest api/tests/test_outbound_end_to_end.py
"""

import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from api.services.campaign import campaign_call_dispatcher as dispatcher_mod
from api.services.campaign.campaign_call_dispatcher import campaign_call_dispatcher
from api.services.leads import sequence_orchestrator as orch_mod
from api.services.leads import sequence_outcome as outcome_mod
from api.services.quota_service import QuotaCheckResult
from api.services.telephony import outbound as outbound_mod
from api.services.telephony.base import CallInitiationResult
from api.services.telephony.providers.twilio.provider import TwilioProvider
from api.tasks import campaign_tasks

_OK = QuotaCheckResult(has_quota=True)


@asynccontextmanager
async def _client_for(user):
    from httpx import ASGITransport, AsyncClient

    from api.app import app
    from api.services.auth.depends import get_user

    async def _user():
        return user

    app.dependency_overrides[get_user] = _user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_user, None)


async def _setup_org(db_session):
    user, _ = await db_session.get_or_create_user_by_provider_id(f"e2e-{uuid.uuid4()}")
    org, _ = await db_session.get_or_create_organization_by_provider_id(
        f"e2e-org-{uuid.uuid4()}", user.id
    )
    user.selected_organization_id = org.id
    config = await db_session.create_telephony_configuration(
        organization_id=org.id,
        name="Main Twilio",
        provider="twilio",
        credentials={"account_sid": "AC" + "0" * 32, "auth_token": "secret"},
        is_default_outbound=True,
    )
    await db_session.create_phone_number(
        organization_id=org.id,
        telephony_configuration_id=config.id,
        address="+15005550006",
        is_default_caller_id=True,
    )
    agent = await db_session.create_workflow(
        name="Win-back agent",
        workflow_definition={"nodes": [], "edges": []},
        user_id=user.id,
        organization_id=org.id,
    )
    return user, org.id, config.id, agent


class _Carrier:
    """Stands in for Twilio's REST API."""

    def __init__(self):
        self.calls = []

    async def initiate_call(self, provider, **kwargs):
        self.calls.append({"from_numbers": provider.from_numbers, **kwargs})
        sid = f"CA{len(self.calls):032d}"
        return CallInitiationResult(
            call_id=sid, status="queued", provider_metadata={"call_id": sid}
        )


@pytest.mark.asyncio
async def test_leads_campaign_end_to_end(prod_db):
    db_session = prod_db
    user, org_id, config_id, agent = await _setup_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100", first_name="Noa"
    )
    await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550101",
        dnc=True,
        status="suppressed",
    )

    carrier = _Carrier()
    enqueued = []

    async def fake_initiate(self, **kwargs):
        return await carrier.initiate_call(self, **kwargs)

    with (
        patch.object(TwilioProvider, "initiate_call", fake_initiate),
        patch(
            "api.routes.campaign.authorize_workflow_run_start",
            AsyncMock(return_value=_OK),
        ),
        patch.object(
            dispatcher_mod,
            "authorize_workflow_run_start",
            autospec=True,
            side_effect=lambda **_: _OK,
        ),
        patch(
            "api.services.campaign.runner.enqueue_job",
            AsyncMock(side_effect=lambda *a, **k: enqueued.append(a)),
        ),
        patch(
            "api.tasks.campaign_tasks.get_campaign_event_publisher",
            AsyncMock(return_value=AsyncMock()),
        ),
        patch.object(
            dispatcher_mod.rate_limiter, "acquire_token", AsyncMock(return_value=True)
        ),
    ):
        async with _client_for(user) as client:
            created = await client.post(
                "/api/v1/campaign/create",
                json={
                    "name": "Win back lapsed",
                    "workflow_id": agent.id,
                    "source_type": "leads",
                    "source_id": "all",
                    "telephony_configuration_id": config_id,
                },
            )
            assert created.status_code == 200, created.text
            campaign_id = created.json()["id"]
            assert created.json()["state"] == "created"

            started = await client.post(f"/api/v1/campaign/{campaign_id}/start")
            assert started.status_code == 200, started.text
            assert started.json()["state"] == "syncing"
            assert enqueued and enqueued[0][1] == campaign_id

        # Worker: source sync (normally an ARQ job).
        await campaign_tasks.sync_campaign_source({}, campaign_id)
        campaign = await db_session.get_campaign_by_id(campaign_id)
        assert campaign.state == "running"
        assert campaign.total_rows == 1  # DNC lead excluded

        # Worker: batch dispatch (normally scheduled by the orchestrator).
        dispatched = await campaign_call_dispatcher.process_batch(campaign_id)
        assert dispatched == 1

    assert len(carrier.calls) == 1
    call = carrier.calls[0]
    assert call["to_number"] == "+14155550100"
    assert call["from_number"] == "+15005550006"

    runs = await db_session.get_workflow_runs_by_campaign(campaign_id)
    assert len(runs) == 1
    run = runs[0]
    assert run.definition_id is not None
    assert run.initial_context["first_name"] == "Noa"
    assert run.initial_context["lead_id"] == lead.id

    # Call ends: the lead engaged and booked → lead converted.
    await db_session.update_workflow_run(
        run_id=run.id,
        gathered_context={
            "call_disposition": "meeting_booked",
            "call_tags": ["user_speech"],
        },
    )
    await outcome_mod.handle_lead_call_completion(run.id)
    refreshed = await db_session.get_lead(lead.id, org_id)
    assert refreshed.status == "converted"
    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert [a.type for a in activities] == ["call_completed"]


@pytest.mark.asyncio
async def test_sequence_voice_step_through_real_telephony_resolver(prod_db):
    db_session = prod_db
    user, org_id, config_id, agent = await _setup_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user.id,
        name="Wake up",
        steps=[{"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    carrier = _Carrier()

    async def fake_initiate(self, **kwargs):
        return await carrier.initiate_call(self, **kwargs)

    with (
        patch.object(TwilioProvider, "initiate_call", fake_initiate),
        patch.object(
            outbound_mod,
            "authorize_workflow_run_start",
            autospec=True,
            side_effect=lambda **_: _OK,
        ),
    ):
        assert await orch_mod.sequence_orchestrator.process_due_enrollments() == 1

    assert len(carrier.calls) == 1
    assert carrier.calls[0]["to_number"] == "+14155550100"
    enr = (await db_session.list_enrollments_for_sequence(sequence.id, org_id))[0]
    assert enr["last_error"] is None, enr["last_error"]
    run = await db_session.get_workflow_run_by_id(enr["last_workflow_run_id"])
    assert run.initial_context["telephony_configuration_id"] == config_id
    assert run.definition_id is not None

    # Unanswered final step → cadence completes, lead unresponsive.
    await db_session.update_workflow_run(
        run_id=run.id, gathered_context={"call_disposition": "no-answer"}
    )
    await outcome_mod.handle_lead_call_completion(run.id)
    enr = (await db_session.list_enrollments_for_sequence(sequence.id, org_id))[0]
    assert enr["state"] == "completed"
    assert (await db_session.get_lead(lead.id, org_id)).status == "unresponsive"
