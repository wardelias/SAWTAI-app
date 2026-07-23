"""Import leads from an uploaded CSV into the persistent ``leads`` table.

Reuses the same presigned-upload → storage flow as campaigns: the browser
uploads the CSV straight to S3/MinIO and hands back a ``file_key``; this service
downloads it, parses it, maps columns onto lead fields (everything unrecognised
becomes a template-friendly ``attribute``), and bulk-upserts with dedup on
``(organization_id, phone_number)``.
"""

import csv
from dataclasses import dataclass, field
from io import StringIO
from typing import Any, Dict, List

import httpx
from loguru import logger

from api.db import db_client
from api.services.campaign.source_sync import CampaignSourceSyncService
from api.services.storage import storage_fs

# Recognised column aliases (matched against normalized, lowercased headers).
# Any column not listed here is preserved verbatim in the lead's ``attributes``
# and is therefore available to the AI agent as a call template variable.
_FIELD_ALIASES: Dict[str, set] = {
    "phone_number": {"phone_number", "phone", "mobile", "phone number", "msisdn"},
    "email": {"email", "email_address", "e-mail"},
    "first_name": {"first_name", "firstname", "first name", "fname"},
    "last_name": {"last_name", "lastname", "last name", "lname"},
    "timezone": {"timezone", "tz", "time_zone"},
    "dnc": {"dnc", "do_not_call", "do not call"},
    "consent_sms": {"consent_sms", "sms_consent", "sms_opt_in"},
    "consent_email": {"consent_email", "email_consent", "email_opt_in"},
    "source": {"source", "lead_source"},
    "external_id": {"external_id", "crm_id"},
    "lead_score": {"lead_score", "score"},
}

_BOOLEAN_FIELDS = {"dnc", "consent_sms", "consent_email"}
_TRUTHY = {"true", "1", "yes", "y", "t"}

# Reverse lookup: normalized header -> canonical field name
_HEADER_TO_FIELD: Dict[str, str] = {
    alias: field_name
    for field_name, aliases in _FIELD_ALIASES.items()
    for alias in aliases
}


@dataclass
class LeadImportResult:
    total_rows: int = 0
    imported: int = 0
    duplicates_in_db: int = 0
    duplicates_in_file: int = 0
    invalid: int = 0
    invalid_rows: List[int] = field(default_factory=list)


def _to_bool(value: str) -> bool:
    return value.strip().lower() in _TRUTHY


async def _fetch_csv_rows(file_key: str) -> List[List[str]]:
    """Download and parse a CSV from storage into a list of rows (incl header)."""
    signed_url = await storage_fs.aget_signed_url(
        file_key, expiration=3600, use_internal_endpoint=True
    )
    if not signed_url:
        raise ValueError(f"Failed to access CSV file: {file_key}")

    async with httpx.AsyncClient() as client:
        response = await client.get(signed_url)
        response.raise_for_status()
        content = response.text

    try:
        return list(csv.reader(StringIO(content)))
    except Exception as e:
        logger.error(f"Failed to parse lead CSV {file_key}: {e}")
        raise ValueError(f"Invalid CSV format: {e}")


async def import_leads_from_csv(
    organization_id: int, file_key: str, source: str = "csv"
) -> LeadImportResult:
    """Parse an uploaded CSV and upsert its rows into ``leads``.

    Rows with a missing/invalid phone number (must be E.164, i.e. start with
    '+') are skipped and reported rather than failing the whole import, since
    recycled-lead lists are frequently messy.
    """
    rows = await _fetch_csv_rows(file_key)
    if not rows or len(rows) < 2:
        raise ValueError("CSV must have a header row and at least one data row")

    headers = CampaignSourceSyncService.normalize_headers(rows[0])
    if "phone_number" not in {_HEADER_TO_FIELD.get(h, h) for h in headers}:
        raise ValueError("CSV must contain a 'phone_number' column")

    result = LeadImportResult()
    seen_phones: set = set()
    to_upsert: List[Dict[str, Any]] = []

    for idx, raw_row in enumerate(rows[1:], start=2):  # 1-indexed, skip header
        result.total_rows += 1
        # Pad short rows so zip below is stable
        row = raw_row + [""] * (len(headers) - len(raw_row))

        lead: Dict[str, Any] = {"attributes": {}, "source": source}
        for header, value in zip(headers, row):
            field_name = _HEADER_TO_FIELD.get(header)
            cell = value.strip()
            if field_name is None:
                if cell:
                    lead["attributes"][header] = cell
                continue
            if not cell:
                continue
            if field_name in _BOOLEAN_FIELDS:
                lead[field_name] = _to_bool(cell)
            elif field_name == "lead_score":
                try:
                    lead[field_name] = int(cell)
                except ValueError:
                    pass
            else:
                lead[field_name] = cell

        phone = lead.get("phone_number", "").strip()
        if not phone or not phone.startswith("+"):
            result.invalid += 1
            if len(result.invalid_rows) < 50:
                result.invalid_rows.append(idx)
            continue

        if phone in seen_phones:
            result.duplicates_in_file += 1
            continue
        seen_phones.add(phone)

        # A DNC lead is imported already suppressed so it is never dialed.
        if lead.get("dnc"):
            lead["status"] = "suppressed"

        to_upsert.append(lead)

    upsert_counts = await db_client.bulk_upsert_leads(organization_id, to_upsert)
    result.imported = upsert_counts["inserted"]
    result.duplicates_in_db = upsert_counts["skipped"]

    logger.info(
        f"Lead import for org {organization_id} from {file_key}: "
        f"{result.imported} imported, {result.duplicates_in_db} db-dupes, "
        f"{result.duplicates_in_file} file-dupes, {result.invalid} invalid"
    )
    return result
