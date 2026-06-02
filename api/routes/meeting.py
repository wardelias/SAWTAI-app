"""API routes for calendar meetings."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.db import db_client
from api.db.models import UserModel
from api.schemas.meeting import CreateMeetingRequest, MeetingListResponse, MeetingResponse
from api.services.auth.depends import get_user

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("", response_model=MeetingListResponse)
async def list_meetings(
    from_time: Optional[datetime] = Query(None),
    to_time: Optional[datetime] = Query(None),
    user: UserModel = Depends(get_user),
):
    """List all meetings for the current organization, optionally filtered by date range."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    meetings = await db_client.list_meetings(
        organization_id=user.selected_organization_id,
        from_time=from_time,
        to_time=to_time,
    )
    return MeetingListResponse(meetings=meetings, total=len(meetings))


@router.post("", response_model=MeetingResponse, status_code=201)
async def create_meeting(
    body: CreateMeetingRequest,
    user: UserModel = Depends(get_user),
):
    """Create a new calendar meeting."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    meeting = await db_client.create_meeting(
        organization_id=user.selected_organization_id,
        title=body.title,
        attendee=body.attendee,
        start_time=body.start_time,
        duration_minutes=body.duration_minutes,
        phone=body.phone,
        notes=body.notes,
        booked_by=body.booked_by,
        workflow_run_id=body.workflow_run_id,
    )
    return meeting


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(
    meeting_id: int,
    user: UserModel = Depends(get_user),
):
    """Delete a meeting by ID (org-scoped)."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    deleted = await db_client.delete_meeting(
        meeting_id=meeting_id,
        organization_id=user.selected_organization_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Meeting not found")
