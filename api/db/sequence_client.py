from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from api.db.base_client import BaseDBClient
from api.db.models import (
    LeadModel,
    LeadSequenceEnrollmentModel,
    ReactivationSequenceModel,
    SequenceStepModel,
)

# Lead statuses that must never be (re)enrolled into a reactivation sequence.
_SUPPRESSED_LEAD_STATUSES = {"suppressed", "converted", "responded"}

# When the orchestrator claims a due enrollment it pushes ``next_step_at`` this
# far into the future as a lease, so a second worker won't also claim it while
# the call is being placed. ``advance_enrollment`` overwrites it with the real
# schedule once the step succeeds.
_CLAIM_LEASE_SECONDS = 900


class SequenceClient(BaseDBClient):
    """Data access for reactivation sequences, steps and enrollments.

    All reads/writes are organization-scoped, except ``claim_due_enrollments``
    which runs cross-org from the orchestrator.
    """

    # --- Sequences & steps -------------------------------------------------

    async def create_sequence(
        self,
        organization_id: int,
        created_by: int,
        name: str,
        steps: List[Dict[str, Any]],
        quiet_hours_start: Optional[int] = None,
        quiet_hours_end: Optional[int] = None,
        default_timezone: Optional[str] = None,
        status: str = "draft",
    ) -> ReactivationSequenceModel:
        async with self.async_session() as session:
            sequence = ReactivationSequenceModel(
                organization_id=organization_id,
                created_by=created_by,
                name=name,
                status=status,
                quiet_hours_start=quiet_hours_start,
                quiet_hours_end=quiet_hours_end,
                default_timezone=default_timezone,
            )
            session.add(sequence)
            await session.flush()  # assign sequence.id

            for order, step in enumerate(steps):
                session.add(
                    SequenceStepModel(
                        sequence_id=sequence.id,
                        organization_id=organization_id,
                        step_order=order,
                        channel=step["channel"],
                        delay_seconds=int(step.get("delay_seconds", 0)),
                        workflow_id=step.get("workflow_id"),
                        message_template_id=step.get("message_template_id"),
                        stop_on_response=step.get("stop_on_response", True),
                    )
                )

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

            result = await session.execute(
                select(ReactivationSequenceModel)
                .options(selectinload(ReactivationSequenceModel.steps))
                .where(ReactivationSequenceModel.id == sequence.id)
            )
            return result.scalar_one()

    async def get_sequence(
        self, sequence_id: int, organization_id: int
    ) -> Optional[ReactivationSequenceModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ReactivationSequenceModel)
                .options(selectinload(ReactivationSequenceModel.steps))
                .where(
                    ReactivationSequenceModel.id == sequence_id,
                    ReactivationSequenceModel.organization_id == organization_id,
                )
            )
            return result.scalar_one_or_none()

    async def list_sequences(
        self, organization_id: int
    ) -> List[ReactivationSequenceModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ReactivationSequenceModel)
                .options(selectinload(ReactivationSequenceModel.steps))
                .where(ReactivationSequenceModel.organization_id == organization_id)
                .order_by(ReactivationSequenceModel.created_at.desc())
            )
            return list(result.scalars().all())

    async def update_sequence(
        self, sequence_id: int, organization_id: int, **fields: Any
    ) -> Optional[ReactivationSequenceModel]:
        allowed = {
            "name",
            "status",
            "quiet_hours_start",
            "quiet_hours_end",
            "default_timezone",
        }
        async with self.async_session() as session:
            result = await session.execute(
                select(ReactivationSequenceModel).where(
                    ReactivationSequenceModel.id == sequence_id,
                    ReactivationSequenceModel.organization_id == organization_id,
                )
            )
            sequence = result.scalar_one_or_none()
            if not sequence:
                return None
            for key, value in fields.items():
                if key in allowed:
                    setattr(sequence, key, value)
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            result = await session.execute(
                select(ReactivationSequenceModel)
                .options(selectinload(ReactivationSequenceModel.steps))
                .where(ReactivationSequenceModel.id == sequence_id)
            )
            return result.scalar_one()

    async def get_sequence_steps(
        self, sequence_id: int, organization_id: int
    ) -> List[SequenceStepModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(SequenceStepModel)
                .where(
                    SequenceStepModel.sequence_id == sequence_id,
                    SequenceStepModel.organization_id == organization_id,
                )
                .order_by(SequenceStepModel.step_order)
            )
            return list(result.scalars().all())

    # --- Enrollments -------------------------------------------------------

    async def enroll_leads(
        self,
        sequence_id: int,
        organization_id: int,
        lead_ids: List[int],
        start_at: Optional[datetime] = None,
    ) -> Dict[str, int]:
        """Enroll leads into a sequence. Skips leads that are suppressed/DNC or
        already enrolled. Sets each newly-enrolled lead's status to ``enrolled``.
        Returns counts of ``enrolled`` and ``skipped``."""
        if not lead_ids:
            return {"enrolled": 0, "skipped": 0}

        start_at = start_at or datetime.now(UTC)

        async with self.async_session() as session:
            # Only consider eligible leads that belong to the org.
            lead_rows = await session.execute(
                select(LeadModel).where(
                    LeadModel.organization_id == organization_id,
                    LeadModel.id.in_(lead_ids),
                )
            )
            leads = list(lead_rows.scalars().all())
            eligible = [
                lead
                for lead in leads
                if not lead.dnc and lead.status not in _SUPPRESSED_LEAD_STATUSES
            ]
            requested = len(lead_ids)
            if not eligible:
                return {"enrolled": 0, "skipped": requested}

            values = [
                {
                    "organization_id": organization_id,
                    "sequence_id": sequence_id,
                    "lead_id": lead.id,
                    "current_step": 0,
                    "state": "active",
                    "next_step_at": start_at,
                }
                for lead in eligible
            ]
            stmt = (
                pg_insert(LeadSequenceEnrollmentModel)
                .values(values)
                .on_conflict_do_nothing(constraint="uq_enrollment_sequence_lead")
                .returning(LeadSequenceEnrollmentModel.lead_id)
            )
            result = await session.execute(stmt)
            enrolled_lead_ids = set(result.scalars().all())

            # Move newly-enrolled leads into the ``enrolled`` lifecycle state.
            for lead in eligible:
                if lead.id in enrolled_lead_ids:
                    lead.status = "enrolled"

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

        enrolled = len(enrolled_lead_ids)
        return {"enrolled": enrolled, "skipped": requested - enrolled}

    async def claim_due_enrollments(
        self, limit: int = 20, now: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Atomically claim active enrollments whose current step is due, across
        all orgs, using SELECT FOR UPDATE SKIP LOCKED. Leases each claimed row by
        pushing ``next_step_at`` forward so concurrent workers skip it.

        Returns lightweight dicts (the ORM rows are not used after the session
        closes)."""
        now = now or datetime.now(UTC)
        lease_until = now + timedelta(seconds=_CLAIM_LEASE_SECONDS)

        async with self.async_session() as session:
            query = (
                select(LeadSequenceEnrollmentModel)
                .where(
                    LeadSequenceEnrollmentModel.state == "active",
                    LeadSequenceEnrollmentModel.next_step_at.isnot(None),
                    LeadSequenceEnrollmentModel.next_step_at <= now,
                )
                .order_by(LeadSequenceEnrollmentModel.next_step_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            result = await session.execute(query)
            enrollments = list(result.scalars().all())

            claimed: List[Dict[str, Any]] = []
            for enr in enrollments:
                claimed.append(
                    {
                        "id": enr.id,
                        "organization_id": enr.organization_id,
                        "sequence_id": enr.sequence_id,
                        "lead_id": enr.lead_id,
                        "current_step": enr.current_step,
                    }
                )
                # Lease so a sibling worker won't also claim this row.
                enr.next_step_at = lease_until

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

            return claimed

    async def get_enrollment(
        self, enrollment_id: int, organization_id: int
    ) -> Optional[LeadSequenceEnrollmentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(LeadSequenceEnrollmentModel).where(
                    LeadSequenceEnrollmentModel.id == enrollment_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                )
            )
            return result.scalar_one_or_none()

    async def advance_enrollment(
        self,
        enrollment_id: int,
        organization_id: int,
        current_step: int,
        next_step_at: Optional[datetime],
        state: str = "active",
    ) -> None:
        async with self.async_session() as session:
            result = await session.execute(
                select(LeadSequenceEnrollmentModel).where(
                    LeadSequenceEnrollmentModel.id == enrollment_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                )
            )
            enr = result.scalar_one_or_none()
            if not enr:
                return
            enr.current_step = current_step
            enr.next_step_at = next_step_at
            enr.state = state
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

    async def stop_enrollment(
        self,
        enrollment_id: int,
        organization_id: int,
        stop_reason: str,
        state: str = "stopped",
    ) -> None:
        async with self.async_session() as session:
            result = await session.execute(
                select(LeadSequenceEnrollmentModel).where(
                    LeadSequenceEnrollmentModel.id == enrollment_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                )
            )
            enr = result.scalar_one_or_none()
            if not enr:
                return
            enr.state = state
            enr.stop_reason = stop_reason
            enr.next_step_at = None
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

    async def get_active_enrollments_for_lead(
        self, lead_id: int, organization_id: int
    ) -> List[LeadSequenceEnrollmentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(LeadSequenceEnrollmentModel).where(
                    LeadSequenceEnrollmentModel.lead_id == lead_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                    LeadSequenceEnrollmentModel.state == "active",
                )
            )
            return list(result.scalars().all())

    async def list_enrollments_for_sequence(
        self, sequence_id: int, organization_id: int
    ) -> List[LeadSequenceEnrollmentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(LeadSequenceEnrollmentModel)
                .where(
                    LeadSequenceEnrollmentModel.sequence_id == sequence_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                )
                .order_by(LeadSequenceEnrollmentModel.created_at.desc())
            )
            return list(result.scalars().all())
