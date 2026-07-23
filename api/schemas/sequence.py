"""Pydantic schemas for reactivation sequence endpoints."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SequenceStepInput(BaseModel):
    channel: str = Field(..., description="voice | sms | email")
    delay_seconds: int = Field(
        0, ge=0, description="Delay from the previous step (or enrollment for step 0)"
    )
    workflow_id: Optional[int] = None  # required for voice steps
    message_template_id: Optional[int] = None  # sms/email (later phases)
    stop_on_response: bool = True


class CreateSequenceRequest(BaseModel):
    name: str
    steps: List[SequenceStepInput]
    quiet_hours_start: Optional[int] = Field(None, ge=0, le=23)
    quiet_hours_end: Optional[int] = Field(None, ge=0, le=23)
    default_timezone: Optional[str] = None
    status: str = "draft"


class UpdateSequenceRequest(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    quiet_hours_start: Optional[int] = Field(None, ge=0, le=23)
    quiet_hours_end: Optional[int] = Field(None, ge=0, le=23)
    default_timezone: Optional[str] = None


class EnrollLeadsRequest(BaseModel):
    lead_ids: List[int]
    start_at: Optional[datetime] = None


class EnrollLeadsResponse(BaseModel):
    enrolled: int
    skipped: int


class SequenceStepResponse(BaseModel):
    id: int
    step_order: int
    channel: str
    delay_seconds: int
    workflow_id: Optional[int]
    message_template_id: Optional[int]
    stop_on_response: bool

    model_config = {"from_attributes": True}


class SequenceResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    status: str
    quiet_hours_start: Optional[int]
    quiet_hours_end: Optional[int]
    default_timezone: Optional[str]
    steps: List[SequenceStepResponse]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SequenceListResponse(BaseModel):
    sequences: List[SequenceResponse]
    total: int


class EnrollmentResponse(BaseModel):
    id: int
    sequence_id: int
    lead_id: int
    current_step: int
    state: str
    next_step_at: Optional[datetime]
    stop_reason: Optional[str]
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class EnrollmentListResponse(BaseModel):
    enrollments: List[EnrollmentResponse]
    total: int
