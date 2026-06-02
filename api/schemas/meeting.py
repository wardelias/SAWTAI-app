"""Pydantic schemas for calendar meeting endpoints."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class CreateMeetingRequest(BaseModel):
    title: str
    attendee: str
    start_time: datetime
    duration_minutes: int = 30
    phone: Optional[str] = None
    notes: Optional[str] = None
    booked_by: str = "user"
    workflow_run_id: Optional[int] = None


class MeetingResponse(BaseModel):
    id: int
    organization_id: int
    title: str
    attendee: str
    phone: Optional[str]
    notes: Optional[str]
    start_time: datetime
    duration_minutes: int
    booked_by: str
    workflow_run_id: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class MeetingListResponse(BaseModel):
    meetings: List[MeetingResponse]
    total: int
