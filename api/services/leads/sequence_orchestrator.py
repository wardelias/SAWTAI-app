"""Reactivation sequence orchestrator.

Pull-based: on each tick it claims active enrollments of *active* sequences
whose current step is due (cross-org, SKIP LOCKED), then for each one executes
the step's channel action, records a lead activity, and schedules the next step
— respecting per-lead quiet hours and suppression (DNC / opted-out /
already-responded).

Voice steps delegate to the shared ``place_outbound_call`` primitive. While the
call is in flight the enrollment waits on it (``waiting_on_run_id``): the next
step is timed from when the call *ends*, and an engaged answer stops the
cadence before the next step can fire (see
``sequence_outcome.handle_lead_call_completion``). If the call result never
arrives, ``next_step_at`` holds a fallback so the lead is not stuck.

SMS steps send through the org's telephony configuration (Twilio) to leads who
consented to SMS. A step that fails to execute (no telephony config, quota,
provider error) is retried a few times before the cadence moves on.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger

from api.db import db_client
from api.services.telephony.outbound import OutboundCallError, place_outbound_call
from api.services.telephony.sms import SmsError, send_sms
from api.utils.template_renderer import render_template

_SUPPRESSED_LEAD_STATUSES = {"suppressed", "converted", "responded"}

# How long to wait for a voice step's call result before moving on anyway.
CALL_RESULT_TIMEOUT = timedelta(hours=1)
# A step that fails to execute is retried this many times in total, this far
# apart, before the cadence skips to the next step.
MAX_STEP_ATTEMPTS = 3
STEP_RETRY_DELAY = timedelta(minutes=15)


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


def lead_context(lead) -> Dict[str, Any]:
    """Template variables for a lead: imported attributes overlaid with the
    identity fields. Used by the agent on calls and by SMS text."""
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


@dataclass
class StepResult:
    """Outcome of executing one step.

    ``run_id`` is set when a call was placed (the enrollment then waits on it).
    ``error`` is set when the step could not execute and should be retried.
    """

    run_id: Optional[int] = None
    error: Optional[str] = None


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
                logger.exception(f"Error processing enrollment {enr.get('id')}: {e}")
                # Don't leave the row parked on the claim lease without a trace.
                try:
                    await db_client.update_enrollment(
                        enr["id"],
                        enr["organization_id"],
                        last_error=f"Internal error: {e}"[:500],
                        next_step_at=now + STEP_RETRY_DELAY,
                    )
                except Exception:
                    pass
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

        if sequence.status != "active":
            # Paused between claim and processing — hand it back untouched.
            await db_client.update_enrollment(enrollment_id, org_id, next_step_at=now)
            return

        # Suppression — never contact a DNC / opted-out / already-responded lead.
        if lead.dnc or lead.status in _SUPPRESSED_LEAD_STATUSES:
            reason = "dnc" if lead.dnc else lead.status
            await db_client.stop_enrollment(
                enrollment_id, org_id, stop_reason=f"suppressed:{reason}"
            )
            return

        if enr.get("waiting_on_run_id"):
            # The previous call's result never arrived within the timeout.
            logger.warning(
                f"Enrollment {enrollment_id}: no result for run "
                f"{enr['waiting_on_run_id']} — continuing the cadence"
            )
            await db_client.update_enrollment(
                enrollment_id, org_id, waiting_on_run_id=None
            )

        steps = sorted(sequence.steps, key=lambda s: s.step_order)
        if current_step >= len(steps):
            await complete_enrollment(enrollment_id, org_id, lead.id, len(steps))
            return

        step = steps[current_step]

        # Quiet hours — reschedule (do not advance) if the lead is in a blocked
        # window right now.
        tz_name = lead.timezone or sequence.default_timezone
        next_allowed = _next_allowed_time(
            now, tz_name, sequence.quiet_hours_start, sequence.quiet_hours_end
        )
        if next_allowed is not None:
            await db_client.update_enrollment(
                enrollment_id, org_id, next_step_at=next_allowed
            )
            return

        result = await self._execute_step(
            enrollment_id, org_id, sequence_id, lead, step
        )

        if result.error:
            attempts = int(enr.get("step_attempts") or 0) + 1
            if attempts < MAX_STEP_ATTEMPTS:
                await db_client.update_enrollment(
                    enrollment_id,
                    org_id,
                    step_attempts=attempts,
                    last_error=result.error[:500],
                    next_step_at=now + STEP_RETRY_DELAY,
                )
                return
            logger.warning(
                f"Enrollment {enrollment_id}: step {current_step + 1} failed "
                f"{attempts} times, moving on: {result.error}"
            )

        next_index = current_step + 1
        fields: Dict[str, Any] = {
            "current_step": next_index,
            "step_attempts": 0,
            "last_step_at": now,
            "last_error": result.error[:500] if result.error else None,
        }
        next_delay = (
            timedelta(seconds=int(steps[next_index].delay_seconds or 0))
            if next_index < len(steps)
            else timedelta(0)
        )

        if result.run_id is not None:
            # Wait for the call to finish; the outcome handler schedules the
            # next step from the call's end. This is only the fallback.
            await db_client.update_enrollment(
                enrollment_id,
                org_id,
                only_if_active=True,
                waiting_on_run_id=result.run_id,
                last_workflow_run_id=result.run_id,
                next_step_at=now + CALL_RESULT_TIMEOUT + next_delay,
                **fields,
            )
            # A call that failed instantly may have reported its result before
            # we started waiting on it; if so, move on now. (The outcome
            # handler records the result first and then checks the wait, so
            # one of the two always sees the other.)
            if await db_client.lead_activity_exists(
                lead.id, org_id, result.run_id, "call_completed"
            ):
                await resume_after_call(enrollment_id, org_id, lead.id, result.run_id)
            return

        if next_index < len(steps):
            await db_client.update_enrollment(
                enrollment_id,
                org_id,
                only_if_active=True,
                next_step_at=now + next_delay,
                **fields,
            )
        else:
            await db_client.update_enrollment(
                enrollment_id, org_id, only_if_active=True, **fields
            )
            await complete_enrollment(enrollment_id, org_id, lead.id, len(steps))

    async def _execute_step(
        self, enrollment_id: int, org_id: int, sequence_id: int, lead, step
    ) -> StepResult:
        channel = step.channel
        if channel == "voice":
            return await self._execute_voice(
                enrollment_id, org_id, sequence_id, lead, step
            )
        if channel == "sms":
            return await self._execute_sms(org_id, sequence_id, lead, step)

        # Email (and anything unknown) has no sender yet — record and move on.
        await db_client.add_lead_activity(
            lead_id=lead.id,
            organization_id=org_id,
            channel=channel,
            direction="outbound",
            activity_type=f"{channel}_skipped",
            payload={
                "reason": "channel_not_supported",
                "sequence_id": sequence_id,
                "step_order": step.step_order,
            },
        )
        return StepResult()

    async def _execute_voice(
        self, enrollment_id: int, org_id: int, sequence_id: int, lead, step
    ) -> StepResult:
        if not step.workflow_id:
            await db_client.add_lead_activity(
                lead_id=lead.id,
                organization_id=org_id,
                channel="voice",
                direction="outbound",
                activity_type="call_failed",
                payload={
                    "reason": "voice_step_missing_agent",
                    "sequence_id": sequence_id,
                    "step_order": step.step_order,
                },
            )
            # Retrying cannot fix a missing agent; skip the step.
            return StepResult()

        run_name = f"WR-SEQ-{sequence_id}-{enrollment_id}-s{step.step_order}"
        try:
            run = await place_outbound_call(
                organization_id=org_id,
                workflow_id=step.workflow_id,
                to_number=lead.phone_number,
                run_name=run_name,
                context_variables=lead_context(lead),
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
                lead_id=lead.id,
                organization_id=org_id,
                channel="voice",
                direction="outbound",
                activity_type="call_failed",
                payload={
                    "error": str(e),
                    "sequence_id": sequence_id,
                    "step_order": step.step_order,
                },
            )
            return StepResult(error=f"Call could not be placed: {e}")

        await db_client.add_lead_activity(
            lead_id=lead.id,
            organization_id=org_id,
            channel="voice",
            direction="outbound",
            activity_type="call_placed",
            workflow_run_id=run.id,
            payload={
                "sequence_id": sequence_id,
                "step_order": step.step_order,
                "workflow_id": step.workflow_id,
            },
            touch=True,
        )
        await mark_contacted(lead.id, org_id, lead.status)
        return StepResult(run_id=run.id)

    async def _execute_sms(
        self, org_id: int, sequence_id: int, lead, step
    ) -> StepResult:
        payload = {"sequence_id": sequence_id, "step_order": step.step_order}
        if not lead.consent_sms:
            await db_client.add_lead_activity(
                lead_id=lead.id,
                organization_id=org_id,
                channel="sms",
                direction="outbound",
                activity_type="sms_skipped",
                payload={**payload, "reason": "no_sms_consent"},
            )
            return StepResult()

        body = render_template(step.message_text or "", lead_context(lead)) or ""
        try:
            message_id = await send_sms(
                organization_id=org_id, to_number=lead.phone_number, body=body
            )
        except SmsError as e:
            await db_client.add_lead_activity(
                lead_id=lead.id,
                organization_id=org_id,
                channel="sms",
                direction="outbound",
                activity_type="sms_failed",
                payload={**payload, "error": str(e)},
            )
            return StepResult(error=f"SMS could not be sent: {e}")

        await db_client.add_lead_activity(
            lead_id=lead.id,
            organization_id=org_id,
            channel="sms",
            direction="outbound",
            activity_type="sms_sent",
            payload={**payload, "message_id": message_id, "body": body},
            touch=True,
        )
        await mark_contacted(lead.id, org_id, lead.status)
        return StepResult()


async def mark_contacted(lead_id: int, org_id: int, status: Optional[str]) -> None:
    """First outbound touch moves a lead from ``new``/``enrolled`` to
    ``contacted``."""
    if status in {"new", "enrolled", "unresponsive"}:
        await db_client.update_lead(lead_id, org_id, status="contacted")


async def resume_after_call(
    enrollment_id: int, org_id: int, lead_id: int, workflow_run_id: int
) -> None:
    """The call an enrollment was waiting on ended without stopping the
    cadence: schedule the next step from now (the call's end), or complete.
    Safe to call twice — only the first caller finds the enrollment waiting."""
    waiting = await db_client.finish_waiting_call(
        enrollment_id, org_id, workflow_run_id
    )
    if waiting is None:
        return  # already moved on (timed out or handled) or stopped meanwhile
    steps = await db_client.get_sequence_steps(waiting["sequence_id"], org_id)
    next_index = waiting["current_step"]
    if next_index < len(steps):
        delay = int(steps[next_index].delay_seconds or 0)
        await db_client.update_enrollment(
            enrollment_id,
            org_id,
            next_step_at=datetime.now(UTC) + timedelta(seconds=delay),
        )
    else:
        await complete_enrollment(enrollment_id, org_id, lead_id, len(steps))


async def complete_enrollment(
    enrollment_id: int, org_id: int, lead_id: int, total_steps: int
) -> None:
    """All steps ran without the lead engaging."""
    await db_client.advance_enrollment(
        enrollment_id,
        org_id,
        current_step=total_steps,
        next_step_at=None,
        state="completed",
        waiting_on_run_id=None,
        only_if_active=True,  # never overwrite a stop/conversion
    )
    await mark_unresponsive_if_untouched(lead_id, org_id)


async def mark_unresponsive_if_untouched(lead_id: int, org_id: int) -> None:
    """A lead who finished a cadence without engaging becomes
    ``unresponsive`` (unless something else already moved them on)."""
    lead = await db_client.get_lead(lead_id, org_id)
    if lead and lead.status in {"enrolled", "contacted"}:
        active = await db_client.get_active_enrollments_for_lead(lead_id, org_id)
        if not active:
            await db_client.update_lead(lead_id, org_id, status="unresponsive")


sequence_orchestrator = SequenceOrchestrator()
