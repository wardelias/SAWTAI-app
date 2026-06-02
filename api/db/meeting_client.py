"""Database client for managing calendar meetings."""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import select

from api.db.base_client import BaseDBClient
from api.db.models import MeetingModel


class MeetingClient(BaseDBClient):
    """Client for managing calendar meetings (organization-scoped)."""

    async def create_meeting(
        self,
        organization_id: int,
        title: str,
        attendee: str,
        start_time: datetime,
        duration_minutes: int = 30,
        phone: Optional[str] = None,
        notes: Optional[str] = None,
        booked_by: str = "user",
        workflow_run_id: Optional[int] = None,
    ) -> MeetingModel:
        async with self.async_session() as session:
            meeting = MeetingModel(
                organization_id=organization_id,
                title=title,
                attendee=attendee,
                phone=phone,
                notes=notes,
                start_time=start_time,
                duration_minutes=duration_minutes,
                booked_by=booked_by,
                workflow_run_id=workflow_run_id,
            )
            session.add(meeting)
            await session.commit()
            await session.refresh(meeting)
            return meeting

    async def list_meetings(
        self,
        organization_id: int,
        from_time: Optional[datetime] = None,
        to_time: Optional[datetime] = None,
    ) -> List[MeetingModel]:
        async with self.async_session() as session:
            stmt = select(MeetingModel).where(
                MeetingModel.organization_id == organization_id
            )
            if from_time:
                stmt = stmt.where(MeetingModel.start_time >= from_time)
            if to_time:
                stmt = stmt.where(MeetingModel.start_time <= to_time)
            stmt = stmt.order_by(MeetingModel.start_time.asc())
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def get_meeting(
        self, meeting_id: int, organization_id: int
    ) -> Optional[MeetingModel]:
        async with self.async_session() as session:
            stmt = select(MeetingModel).where(
                MeetingModel.id == meeting_id,
                MeetingModel.organization_id == organization_id,
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def delete_meeting(self, meeting_id: int, organization_id: int) -> bool:
        async with self.async_session() as session:
            stmt = select(MeetingModel).where(
                MeetingModel.id == meeting_id,
                MeetingModel.organization_id == organization_id,
            )
            result = await session.execute(stmt)
            meeting = result.scalar_one_or_none()
            if not meeting:
                return False
            await session.delete(meeting)
            await session.commit()
            return True
