"""Reactivation sequence orchestrator.

Pull-based: on each tick it claims active enrollments whose current step is due
(cross-org, SKIP LOCKED), then for each one executes the step's channel action,
records a lead activity, and schedules the next step — respecting per-lead quiet
hours and suppression (DNC / opted-out / already-responded).

Voice steps delegate to the shared ``place_outbound_call`` primitive; the AI
agent's answers are captured by the existing pipeline and linked back via
``sequence_enrollment_id`` in the run's initial_context (see
``sequence_outcome.handle_sequence_call_completion``). SMS/email are recognised
here but their send is a no-op until Phases 3–4.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger

from api.db import db_client
from api.services.telephony.outbound import OutboundCallError, place_outbound_call

_SUPPRESSED_LEAD_STATUSES = {"suppressed", "converted", "responded"}
_UNIMPLEMENTED_CHANNELS = {"sms", "email"}


def _resolve_tz(name: Optional[str]) -> Optional[ZoneInfo]:
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning(f"Unknown timezone '{name}' — ignoring quiet hours")
        return None


def _next_allowed_time(
    now: datetime,
    tz_name: Optional[str],
    quiet_start: Optional[int],
    quiet_end: Optional[int],
) -> Optional[datetime]:
    """Return the next UTC time outside the quiet-hours window, or ``None`` if
    ``now`` is already allowed (no quiet window, unknown tz, or outside it).

    ``quiet_start``/``quiet_end`` are integer local hours [0, 24). The window is
    the *blocked* interval and may wrap past midnight (e.g. 21 → 9)."""
    if quiet_start is None or quiet_end is None or quiet_start == quiet_end:
        return None
    tz = _resolve_tz(tz_name)
    if tz is None:
        return None

    local = now.astimezone(tz)
    hour = local.hour
    if quiet_start < quiet_end:
        blocked = quiet_start <= hour < quiet_end
    else:  # wraps past midnight
        blocked = hour >= quiet_start or hour < quiet_end
    if not blocked:
        return None

    candidate = local.replace(hour=quiet_end % 24, minute=0, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    return candidate.astimezone(UTC)


class SequenceOrchestrator:
    def __init__(self, batch_size: int = 20):
        self.batch_size = batch_size

    async def process_due_enrollments(self) -> int:
        """Process one batch of due enrollments. Returns the number processed."""
        now = datetime.now(UTC)
        claimed = await db_client.claim_due_enrollments(limit=self.batch_size, now=now)
        if not claimed:
            return 0

        processed = 0
        for enr in claimed:
            try:
                await self._process_one(enr, now)
                processed += 1
            except Exception as e:  # never let one bad enrollment kill the batch
                logger.error(
                    f"Error processing enrollment {enr.get('id')}: {e}"
                )
        return processed

    async def _process_one(self, enr: Dict[str, Any], now: datetime) -> None:
        enrollment_id = enr["id"]
        org_id = enr["organization_id"]
        sequence_id = enr["sequence_id"]
        lead_id = enr["lead_id"]
        current_step = enr["current_step"]

        sequence = await db_client.get_sequence(sequence_id, org_id)
        lead = await db_client.get_lead(lead_id, org_id)
        if sequence is None or lead is None:
            await db_client.stop_enrollment(
                enrollment_id, org_id, stop_reason="lead_or_sequence_missing"
            )
            return

        # Suppression — never contact a DNC / opted-out / already-responded lead.
        if lead.dnc or lead.status in _SUPPRESSED_LEAD_STATUSES:
            await db_client.stop_enrollment(
                enrollment_id, org_id, stop_reason=f"suppressed:{lead.status}"
            )
            return

        steps = sorted(sequence.steps, key=lambda s: s.step_order)
        if current_step >= len(steps):
            await db_client.advance_enrollment(
                enrollment_id, org_id, current_step=current_step,
                next_step_at=None, state="completed",
            )
            return

        step = steps[current_step]

        # Quiet hours — reschedule (do not advance) if the lead is in a blocked
        # window right now.
        tz_name = lead.timezone or sequence.default_timezone
        next_allowed = _next_allowed_time(
            now, tz_name, sequence.quiet_hours_start, sequence.quiet_hours_end
        )
        if next_allowed is not None:
            await db_client.advance_enrollment(
                enrollment_id, org_id, current_step=current_step,
                next_step_at=next_allowed, state="active",
            )
            return

        await self._execute_step(enrollment_id, org_id, sequence_id, lead, step)

        # Schedule the next step, or complete the enrollment.
        next_index = current_step + 1
        if next_index < len(steps):
            delay = int(steps[next_index].delay_seconds or 0)
            await db_client.advance_enrollment(
                enrollment_id, org_id, current_step=next_index,
                next_step_at=now + timedelta(seconds=delay), state="active",
            )
        else:
            await db_client.advance_enrollment(
                enrollment_id, org_id, current_step=next_index,
                next_step_at=None, state="completed",
            )

    async def _execute_step(
        self, enrollment_id: int, org_id: int, sequence_id: int, lead, step
    ) -> None:
        channel = step.channel

        if channel in _UNIMPLEMENTED_CHANNELS:
            # Phases 3–4 implement SMS/email; record the intent for now.
            await db_client.add_lead_activity(
                lead_id=lead.id, organization_id=org_id, channel=channel,
                direction="outbound", activity_type=f"{channel}_skipped",
                payload={"reason": "channel_not_yet_implemented",
                         "sequence_id": sequence_id},
            )
            return

        if channel != "voice":
            logger.warning(f"Unknown channel '{channel}' on step {step.id}")
            return

        if not step.workflow_id:
            await db_client.add_lead_activity(
                lead_id=lead.id, organization_id=org_id, channel="voice",
                direction="outbound", activity_type="call_failed",
                payload={"reason": "voice_step_missing_workflow_id",
                         "sequence_id": sequence_id},
            )
            return

        context_vars = self._lead_context(lead)
        run_name = f"WR-SEQ-{sequence_id}-{enrollment_id}-s{step.step_order}"
        try:
            run = await place_outbound_call(
                organization_id=org_id,
                workflow_id=step.workflow_id,
                to_number=lead.phone_number,
                run_name=run_name,
                context_variables=context_vars,
                extra_initial_context={
                    "organization_id": org_id,
                    "sequence_enrollment_id": enrollment_id,
                    "sequence_id": sequence_id,
                    "lead_id": lead.id,
                    "sequence_step_order": step.step_order,
                },
            )
        except OutboundCallError as e:
            await db_client.add_lead_activity(
                lead_id=lead.id, organization_id=org_id, channel="voice",
                direction="outbound", activity_type="call_failed",
                payload={"error": str(e), "sequence_id": sequence_id},
            )
            return

        await db_client.add_lead_activity(
            lead_id=lead.id, organization_id=org_id, channel="voice",
            direction="outbound", activity_type="call_placed",
            workflow_run_id=run.id,
            payload={"sequence_id": sequence_id, "step_order": step.step_order},
            touch=True,
        )
        # First outbound touch moves the lead from ``enrolled`` to ``contacted``.
        if lead.status == "enrolled":
            await db_client.update_lead(lead.id, org_id, status="contacted")

    @staticmethod
    def _lead_context(lead) -> Dict[str, Any]:
        """Build the template-variable context the agent sees on the call."""
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


sequence_orchestrator = SequenceOrchestrator()
