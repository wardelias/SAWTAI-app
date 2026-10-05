"""Pydantic schemas for reactivation sequence endpoints."""

from datetime import datetime
from typing import Dict, List, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

SequenceStatus = Literal["draft", "active", "paused", "archived"]


def _validate_timezone(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"Unknown timezone: {value}")
    return value


class SequenceStepInput(BaseModel):
    channel: Literal["voice", "sms", "email"] = Field(
        ..., description="voice | sms (email is not available yet)"
    )
    delay_seconds: int = Field(
        0,
        ge=0,
        le=365 * 24 * 3600,
        description="Delay from the previous step (or enrollment for step 1)",
    )
    workflow_id: Optional[int] = None  # required for voice steps
    message_template_id: Optional[int] = None
    message_text: Optional[str] = Field(None, max_length=1600)  # sms steps
    stop_on_response: bool = True

    @model_validator(mode="after")
    def validate_channel_fields(self):
        if self.channel == "voice" and not self.workflow_id:
            raise ValueError("voice steps need a voice agent (workflow_id)")
        if self.channel == "sms" and not (self.message_text or "").strip():
            raise ValueError("SMS steps need message text")
        if self.channel == "email":
            raise ValueError("email steps are not available yet")
        return self


class _QuietHoursMixin(BaseModel):
    quiet_hours_start: Optional[int] = Field(None, ge=0, le=23)
    quiet_hours_end: Optional[int] = Field(None, ge=0, le=23)
    default_timezone: Optional[str] = None

    @field_validator("default_timezone")
    @classmethod
    def validate_timezone(cls, v: Optional[str]) -> Optional[str]:
        return _validate_timezone(v)

    @model_validator(mode="after")
    def validate_quiet_hours(self):
        start, end = self.quiet_hours_start, self.quiet_hours_end
        if (start is None) != (end is None):
            raise ValueError("set both quiet-hours start and end, or neither")
        return self


class CreateSequenceRequest(_QuietHoursMixin):
    name: str = Field(..., min_length=1, max_length=255)
    steps: List[SequenceStepInput] = Field(..., min_length=1, max_length=50)
    status: SequenceStatus = "draft"


class UpdateSequenceRequest(_QuietHoursMixin):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    status: Optional[SequenceStatus] = None
    # When given, replaces the step list. Leads already in the sequence keep
    # their position (step number).
    steps: Optional[List[SequenceStepInput]] = Field(None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_quiet_hours(self):
        # Partial updates may set just one bound only if the other is already
        # set; the route re-validates against the stored sequence.
        return self


class EnrollLeadsRequest(BaseModel):
    lead_ids: Optional[List[int]] = Field(None, max_length=10000)
    # Alternative to lead_ids: enroll every callable lead with this status
    # ("all" for every callable lead).
    lead_status: Optional[str] = None
    start_at: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_target(self):
        if not self.lead_ids and not self.lead_status:
            raise ValueError("pick leads (lead_ids) or a lead status (lead_status)")
        return self


class EnrollLeadsResponse(BaseModel):
    enrolled: int
    skipped: int


class StopEnrollmentsRequest(BaseModel):
    # Omit to stop every lead that is still in progress.
    enrollment_ids: Optional[List[int]] = None


class StopEnrollmentsResponse(BaseModel):
    stopped: int


class SequenceStepResponse(BaseModel):
    id: int
    step_order: int
    channel: str
    delay_seconds: int
    workflow_id: Optional[int]
    workflow_name: Optional[str] = None
    message_template_id: Optional[int]
    message_text: Optional[str] = None
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
    enrollment_counts: Dict[str, int] = Field(default_factory=dict)
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
    lead_name: Optional[str] = None
    lead_phone: Optional[str] = None
    lead_status: Optional[str] = None
    current_step: int
    state: str
    next_step_at: Optional[datetime]
    stop_reason: Optional[str]
    waiting_on_call: bool = False
    last_workflow_run_id: Optional[int] = None
    last_error: Optional[str] = None
    last_step_at: Optional[datetime] = None
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class EnrollmentListResponse(BaseModel):
    enrollments: List[EnrollmentResponse]
    total: int
