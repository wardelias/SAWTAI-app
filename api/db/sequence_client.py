from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, func, update
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
# the call is being placed. The orchestrator overwrites it with the real
# schedule once the step has run.
_CLAIM_LEASE_SECONDS = 900

_ENROLLMENT_FIELDS = {
    "current_step",
    "next_step_at",
    "state",
    "stop_reason",
    "waiting_on_run_id",
    "last_workflow_run_id",
    "last_error",
    "last_step_at",
    "step_attempts",
}


def _step_rows(
    sequence_id: int, organization_id: int, steps: List[Dict[str, Any]]
) -> List[SequenceStepModel]:
    return [
        SequenceStepModel(
            sequence_id=sequence_id,
            organization_id=organization_id,
            step_order=order,
            channel=step["channel"],
            delay_seconds=int(step.get("delay_seconds") or 0),
            workflow_id=step.get("workflow_id"),
            message_template_id=step.get("message_template_id"),
            message_text=step.get("message_text"),
            stop_on_response=step.get("stop_on_response", True),
        )
        for order, step in enumerate(steps)
    ]


class SequenceClient(BaseDBClient):
    """Data access for reactivation sequences, steps and enrollments.

    All reads/writes are organization-scoped, except ``claim_due_enrollments``
    which runs cross-org from the orchestrator.
    """

    # --- Sequences & steps -------------------------------------------------

    async def _load_sequence(self, session, sequence_id: int):
        result = await session.execute(
            select(ReactivationSequenceModel)
            .options(selectinload(ReactivationSequenceModel.steps))
            .where(ReactivationSequenceModel.id == sequence_id)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one()

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
            # Capture before commit: production sessions expire ORM state on
            # commit, and touching it afterwards would lazy-load outside the
            # async context (MissingGreenlet).
            sequence_id = sequence.id

            session.add_all(_step_rows(sequence_id, organization_id, steps))

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

            return await self._load_sequence(session, sequence_id)

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
        self,
        sequence_id: int,
        organization_id: int,
        steps: Optional[List[Dict[str, Any]]] = None,
        **fields: Any,
    ) -> Optional[ReactivationSequenceModel]:
        """Update sequence settings and, when ``steps`` is given, replace the
        step list. Active enrollments keep their position (step index)."""
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
            sequence.updated_at = datetime.now(UTC)

            if steps is not None:
                await session.execute(
                    delete(SequenceStepModel).where(
                        SequenceStepModel.sequence_id == sequence_id,
                        SequenceStepModel.organization_id == organization_id,
                    )
                )
                await session.flush()
                session.add_all(_step_rows(sequence_id, organization_id, steps))

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            return await self._load_sequence(session, sequence_id)

    async def delete_sequence(self, sequence_id: int, organization_id: int) -> bool:
        """Delete a sequence with its steps and enrollments. Leads that were
        only ``enrolled`` (never contacted) by it go back to ``new``."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ReactivationSequenceModel).where(
                    ReactivationSequenceModel.id == sequence_id,
                    ReactivationSequenceModel.organization_id == organization_id,
                )
            )
            sequence = result.scalar_one_or_none()
            if not sequence:
                return False

            enrolled_ids = select(LeadSequenceEnrollmentModel.lead_id).where(
                LeadSequenceEnrollmentModel.sequence_id == sequence_id,
                LeadSequenceEnrollmentModel.state == "active",
            )
            await self._release_enrolled_leads(
                session, organization_id, enrolled_ids, exclude_sequence_id=sequence_id
            )
            await session.execute(
                delete(LeadSequenceEnrollmentModel).where(
                    LeadSequenceEnrollmentModel.sequence_id == sequence_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                )
            )
            await session.delete(sequence)
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            return True

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

    async def get_enrollment_stats(
        self, sequence_ids: List[int], organization_id: int
    ) -> Dict[int, Dict[str, int]]:
        """Return ``{sequence_id: {state: count, ..., "responded": n,
        "total": n}}``. ``responded`` counts enrollments the lead ended by
        engaging (including conversions), as opposed to manual stops."""
        if not sequence_ids:
            return {}
        responded = func.coalesce(
            LeadSequenceEnrollmentModel.stop_reason.like("responded:%"), False
        )
        async with self.async_session() as session:
            result = await session.execute(
                select(
                    LeadSequenceEnrollmentModel.sequence_id,
                    LeadSequenceEnrollmentModel.state,
                    responded,
                    func.count(LeadSequenceEnrollmentModel.id),
                )
                .where(
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                    LeadSequenceEnrollmentModel.sequence_id.in_(sequence_ids),
                )
                .group_by(
                    LeadSequenceEnrollmentModel.sequence_id,
                    LeadSequenceEnrollmentModel.state,
                    responded,
                )
            )
            stats: Dict[int, Dict[str, int]] = {}
            for sequence_id, state, is_response, count in result.all():
                bucket = stats.setdefault(sequence_id, {"total": 0})
                bucket[state] = bucket.get(state, 0) + int(count)
                bucket["total"] += int(count)
                if is_response:
                    bucket["responded"] = bucket.get("responded", 0) + int(count)
            return stats

    # --- Enrollments -------------------------------------------------------

    async def enroll_leads(
        self,
        sequence_id: int,
        organization_id: int,
        lead_ids: List[int],
        start_at: Optional[datetime] = None,
    ) -> Dict[str, int]:
        """Enroll leads into a sequence. Skips leads that are suppressed/DNC or
        already actively enrolled. A lead whose earlier run through this
        sequence has finished (completed/stopped) is restarted from step 1.
        Sets each newly-enrolled lead's status to ``enrolled``.
        Returns counts of ``enrolled`` and ``skipped``."""
        lead_ids = list(dict.fromkeys(lead_ids))
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
            insert_stmt = pg_insert(LeadSequenceEnrollmentModel).values(values)
            stmt = insert_stmt.on_conflict_do_update(
                constraint="uq_enrollment_sequence_lead",
                set_={
                    "current_step": 0,
                    "state": "active",
                    "next_step_at": insert_stmt.excluded.next_step_at,
                    "stop_reason": None,
                    "waiting_on_run_id": None,
                    "last_error": None,
                    "step_attempts": 0,
                    "updated_at": datetime.now(UTC),
                },
                # Never reset an enrollment that is still in progress.
                where=LeadSequenceEnrollmentModel.state != "active",
            ).returning(LeadSequenceEnrollmentModel.lead_id)
            result = await session.execute(stmt)
            enrolled_lead_ids = set(result.scalars().all())

            # Move newly-enrolled leads into the ``enrolled`` lifecycle state
            # (a lead already being worked keeps its more specific status).
            for lead in eligible:
                if lead.id in enrolled_lead_ids and lead.status in {
                    "new",
                    "unresponsive",
                }:
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
        """Atomically claim active enrollments of *active* sequences whose
        current step is due, across all orgs, using SELECT FOR UPDATE SKIP
        LOCKED. Leases each claimed row by pushing ``next_step_at`` forward so
        concurrent workers skip it. Enrollments of paused/draft sequences are
        left untouched and fire as soon as the sequence is activated.

        Returns lightweight dicts (the ORM rows are not used after the session
        closes)."""
        now = now or datetime.now(UTC)
        lease_until = now + timedelta(seconds=_CLAIM_LEASE_SECONDS)

        async with self.async_session() as session:
            query = (
                select(LeadSequenceEnrollmentModel)
                .join(
                    ReactivationSequenceModel,
                    ReactivationSequenceModel.id
                    == LeadSequenceEnrollmentModel.sequence_id,
                )
                .where(
                    LeadSequenceEnrollmentModel.state == "active",
                    LeadSequenceEnrollmentModel.next_step_at.isnot(None),
                    LeadSequenceEnrollmentModel.next_step_at <= now,
                    ReactivationSequenceModel.status == "active",
                )
                .order_by(LeadSequenceEnrollmentModel.next_step_at)
                .limit(limit)
                .with_for_update(of=LeadSequenceEnrollmentModel, skip_locked=True)
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
                        "waiting_on_run_id": enr.waiting_on_run_id,
                        "step_attempts": enr.step_attempts or 0,
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

    async def update_enrollment(
        self,
        enrollment_id: int,
        organization_id: int,
        only_if_active: bool = False,
        **fields: Any,
    ) -> None:
        """Set enrollment bookkeeping fields. Unknown keys are ignored. With
        ``only_if_active`` the write is skipped once the enrollment has ended
        (e.g. a stop that raced ahead of it)."""
        values = {k: v for k, v in fields.items() if k in _ENROLLMENT_FIELDS}
        if not values:
            return
        values["updated_at"] = datetime.now(UTC)
        conditions = [
            LeadSequenceEnrollmentModel.id == enrollment_id,
            LeadSequenceEnrollmentModel.organization_id == organization_id,
        ]
        if only_if_active:
            conditions.append(LeadSequenceEnrollmentModel.state == "active")
        async with self.async_session() as session:
            await session.execute(
                update(LeadSequenceEnrollmentModel).where(*conditions).values(**values)
            )
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

    async def advance_enrollment(
        self,
        enrollment_id: int,
        organization_id: int,
        current_step: int,
        next_step_at: Optional[datetime],
        state: str = "active",
        **fields: Any,
    ) -> None:
        await self.update_enrollment(
            enrollment_id,
            organization_id,
            current_step=current_step,
            next_step_at=next_step_at,
            state=state,
            **fields,
        )

    async def finish_waiting_call(
        self,
        enrollment_id: int,
        organization_id: int,
        workflow_run_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Atomically clear ``waiting_on_run_id`` if the enrollment is still
        active and waiting on ``workflow_run_id``. Returns the enrollment's
        ``{id, sequence_id, lead_id, current_step}``, or ``None`` when it wasn't
        waiting on this call (already handled, timed out, or stopped)."""
        async with self.async_session() as session:
            result = await session.execute(
                select(LeadSequenceEnrollmentModel)
                .where(
                    LeadSequenceEnrollmentModel.id == enrollment_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                    LeadSequenceEnrollmentModel.state == "active",
                    LeadSequenceEnrollmentModel.waiting_on_run_id == workflow_run_id,
                )
                .with_for_update()
            )
            enr = result.scalar_one_or_none()
            if not enr:
                return None
            snapshot = {
                "id": enr.id,
                "sequence_id": enr.sequence_id,
                "lead_id": enr.lead_id,
                "current_step": enr.current_step,
            }
            enr.waiting_on_run_id = None
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            return snapshot

    async def stop_enrollment(
        self,
        enrollment_id: int,
        organization_id: int,
        stop_reason: str,
        state: str = "stopped",
    ) -> None:
        await self.update_enrollment(
            enrollment_id,
            organization_id,
            state=state,
            stop_reason=stop_reason,
            next_step_at=None,
            waiting_on_run_id=None,
        )

    async def stop_enrollments(
        self,
        sequence_id: int,
        organization_id: int,
        stop_reason: str,
        enrollment_ids: Optional[List[int]] = None,
    ) -> int:
        """Manually stop active enrollments of a sequence (all of them, or just
        ``enrollment_ids``). Leads that were only ``enrolled`` and have no
        other active enrollment go back to ``new``. Returns the count stopped."""
        async with self.async_session() as session:
            conditions = [
                LeadSequenceEnrollmentModel.sequence_id == sequence_id,
                LeadSequenceEnrollmentModel.organization_id == organization_id,
                LeadSequenceEnrollmentModel.state == "active",
            ]
            if enrollment_ids is not None:
                if not enrollment_ids:
                    return 0
                conditions.append(LeadSequenceEnrollmentModel.id.in_(enrollment_ids))

            result = await session.execute(
                update(LeadSequenceEnrollmentModel)
                .where(*conditions)
                .values(
                    state="stopped",
                    stop_reason=stop_reason,
                    next_step_at=None,
                    waiting_on_run_id=None,
                    updated_at=datetime.now(UTC),
                )
                .returning(LeadSequenceEnrollmentModel.lead_id)
            )
            lead_ids = list(result.scalars().all())
            if lead_ids:
                await self._release_enrolled_leads(session, organization_id, lead_ids)
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            return len(lead_ids)

    async def _release_enrolled_leads(
        self,
        session,
        organization_id: int,
        lead_ids,
        exclude_sequence_id: Optional[int] = None,
    ) -> None:
        """Return leads still in the bare ``enrolled`` state to ``new`` when no
        other active enrollment holds them."""
        other_active = select(LeadSequenceEnrollmentModel.lead_id).where(
            LeadSequenceEnrollmentModel.organization_id == organization_id,
            LeadSequenceEnrollmentModel.state == "active",
        )
        if exclude_sequence_id is not None:
            other_active = other_active.where(
                LeadSequenceEnrollmentModel.sequence_id != exclude_sequence_id
            )
        await session.execute(
            update(LeadModel)
            .where(
                LeadModel.organization_id == organization_id,
                LeadModel.id.in_(lead_ids),
                LeadModel.status == "enrolled",
                LeadModel.id.notin_(other_active),
            )
            .values(status="new")
        )

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
        self,
        sequence_id: int,
        organization_id: int,
        state: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Enrollments with the lead's display fields, newest first."""
        async with self.async_session() as session:
            query = (
                select(LeadSequenceEnrollmentModel, LeadModel)
                .join(LeadModel, LeadModel.id == LeadSequenceEnrollmentModel.lead_id)
                .where(
                    LeadSequenceEnrollmentModel.sequence_id == sequence_id,
                    LeadSequenceEnrollmentModel.organization_id == organization_id,
                )
            )
            if state:
                query = query.where(LeadSequenceEnrollmentModel.state == state)
            query = (
                query.order_by(
                    LeadSequenceEnrollmentModel.created_at.desc(),
                    LeadSequenceEnrollmentModel.id.desc(),
                )
                .limit(limit)
                .offset(offset)
            )
            result = await session.execute(query)
            rows: List[Dict[str, Any]] = []
            for enr, lead in result.all():
                name = " ".join(
                    part for part in (lead.first_name, lead.last_name) if part
                )
                rows.append(
                    {
                        "id": enr.id,
                        "sequence_id": enr.sequence_id,
                        "lead_id": enr.lead_id,
                        "lead_name": name or None,
                        "lead_phone": lead.phone_number,
                        "lead_status": lead.status,
                        "current_step": enr.current_step,
                        "state": enr.state,
                        "next_step_at": enr.next_step_at,
                        "stop_reason": enr.stop_reason,
                        "waiting_on_call": enr.waiting_on_run_id is not None,
                        "last_workflow_run_id": enr.last_workflow_run_id,
                        "last_error": enr.last_error,
                        "last_step_at": enr.last_step_at,
                        "created_at": enr.created_at,
                    }
                )
            return rows

    async def count_enrollments_for_sequence(
        self, sequence_id: int, organization_id: int, state: Optional[str] = None
    ) -> int:
        async with self.async_session() as session:
            query = select(func.count(LeadSequenceEnrollmentModel.id)).where(
                LeadSequenceEnrollmentModel.sequence_id == sequence_id,
                LeadSequenceEnrollmentModel.organization_id == organization_id,
            )
            if state:
                query = query.where(LeadSequenceEnrollmentModel.state == state)
            result = await session.execute(query)
            return int(result.scalar() or 0)
