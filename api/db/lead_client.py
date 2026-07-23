from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import LeadActivityModel, LeadModel


class LeadClient(BaseDBClient):
    """Data access for persistent leads and their activity timeline.

    All operations are organization-scoped. Leads are deduplicated within an
    organization on ``(organization_id, phone_number)``.
    """

    async def create_lead(
        self,
        organization_id: int,
        phone_number: str,
        email: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None,
        source: Optional[str] = None,
        external_id: Optional[str] = None,
        dnc: bool = False,
        consent_sms: bool = False,
        consent_email: bool = False,
        timezone: Optional[str] = None,
        status: str = "new",
    ) -> LeadModel:
        """Create a single lead. Raises on duplicate (org, phone_number)."""
        async with self.async_session() as session:
            lead = LeadModel(
                organization_id=organization_id,
                phone_number=phone_number,
                email=email,
                first_name=first_name,
                last_name=last_name,
                attributes=attributes or {},
                source=source,
                external_id=external_id,
                dnc=dnc,
                consent_sms=consent_sms,
                consent_email=consent_email,
                timezone=timezone,
                status=status,
            )
            session.add(lead)
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            await session.refresh(lead)
            return lead

    async def bulk_upsert_leads(
        self, organization_id: int, rows: List[Dict[str, Any]]
    ) -> Dict[str, int]:
        """Insert many leads, skipping ones that already exist for the org
        (deduplicated on phone_number). Returns counts of inserted/skipped.

        ``rows`` entries are plain dicts of column values; ``organization_id``
        is forced from the argument so callers cannot cross tenant boundaries.
        """
        if not rows:
            return {"inserted": 0, "skipped": 0, "total": 0}

        values = []
        for r in rows:
            values.append(
                {
                    "organization_id": organization_id,
                    "phone_number": r["phone_number"],
                    "email": r.get("email"),
                    "first_name": r.get("first_name"),
                    "last_name": r.get("last_name"),
                    "attributes": r.get("attributes") or {},
                    "source": r.get("source"),
                    "external_id": r.get("external_id"),
                    "dnc": r.get("dnc", False),
                    "consent_sms": r.get("consent_sms", False),
                    "consent_email": r.get("consent_email", False),
                    "timezone": r.get("timezone"),
                    "status": r.get("status", "new"),
                }
            )

        async with self.async_session() as session:
            stmt = (
                pg_insert(LeadModel)
                .values(values)
                .on_conflict_do_nothing(constraint="uq_leads_org_phone")
                .returning(LeadModel.id)
            )
            result = await session.execute(stmt)
            inserted_ids = list(result.scalars().all())
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e

        inserted = len(inserted_ids)
        total = len(values)
        return {"inserted": inserted, "skipped": total - inserted, "total": total}

    async def get_lead(
        self, lead_id: int, organization_id: int
    ) -> Optional[LeadModel]:
        async with self.async_session() as session:
            query = select(LeadModel).where(
                LeadModel.id == lead_id,
                LeadModel.organization_id == organization_id,
            )
            result = await session.execute(query)
            return result.scalar_one_or_none()

    async def get_lead_by_phone(
        self, organization_id: int, phone_number: str
    ) -> Optional[LeadModel]:
        async with self.async_session() as session:
            query = select(LeadModel).where(
                LeadModel.organization_id == organization_id,
                LeadModel.phone_number == phone_number,
            )
            result = await session.execute(query)
            return result.scalar_one_or_none()

    async def list_leads(
        self,
        organization_id: int,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[LeadModel]:
        async with self.async_session() as session:
            query = select(LeadModel).where(
                LeadModel.organization_id == organization_id
            )
            if status:
                query = query.where(LeadModel.status == status)
            if search:
                like = f"%{search}%"
                query = query.where(
                    LeadModel.phone_number.ilike(like)
                    | LeadModel.email.ilike(like)
                    | LeadModel.first_name.ilike(like)
                    | LeadModel.last_name.ilike(like)
                )
            query = (
                query.order_by(LeadModel.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
            result = await session.execute(query)
            return list(result.scalars().all())

    async def count_leads(
        self,
        organization_id: int,
        status: Optional[str] = None,
    ) -> int:
        async with self.async_session() as session:
            query = select(func.count(LeadModel.id)).where(
                LeadModel.organization_id == organization_id
            )
            if status:
                query = query.where(LeadModel.status == status)
            result = await session.execute(query)
            return int(result.scalar() or 0)

    async def update_lead(
        self, lead_id: int, organization_id: int, **fields: Any
    ) -> Optional[LeadModel]:
        """Update mutable fields on an org-scoped lead. Unknown keys are ignored."""
        allowed = {
            "email",
            "first_name",
            "last_name",
            "attributes",
            "status",
            "lead_score",
            "source",
            "external_id",
            "dnc",
            "consent_sms",
            "consent_email",
            "timezone",
            "last_contacted_at",
            "next_action_at",
        }
        async with self.async_session() as session:
            query = select(LeadModel).where(
                LeadModel.id == lead_id,
                LeadModel.organization_id == organization_id,
            )
            result = await session.execute(query)
            lead = result.scalar_one_or_none()
            if not lead:
                return None
            for key, value in fields.items():
                if key in allowed:
                    setattr(lead, key, value)
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            await session.refresh(lead)
            return lead

    async def add_lead_activity(
        self,
        lead_id: int,
        organization_id: int,
        channel: str,
        direction: str,
        activity_type: str,
        workflow_run_id: Optional[int] = None,
        payload: Optional[Dict[str, Any]] = None,
        touch: bool = False,
    ) -> LeadActivityModel:
        """Append a timeline entry for a lead. When ``touch`` is True also bumps
        the lead's ``last_contacted_at`` (used for outbound touches)."""
        async with self.async_session() as session:
            activity = LeadActivityModel(
                lead_id=lead_id,
                organization_id=organization_id,
                channel=channel,
                direction=direction,
                type=activity_type,
                workflow_run_id=workflow_run_id,
                payload=payload or {},
            )
            session.add(activity)
            if touch:
                lead_result = await session.execute(
                    select(LeadModel).where(
                        LeadModel.id == lead_id,
                        LeadModel.organization_id == organization_id,
                    )
                )
                lead = lead_result.scalar_one_or_none()
                if lead:
                    lead.last_contacted_at = datetime.now(UTC)
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            await session.refresh(activity)
            return activity

    async def list_lead_activities(
        self, lead_id: int, organization_id: int
    ) -> List[LeadActivityModel]:
        async with self.async_session() as session:
            query = (
                select(LeadActivityModel)
                .where(
                    LeadActivityModel.lead_id == lead_id,
                    LeadActivityModel.organization_id == organization_id,
                )
                .order_by(LeadActivityModel.created_at.asc())
            )
            result = await session.execute(query)
            return list(result.scalars().all())

    async def status_counts(self, organization_id: int) -> Dict[str, int]:
        """Return a {status: count} breakdown for an organization's leads."""
        async with self.async_session() as session:
            query = (
                select(LeadModel.status, func.count(LeadModel.id))
                .where(LeadModel.organization_id == organization_id)
                .group_by(LeadModel.status)
            )
            result = await session.execute(query)
            return {row[0]: int(row[1]) for row in result.all()}
