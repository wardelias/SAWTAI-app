"""Tests for reactivation sequences: quiet-hours math, engagement heuristics,
stop-on-response, enrollment dedup/suppression, orchestrator advancement, the
real outbound-call path (provider faked), call-result scheduling, SMS steps,
manual stop/delete, leads-campaign outcomes and the HTTP API.

Run with:
    source venv/bin/activate && set -a && source api/.env.test && set +a \
        && python -m pytest api/tests/test_reactivation_sequences.py
"""

import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.services.leads import sequence_orchestrator as orch_mod
from api.services.leads import sequence_outcome as outcome_mod
from api.services.leads.sequence_orchestrator import _next_allowed_time
from api.services.quota_service import QuotaCheckResult
from api.services.telephony import outbound as outbound_mod
from api.services.telephony.base import CallInitiationResult

# ---------------------------------------------------------------------------
# Pure unit tests — quiet hours
# ---------------------------------------------------------------------------


def test_next_allowed_time_disabled_when_unset():
    now = datetime(2026, 1, 1, 22, 0, tzinfo=UTC)
    assert _next_allowed_time(now, "UTC", None, None) is None
    assert _next_allowed_time(now, "UTC", 9, 9) is None  # equal == disabled


def test_next_allowed_time_none_without_timezone():
    now = datetime(2026, 1, 1, 22, 0, tzinfo=UTC)
    assert _next_allowed_time(now, None, 21, 9) is None


def test_next_allowed_time_outside_window_is_allowed():
    # 12:00 UTC, quiet 21->09 → not blocked
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    assert _next_allowed_time(now, "UTC", 21, 9) is None


def test_next_allowed_time_blocks_and_reschedules_wraparound():
    # 22:00 UTC is inside 21->09; next allowed is 09:00 the following day.
    now = datetime(2026, 1, 1, 22, 0, tzinfo=UTC)
    nxt = _next_allowed_time(now, "UTC", 21, 9)
    assert nxt == datetime(2026, 1, 2, 9, 0, tzinfo=UTC)


def test_next_allowed_time_blocks_same_day_window():
    # 13:30 inside 12->14; next allowed 14:00 same day.
    now = datetime(2026, 1, 1, 13, 30, tzinfo=UTC)
    nxt = _next_allowed_time(now, "UTC", 12, 14)
    assert nxt == datetime(2026, 1, 1, 14, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Pure unit tests — engagement / outcome heuristics
# ---------------------------------------------------------------------------


def test_engaged_true_for_conversational_disposition():
    assert outcome_mod._engaged({"call_disposition": "interested"}) is True


def test_engaged_false_for_no_contact_disposition():
    for d in ("no-answer", "busy", "voicemail", "failed", "voicemail_detected"):
        assert outcome_mod._engaged({"call_disposition": d}) is False


def test_engaged_false_for_system_failures_and_silence():
    for d in ("pipeline_error", "unexpected_error", "user_idle_max_duration_exceeded"):
        assert outcome_mod._engaged({"call_disposition": d}) is False


def test_engaged_hangup_depends_on_user_speech():
    assert outcome_mod._engaged({"call_disposition": "user_hangup"}) is False
    assert (
        outcome_mod._engaged(
            {"call_disposition": "user_hangup", "call_tags": ["user_speech"]}
        )
        is True
    )


def test_engaged_falls_back_to_nodes_visited():
    assert outcome_mod._engaged({"nodes_visited": ["start", "qualify"]}) is True
    assert outcome_mod._engaged({"nodes_visited": ["start"]}) is False
    assert outcome_mod._engaged({}) is False


def test_resulting_lead_status_maps_hints():
    assert (
        outcome_mod._resulting_lead_status({"call_disposition": "meeting_booked"})
        == "converted"
    )
    assert (
        outcome_mod._resulting_lead_status({"call_disposition": "Interested"})
        == "qualified"
    )
    assert (
        outcome_mod._resulting_lead_status({"call_disposition": "callback"})
        == "responded"
    )


def test_resulting_lead_status_respects_negation():
    assert (
        outcome_mod._resulting_lead_status({"call_disposition": "not_interested"})
        == "responded"
    )
    assert (
        outcome_mod._resulting_lead_status({"call_disposition": "no sale"})
        == "responded"
    )


def test_opted_out_dispositions():
    assert outcome_mod._opted_out({"call_disposition": "Do Not Call"}) is True
    assert outcome_mod._opted_out({"call_disposition": "opt-out"}) is True
    assert outcome_mod._opted_out({"call_disposition": "interested"}) is False


@pytest.mark.asyncio
async def test_handle_completion_ignores_unrelated_run():
    run = SimpleNamespace(
        id=1, initial_context={}, gathered_context={}, campaign_id=None
    )
    with patch.object(
        outcome_mod.db_client, "get_workflow_run_by_id", AsyncMock(return_value=run)
    ):
        with patch.object(
            outcome_mod.db_client, "stop_enrollment", AsyncMock()
        ) as stop:
            await outcome_mod.handle_lead_call_completion(1)
            stop.assert_not_awaited()


# ---------------------------------------------------------------------------
# Integration tests (test database)
# ---------------------------------------------------------------------------


async def _make_org(db_session) -> tuple[int, int]:
    user, _ = await db_session.get_or_create_user_by_provider_id(
        f"seq-user-{uuid.uuid4()}"
    )
    org, _ = await db_session.get_or_create_organization_by_provider_id(
        f"seq-org-{uuid.uuid4()}", user.id
    )
    return org.id, user.id


async def _make_agent(db_session, org_id: int, user_id: int):
    return await db_session.create_workflow(
        name="Reactivation agent",
        workflow_definition={"nodes": [], "edges": []},
        user_id=user_id,
        organization_id=org_id,
    )


async def _make_due(db_session, enrollment_id: int, org_id: int) -> None:
    await db_session.update_enrollment(
        enrollment_id, org_id, next_step_at=datetime.now(UTC) - timedelta(seconds=1)
    )


async def _enrollment(db_session, sequence_id: int, org_id: int) -> dict:
    rows = await db_session.list_enrollments_for_sequence(sequence_id, org_id)
    assert len(rows) == 1
    return rows[0]


class _FakeProvider:
    PROVIDER_NAME = "twilio"
    WEBHOOK_ENDPOINT = "twiml"

    def __init__(self):
        self.calls = []
        self.sms = []

    async def initiate_call(self, **kwargs):
        self.calls.append(kwargs)
        return CallInitiationResult(
            call_id=f"CA{len(self.calls)}",
            status="queued",
            provider_metadata={"call_id": f"CA{len(self.calls)}"},
        )

    async def send_sms(self, to_number, body):
        self.sms.append((to_number, body))
        return f"SM{len(self.sms)}"


@contextmanager
def fake_telephony(config_id: int = 4242):
    """Fake only the carrier boundary; everything else (run creation, definition
    pinning, quota signature) runs for real."""
    provider = _FakeProvider()
    with (
        patch(
            "api.services.telephony.outbound_readiness.resolve_outbound_configuration_id",
            AsyncMock(return_value=config_id),
        ),
        patch(
            "api.services.telephony.factory.get_telephony_provider_by_id",
            AsyncMock(return_value=provider),
        ),
        patch.object(
            outbound_mod,
            "authorize_workflow_run_start",
            # autospec enforces the real keyword-only signature.
            autospec=True,
            side_effect=lambda **_: QuotaCheckResult(has_quota=True),
        ) as authorize,
        patch.object(
            outbound_mod,
            "get_backend_endpoints",
            AsyncMock(return_value=("https://api.example.test", None)),
        ),
    ):
        provider.authorize = authorize
        yield provider


@pytest.mark.asyncio
async def test_enroll_leads_skips_dnc_and_dedupes(db_session):
    org_id, user_id = await _make_org(db_session)
    good = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    dnc = await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550101",
        dnc=True,
        status="suppressed",
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="wake up",
        steps=[{"channel": "sms", "delay_seconds": 0, "message_text": "hi"}],
        status="active",
    )

    first = await db_session.enroll_leads(sequence.id, org_id, [good.id, dnc.id])
    assert first == {"enrolled": 1, "skipped": 1}  # dnc skipped

    # Re-enrolling a lead that is still in progress is a no-op.
    second = await db_session.enroll_leads(sequence.id, org_id, [good.id])
    assert second == {"enrolled": 0, "skipped": 1}

    refreshed = await db_session.get_lead(good.id, org_id)
    assert refreshed.status == "enrolled"


@pytest.mark.asyncio
async def test_reenroll_restarts_finished_enrollment(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="again",
        steps=[{"channel": "sms", "delay_seconds": 0, "message_text": "hi"}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])
    enr = await _enrollment(db_session, sequence.id, org_id)
    await db_session.advance_enrollment(
        enr["id"], org_id, current_step=1, next_step_at=None, state="completed"
    )

    result = await db_session.enroll_leads(sequence.id, org_id, [lead.id])
    assert result == {"enrolled": 1, "skipped": 0}
    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["state"] == "active" and enr["current_step"] == 0


@pytest.mark.asyncio
async def test_paused_sequence_is_not_processed_until_resumed(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="paused",
        steps=[{"channel": "sms", "delay_seconds": 0, "message_text": "hi"}],
        status="paused",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    assert await orch_mod.sequence_orchestrator.process_due_enrollments() == 0
    assert (await _enrollment(db_session, sequence.id, org_id))["current_step"] == 0

    await db_session.update_sequence(sequence.id, org_id, status="active")
    assert await orch_mod.sequence_orchestrator.process_due_enrollments() == 1
    assert (await _enrollment(db_session, sequence.id, org_id))["current_step"] == 1


@pytest.mark.asyncio
async def test_sms_steps_respect_consent_and_complete(db_session):
    org_id, user_id = await _make_org(db_session)
    no_consent = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    consented = await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550101",
        first_name="Dana",
        consent_sms=True,
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="sms",
        steps=[
            {
                "channel": "sms",
                "delay_seconds": 0,
                "message_text": "Hi {{first_name}}!",
            },
            {"channel": "sms", "delay_seconds": 3600, "message_text": "Still there?"},
        ],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [no_consent.id, consented.id])

    with fake_telephony() as provider:
        assert await orch_mod.sequence_orchestrator.process_due_enrollments() == 2

    assert provider.sms == [("+14155550101", "Hi Dana!")]
    skipped = await db_session.list_lead_activities(no_consent.id, org_id)
    assert [a.type for a in skipped] == ["sms_skipped"]
    sent = await db_session.list_lead_activities(consented.id, org_id)
    assert [a.type for a in sent] == ["sms_sent"]
    assert (await db_session.get_lead(consented.id, org_id)).status == "contacted"

    rows = await db_session.list_enrollments_for_sequence(sequence.id, org_id)
    for enr in rows:
        assert enr["current_step"] == 1
        assert enr["state"] == "active"
        assert enr["next_step_at"] > datetime.now(UTC) + timedelta(minutes=50)
        await _make_due(db_session, enr["id"], org_id)

    with fake_telephony():
        await orch_mod.sequence_orchestrator.process_due_enrollments()
    for enr in await db_session.list_enrollments_for_sequence(sequence.id, org_id):
        assert enr["state"] == "completed"
        assert enr["next_step_at"] is None
    # Finished the cadence without engaging → unresponsive.
    assert (await db_session.get_lead(consented.id, org_id)).status == "unresponsive"


@pytest.mark.asyncio
async def test_orchestrator_quiet_hours_reschedules(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100", timezone="UTC"
    )
    now_hour = datetime.now(UTC).hour
    # A quiet window that definitely covers "now" in UTC.
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="quiet",
        steps=[{"channel": "sms", "delay_seconds": 0, "message_text": "hi"}],
        quiet_hours_start=now_hour,
        quiet_hours_end=(now_hour + 1) % 24,
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    await orch_mod.sequence_orchestrator.process_due_enrollments()

    enr = await _enrollment(db_session, sequence.id, org_id)
    # Step not executed: still on step 0, rescheduled into the future, active.
    assert enr["current_step"] == 0
    assert enr["state"] == "active"
    assert enr["next_step_at"] is not None and enr["next_step_at"] > datetime.now(UTC)
    assert await db_session.list_lead_activities(lead.id, org_id) == []


@pytest.mark.asyncio
async def test_voice_step_places_real_run_and_waits_for_result(db_session):
    """The full call-placement path: quota (real signature), pinned agent
    definition, pinned telephony config, lead variables, and the enrollment
    waiting on the call before scheduling step 2."""
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id,
        phone_number="+14155550100",
        first_name="Ada",
        attributes={"product": "Gold plan"},
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="voice",
        steps=[
            {"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id},
            {"channel": "voice", "delay_seconds": 2 * 86400, "workflow_id": agent.id},
        ],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    with fake_telephony(config_id=4242) as provider:
        assert await orch_mod.sequence_orchestrator.process_due_enrollments() == 1

    assert len(provider.calls) == 1
    call = provider.calls[0]
    assert call["to_number"] == "+14155550100"
    assert call["organization_id"] == org_id
    assert provider.authorize.call_args.kwargs["organization_id"] == org_id

    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["waiting_on_call"] is True
    assert enr["current_step"] == 1
    assert enr["last_error"] is None
    # Fallback only — the real schedule comes from the call result.
    assert enr["next_step_at"] > datetime.now(UTC) + timedelta(days=2)

    run = await db_session.get_workflow_run_by_id(enr["last_workflow_run_id"])
    assert run.definition_id is not None  # pipeline needs the pinned definition
    assert run.initial_context["telephony_configuration_id"] == 4242
    assert run.initial_context["first_name"] == "Ada"
    assert run.initial_context["product"] == "Gold plan"
    assert run.initial_context["sequence_enrollment_id"] == enr["id"]
    assert run.initial_context["direction"] == "outbound"

    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert [a.type for a in activities] == ["call_placed"]
    assert (await db_session.get_lead(lead.id, org_id)).status == "contacted"

    # Lead doesn't pick up → next step scheduled 2 days from the call's end.
    await db_session.update_workflow_run(
        run_id=run.id, gathered_context={"call_disposition": "no-answer"}
    )
    await outcome_mod.handle_lead_call_completion(run.id)
    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["waiting_on_call"] is False
    assert enr["state"] == "active"
    expected = datetime.now(UTC) + timedelta(days=2)
    assert abs((enr["next_step_at"] - expected).total_seconds()) < 60

    # A duplicate completion event changes nothing.
    await outcome_mod.handle_lead_call_completion(run.id)
    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert [a.type for a in activities].count("call_completed") == 1


@pytest.mark.asyncio
async def test_engaged_call_stops_cadence(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="voice",
        steps=[
            {"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id},
            {"channel": "voice", "delay_seconds": 60, "workflow_id": agent.id},
        ],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])
    with fake_telephony():
        await orch_mod.sequence_orchestrator.process_due_enrollments()
    enr = await _enrollment(db_session, sequence.id, org_id)

    await db_session.update_workflow_run(
        run_id=enr["last_workflow_run_id"],
        gathered_context={
            "call_disposition": "interested",
            "call_tags": ["user_speech"],
        },
    )
    await outcome_mod.handle_lead_call_completion(enr["last_workflow_run_id"])

    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["state"] == "stopped"
    assert enr["stop_reason"] == "responded:interested"
    assert enr["next_step_at"] is None
    assert (await db_session.get_lead(lead.id, org_id)).status == "qualified"


@pytest.mark.asyncio
async def test_opt_out_flags_dnc(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="voice",
        steps=[{"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])
    with fake_telephony():
        await orch_mod.sequence_orchestrator.process_due_enrollments()
    enr = await _enrollment(db_session, sequence.id, org_id)
    await db_session.update_workflow_run(
        run_id=enr["last_workflow_run_id"],
        gathered_context={
            "call_disposition": "do_not_call",
            "call_tags": ["user_speech"],
        },
    )
    await outcome_mod.handle_lead_call_completion(enr["last_workflow_run_id"])

    refreshed = await db_session.get_lead(lead.id, org_id)
    assert refreshed.dnc is True and refreshed.status == "suppressed"
    assert (await _enrollment(db_session, sequence.id, org_id))[
        "stop_reason"
    ] == "opted_out"


@pytest.mark.asyncio
async def test_failed_call_is_retried_then_skipped(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="voice",
        steps=[
            {"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id},
            {"channel": "voice", "delay_seconds": 3600, "workflow_id": agent.id},
        ],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    failing = AsyncMock(side_effect=outbound_mod.OutboundCallError("no caller ID"))
    with patch.object(orch_mod, "place_outbound_call", failing):
        for attempt in range(1, orch_mod.MAX_STEP_ATTEMPTS):
            await orch_mod.sequence_orchestrator.process_due_enrollments()
            enr = await _enrollment(db_session, sequence.id, org_id)
            assert enr["current_step"] == 0, attempt
            assert "no caller ID" in enr["last_error"]
            assert enr["next_step_at"] > datetime.now(UTC)
            await _make_due(db_session, enr["id"], org_id)
        await orch_mod.sequence_orchestrator.process_due_enrollments()

    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["current_step"] == 1  # gave up on step 1, moved on
    assert enr["state"] == "active"
    assert failing.await_count == orch_mod.MAX_STEP_ATTEMPTS


@pytest.mark.asyncio
async def test_unpublished_or_missing_telephony_surfaces_error(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="voice",
        steps=[{"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    # No telephony configuration exists for this org — real resolver.
    await orch_mod.sequence_orchestrator.process_due_enrollments()
    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["current_step"] == 0
    assert "telephony configuration" in enr["last_error"]


@pytest.mark.asyncio
async def test_stop_and_delete_release_leads(db_session):
    org_id, user_id = await _make_org(db_session)
    a = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    b = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550101"
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="stop me",
        steps=[{"channel": "sms", "delay_seconds": 3600, "message_text": "hi"}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [a.id, b.id])
    rows = await db_session.list_enrollments_for_sequence(sequence.id, org_id)
    a_enr = next(r for r in rows if r["lead_id"] == a.id)

    assert (
        await db_session.stop_enrollments(
            sequence.id, org_id, "stopped_manually", enrollment_ids=[a_enr["id"]]
        )
        == 1
    )
    assert (await db_session.get_lead(a.id, org_id)).status == "new"
    assert (await db_session.get_lead(b.id, org_id)).status == "enrolled"

    assert await db_session.delete_sequence(sequence.id, org_id) is True
    assert await db_session.get_sequence(sequence.id, org_id) is None
    assert (await db_session.get_lead(b.id, org_id)).status == "new"


@pytest.mark.asyncio
async def test_leads_campaign_call_updates_lead_and_stops_sequences(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="nurture",
        steps=[{"channel": "sms", "delay_seconds": 86400, "message_text": "hi"}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])
    campaign = await db_session.create_campaign(
        name="leads blast",
        workflow_id=agent.id,
        source_type="leads",
        source_id="all",
        user_id=user_id,
        organization_id=org_id,
    )
    run = await db_session.create_workflow_run(
        name="WR-CAMPAIGN",
        workflow_id=agent.id,
        mode="twilio",
        user_id=user_id,
        initial_context={"lead_id": lead.id, "phone_number": lead.phone_number},
        gathered_context={
            "call_disposition": "meeting_booked",
            "call_tags": ["user_speech"],
        },
        campaign_id=campaign.id,
        organization_id=org_id,
    )

    await outcome_mod.handle_lead_call_completion(run.id)

    refreshed = await db_session.get_lead(lead.id, org_id)
    assert refreshed.status == "converted"
    assert refreshed.last_contacted_at is not None
    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert [a.type for a in activities] == ["call_completed"]
    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["state"] == "converted"


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sequence_api_lifecycle(db_session, test_client_factory):
    org_id, user_id = await _make_org(db_session)
    user = await db_session.get_user_by_id(user_id)
    user.selected_organization_id = org_id
    agent = await _make_agent(db_session, org_id, user_id)
    await db_session.create_lead(organization_id=org_id, phone_number="+14155550100")
    await db_session.create_lead(organization_id=org_id, phone_number="+14155550101")

    async with test_client_factory(user) as client:
        bad = await client.post(
            "/api/v1/sequences",
            json={"name": "x", "steps": [{"channel": "voice", "delay_seconds": 0}]},
        )
        assert bad.status_code == 422

        bad_tz = await client.post(
            "/api/v1/sequences",
            json={
                "name": "x",
                "quiet_hours_start": 21,
                "quiet_hours_end": 9,
                "default_timezone": "Mars/Olympus",
                "steps": [{"channel": "voice", "workflow_id": agent.id}],
            },
        )
        assert bad_tz.status_code == 422

        created = await client.post(
            "/api/v1/sequences",
            json={
                "name": "Win-back",
                "status": "active",
                "quiet_hours_start": 21,
                "quiet_hours_end": 9,
                "default_timezone": "Asia/Jerusalem",
                "steps": [
                    {"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id},
                    {
                        "channel": "sms",
                        "delay_seconds": 86400,
                        "message_text": "Hi {{first_name}}",
                    },
                ],
            },
        )
        assert created.status_code == 201, created.text
        body = created.json()
        seq_id = body["id"]
        assert body["steps"][0]["workflow_name"] == "Reactivation agent"
        assert body["steps"][1]["message_text"] == "Hi {{first_name}}"

        enrolled = await client.post(
            f"/api/v1/sequences/{seq_id}/enroll", json={"lead_status": "new"}
        )
        assert enrolled.json() == {"enrolled": 2, "skipped": 0}

        paused = await client.patch(
            f"/api/v1/sequences/{seq_id}", json={"status": "paused"}
        )
        assert paused.status_code == 200, paused.text
        assert paused.json()["status"] == "paused"
        assert paused.json()["enrollment_counts"] == {"active": 2, "total": 2}

        edited = await client.patch(
            f"/api/v1/sequences/{seq_id}",
            json={
                "name": "Win-back v2",
                "steps": [
                    {"channel": "voice", "delay_seconds": 60, "workflow_id": agent.id}
                ],
            },
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["name"] == "Win-back v2"
        assert len(edited.json()["steps"]) == 1

        listing = await client.get(f"/api/v1/sequences/{seq_id}/enrollments")
        rows = listing.json()["enrollments"]
        assert listing.json()["total"] == 2
        assert {r["lead_phone"] for r in rows} == {"+14155550100", "+14155550101"}

        stopped = await client.post(
            f"/api/v1/sequences/{seq_id}/enrollments/stop",
            json={"enrollment_ids": [rows[0]["id"]]},
        )
        assert stopped.json() == {"stopped": 1}

        deleted = await client.delete(f"/api/v1/sequences/{seq_id}")
        assert deleted.status_code == 204
        assert (await client.get(f"/api/v1/sequences/{seq_id}")).status_code == 404


# ---------------------------------------------------------------------------
# Production session semantics (see ``prod_db`` in tests/conftest.py)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lifecycle_with_production_sessions(prod_db):
    from httpx import ASGITransport, AsyncClient

    from api.app import app
    from api.services.auth.depends import get_user

    db = prod_db
    org_id, user_id = await _make_org(db)
    user = await db.get_user_by_id(user_id)
    user.selected_organization_id = org_id
    agent = await _make_agent(db, org_id, user_id)
    talker = await db.create_lead(organization_id=org_id, phone_number="+14155550100")
    texter = await db.create_lead(
        organization_id=org_id, phone_number="+14155550101", consent_sms=True
    )

    async def _user():
        return user

    app.dependency_overrides[get_user] = _user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as client:
            created = await client.post(
                "/api/v1/sequences",
                json={
                    "name": "Prod-like",
                    "status": "paused",
                    "steps": [{"channel": "sms", "message_text": "hi"}],
                },
            )
            assert created.status_code == 201, created.text
            seq_id = created.json()["id"]

            edited = await client.patch(
                f"/api/v1/sequences/{seq_id}",
                json={
                    "status": "active",
                    "steps": [
                        {"channel": "voice", "workflow_id": agent.id},
                        {"channel": "sms", "delay_seconds": 60, "message_text": "hi"},
                    ],
                },
            )
            assert edited.status_code == 200, edited.text
            assert [s["channel"] for s in edited.json()["steps"]] == ["voice", "sms"]

            enrolled = await client.post(
                f"/api/v1/sequences/{seq_id}/enroll", json={"lead_status": "all"}
            )
            assert enrolled.json() == {"enrolled": 2, "skipped": 0}

            with fake_telephony() as provider:
                assert (
                    await orch_mod.sequence_orchestrator.process_due_enrollments() == 2
                )
            assert len(provider.calls) == 2

            rows = (await client.get(f"/api/v1/sequences/{seq_id}/enrollments")).json()
            by_lead = {r["lead_id"]: r for r in rows["enrollments"]}
            assert all(r["waiting_on_call"] for r in by_lead.values())

            # talker engages → stopped; texter doesn't answer → next step.
            await db.update_workflow_run(
                run_id=by_lead[talker.id]["last_workflow_run_id"],
                gathered_context={
                    "call_disposition": "interested",
                    "call_tags": ["user_speech"],
                },
            )
            await db.update_workflow_run(
                run_id=by_lead[texter.id]["last_workflow_run_id"],
                gathered_context={"call_disposition": "no-answer"},
            )
            for r in by_lead.values():
                await outcome_mod.handle_lead_call_completion(r["last_workflow_run_id"])

            listing = (await client.get(f"/api/v1/sequences/{seq_id}")).json()
            assert listing["enrollment_counts"]["stopped"] == 1
            assert listing["enrollment_counts"]["responded"] == 1
            assert listing["enrollment_counts"]["active"] == 1

            stopped = await client.post(
                f"/api/v1/sequences/{seq_id}/enrollments/stop", json={}
            )
            assert stopped.json() == {"stopped": 1}

            deleted = await client.delete(f"/api/v1/sequences/{seq_id}")
            assert deleted.status_code == 204
    finally:
        app.dependency_overrides.pop(get_user, None)

    assert (await db.get_lead(talker.id, org_id)).status == "qualified"


@pytest.mark.asyncio
async def test_result_arriving_before_wait_is_not_lost(db_session):
    """A call that fails instantly can report its result before the
    orchestrator marks the enrollment as waiting on it; the cadence must still
    move on right away instead of sitting until the fallback timeout."""
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    agent = await _make_agent(db_session, org_id, user_id)
    sequence = await db_session.create_sequence(
        organization_id=org_id,
        created_by=user_id,
        name="fast fail",
        steps=[
            {"channel": "voice", "delay_seconds": 0, "workflow_id": agent.id},
            {"channel": "voice", "delay_seconds": 600, "workflow_id": agent.id},
        ],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    async def place_and_fail_instantly(**kwargs):
        run = await db_session.create_workflow_run(
            name=kwargs["run_name"],
            workflow_id=kwargs["workflow_id"],
            mode="twilio",
            user_id=user_id,
            organization_id=org_id,
            initial_context={
                **kwargs["context_variables"],
                **kwargs["extra_initial_context"],
            },
            gathered_context={"call_disposition": "failed"},
        )
        await outcome_mod.handle_lead_call_completion(run.id)  # result lands first
        return run

    with patch.object(orch_mod, "place_outbound_call", place_and_fail_instantly):
        await orch_mod.sequence_orchestrator.process_due_enrollments()

    enr = await _enrollment(db_session, sequence.id, org_id)
    assert enr["waiting_on_call"] is False
    assert enr["current_step"] == 1
    expected = datetime.now(UTC) + timedelta(seconds=600)
    assert abs((enr["next_step_at"] - expected).total_seconds()) < 60
