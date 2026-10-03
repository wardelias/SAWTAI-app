"""Tests for reactivation sequences: quiet-hours math, engagement heuristics,
stop-on-response, enrollment dedup/suppression, and orchestrator advancement.

Run with:
    source venv/bin/activate && set -a && source api/.env.test && set +a \
        && python -m pytest api/tests/test_reactivation_sequences.py
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.services.leads import sequence_orchestrator as orch_mod
from api.services.leads import sequence_outcome as outcome_mod
from api.services.leads.sequence_orchestrator import _next_allowed_time


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
    # 22:00 UTC, quiet 21->09 (wraps midnight) → blocked, next allowed 09:00 next day
    now = datetime(2026, 1, 1, 22, 0, tzinfo=UTC)
    nxt = _next_allowed_time(now, "UTC", 21, 9)
    assert nxt is not None
    assert nxt == datetime(2026, 1, 2, 9, 0, tzinfo=UTC)


def test_next_allowed_time_blocks_same_day_window():
    # 10:00 UTC, quiet 09->12 (no wrap) → blocked, next allowed 12:00 same day
    now = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
    nxt = _next_allowed_time(now, "UTC", 9, 12)
    assert nxt == datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Pure unit tests — engagement / stop-on-response
# ---------------------------------------------------------------------------


def test_engaged_true_for_conversational_disposition():
    assert outcome_mod._engaged({"call_disposition": "interested"}) is True


def test_engaged_false_for_no_contact_disposition():
    assert outcome_mod._engaged({"call_disposition": "no_answer"}) is False
    assert outcome_mod._engaged({"mapped_call_disposition": "voicemail"}) is False


def test_engaged_falls_back_to_nodes_visited():
    assert outcome_mod._engaged({"nodes_visited": ["start", "q1"]}) is True
    assert outcome_mod._engaged({"nodes_visited": ["start"]}) is False
    assert outcome_mod._engaged({}) is False


def test_resulting_lead_status_maps_hints():
    assert outcome_mod._resulting_lead_status({"call_disposition": "meeting_booked"}) == "converted"
    assert outcome_mod._resulting_lead_status({"call_disposition": "qualified"}) == "qualified"
    assert outcome_mod._resulting_lead_status({"call_disposition": "interested"}) == "qualified"
    assert outcome_mod._resulting_lead_status({"call_disposition": "callback"}) == "responded"


@pytest.mark.asyncio
async def test_handle_completion_ignores_non_sequence_run():
    run = SimpleNamespace(initial_context={}, gathered_context={})
    with patch.object(
        outcome_mod.db_client, "get_workflow_run_by_id", AsyncMock(return_value=run)
    ):
        with patch.object(
            outcome_mod.db_client, "stop_enrollment", AsyncMock()
        ) as stop:
            await outcome_mod.handle_sequence_call_completion(1)
            stop.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_completion_stops_on_engagement():
    run = SimpleNamespace(
        initial_context={
            "sequence_enrollment_id": 5,
            "organization_id": 1,
            "lead_id": 2,
            "sequence_id": 3,
            "sequence_step_order": 0,
        },
        gathered_context={"call_disposition": "interested"},
    )
    step = SimpleNamespace(step_order=0, stop_on_response=True)
    with (
        patch.object(
            outcome_mod.db_client, "get_workflow_run_by_id", AsyncMock(return_value=run)
        ),
        patch.object(outcome_mod.db_client, "add_lead_activity", AsyncMock()),
        patch.object(
            outcome_mod.db_client, "get_sequence_steps", AsyncMock(return_value=[step])
        ),
        patch.object(outcome_mod.db_client, "update_lead", AsyncMock()) as upd,
        patch.object(outcome_mod.db_client, "stop_enrollment", AsyncMock()) as stop,
    ):
        await outcome_mod.handle_sequence_call_completion(10)
        upd.assert_awaited_once()
        stop.assert_awaited_once()
        assert stop.call_args.kwargs["state"] == "stopped"


@pytest.mark.asyncio
async def test_handle_completion_no_stop_when_not_engaged():
    run = SimpleNamespace(
        initial_context={
            "sequence_enrollment_id": 5,
            "organization_id": 1,
            "lead_id": 2,
            "sequence_id": 3,
            "sequence_step_order": 0,
        },
        gathered_context={"call_disposition": "no_answer"},
    )
    with (
        patch.object(
            outcome_mod.db_client, "get_workflow_run_by_id", AsyncMock(return_value=run)
        ),
        patch.object(outcome_mod.db_client, "add_lead_activity", AsyncMock()) as act,
        patch.object(outcome_mod.db_client, "stop_enrollment", AsyncMock()) as stop,
    ):
        await outcome_mod.handle_sequence_call_completion(10)
        act.assert_awaited_once()  # outcome still recorded
        stop.assert_not_awaited()  # but cadence continues


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


@pytest.mark.asyncio
async def test_enroll_leads_skips_dnc_and_dedupes(db_session):
    org_id, user_id = await _make_org(db_session)
    good = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    dnc = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550101", dnc=True, status="suppressed"
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id, created_by=user_id, name="wake up",
        steps=[{"channel": "sms", "delay_seconds": 0}], status="active",
    )

    first = await db_session.enroll_leads(sequence.id, org_id, [good.id, dnc.id])
    assert first == {"enrolled": 1, "skipped": 1}  # dnc skipped

    # Re-enrolling the same lead is a no-op (unique constraint).
    second = await db_session.enroll_leads(sequence.id, org_id, [good.id])
    assert second == {"enrolled": 0, "skipped": 1}

    refreshed = await db_session.get_lead(good.id, org_id)
    assert refreshed.status == "enrolled"


@pytest.mark.asyncio
async def test_orchestrator_advances_and_completes(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100"
    )
    # Two SMS steps: step 0 fires now, step 1 an hour later. SMS is a no-op
    # activity in Phase 2, so this exercises pure advancement without telephony.
    sequence = await db_session.create_sequence(
        organization_id=org_id, created_by=user_id, name="two step",
        steps=[
            {"channel": "sms", "delay_seconds": 0},
            {"channel": "sms", "delay_seconds": 3600},
        ],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    processed = await orch_mod.sequence_orchestrator.process_due_enrollments()
    assert processed == 1

    enrollments = await db_session.list_enrollments_for_sequence(sequence.id, org_id)
    enr = enrollments[0]
    assert enr.current_step == 1
    assert enr.state == "active"
    assert enr.next_step_at is not None

    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert any(a.type == "sms_skipped" for a in activities)

    # Force the second step due, then it should complete.
    await db_session.advance_enrollment(
        enr.id, org_id, current_step=1,
        next_step_at=datetime.now(UTC) - timedelta(seconds=1), state="active",
    )
    await orch_mod.sequence_orchestrator.process_due_enrollments()
    enr2 = (await db_session.list_enrollments_for_sequence(sequence.id, org_id))[0]
    assert enr2.state == "completed"
    assert enr2.next_step_at is None


@pytest.mark.asyncio
async def test_orchestrator_quiet_hours_reschedules(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100", timezone="UTC"
    )
    now_hour = datetime.now(UTC).hour
    # A quiet window that definitely covers "now" in UTC.
    sequence = await db_session.create_sequence(
        organization_id=org_id, created_by=user_id, name="quiet",
        steps=[{"channel": "sms", "delay_seconds": 0}],
        quiet_hours_start=now_hour, quiet_hours_end=(now_hour + 1) % 24,
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    await orch_mod.sequence_orchestrator.process_due_enrollments()

    enr = (await db_session.list_enrollments_for_sequence(sequence.id, org_id))[0]
    # Step not executed: still on step 0, rescheduled into the future, active.
    assert enr.current_step == 0
    assert enr.state == "active"
    assert enr.next_step_at is not None and enr.next_step_at > datetime.now(UTC)
    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert activities == []  # nothing sent during quiet hours


@pytest.mark.asyncio
async def test_orchestrator_places_voice_step(db_session):
    org_id, user_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100", status="enrolled"
    )
    workflow = await db_session.create_workflow(
        name="agent", workflow_definition={}, user_id=user_id, organization_id=org_id
    )
    sequence = await db_session.create_sequence(
        organization_id=org_id, created_by=user_id, name="voice",
        steps=[{"channel": "voice", "delay_seconds": 0, "workflow_id": workflow.id}],
        status="active",
    )
    await db_session.enroll_leads(sequence.id, org_id, [lead.id])

    fake_run = SimpleNamespace(id=None)  # None keeps the activity FK nullable
    with patch.object(
        orch_mod, "place_outbound_call", AsyncMock(return_value=fake_run)
    ) as place:
        await orch_mod.sequence_orchestrator.process_due_enrollments()

    place.assert_awaited_once()
    kwargs = place.call_args.kwargs
    assert kwargs["workflow_id"] == workflow.id
    assert kwargs["to_number"] == "+14155550100"
    assert kwargs["extra_initial_context"]["sequence_id"] == sequence.id

    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert any(a.type == "call_placed" for a in activities)
    # First outbound touch promotes enrolled -> contacted.
    refreshed = await db_session.get_lead(lead.id, org_id)
    assert refreshed.status == "contacted"
