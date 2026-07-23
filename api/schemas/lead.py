"""Pydantic schemas for the persistent lead database endpoints."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class CreateLeadRequest(BaseModel):
    phone_number: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    attributes: Dict[str, Any] = {}
    source: Optional[str] = None
    external_id: Optional[str] = None
    dnc: bool = False
    consent_sms: bool = False
    consent_email: bool = False
    timezone: Optional[str] = None


class UpdateLeadRequest(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    lead_score: Optional[int] = None
    source: Optional[str] = None
    external_id: Optional[str] = None
    dnc: Optional[bool] = None
    consent_sms: Optional[bool] = None
    consent_email: Optional[bool] = None
    timezone: Optional[str] = None


class ImportLeadsRequest(BaseModel):
    """Import leads from a CSV already uploaded to storage via the presigned-URL
    flow (``POST /api/v1/s3/presigned-upload-url``). ``file_key`` is the returned
    storage key."""

    file_key: str
    source: str = "csv"


class ImportLeadsResponse(BaseModel):
    total_rows: int
    imported: int
    duplicates_in_db: int
    duplicates_in_file: int
    invalid: int
    invalid_rows: List[int] = []


class LeadResponse(BaseModel):
    id: int
    organization_id: int
    phone_number: str
    email: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    attributes: Dict[str, Any]
    status: str
    lead_score: Optional[int]
    source: Optional[str]
    external_id: Optional[str]
    dnc: bool
    consent_sms: bool
    consent_email: bool
    timezone: Optional[str]
    last_contacted_at: Optional[datetime]
    next_action_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class LeadListResponse(BaseModel):
    leads: List[LeadResponse]
    total: int
    status_counts: Dict[str, int] = {}


class LeadActivityResponse(BaseModel):
    id: int
    lead_id: int
    channel: str
    direction: str
    type: str
    workflow_run_id: Optional[int]
    payload: Dict[str, Any]
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class LeadActivityListResponse(BaseModel):
    activities: List[LeadActivityResponse]
    total: int
