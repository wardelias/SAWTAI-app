"""Tests for the persistent lead database: CSV import mapping/dedup/suppression
and DB-level dedup + activity timeline.

Run with:
    source venv/bin/activate && set -a && source api/.env.test && set +a \
        && python -m pytest api/tests/test_lead_import.py
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from api.services.leads import import_service
from api.services.leads.import_service import import_leads_from_csv


# ---------------------------------------------------------------------------
# Unit tests: import parsing / mapping / in-file dedup / invalid / suppression
# (no database — storage fetch and bulk upsert are mocked)
# ---------------------------------------------------------------------------


def _captured_rows(mock_upsert):
    """Return the ``rows`` list that import passed to bulk_upsert_leads."""
    assert mock_upsert.await_count == 1
    args, kwargs = mock_upsert.call_args
    # signature: bulk_upsert_leads(organization_id, rows)
    return args[1] if len(args) > 1 else kwargs["rows"]


@pytest.mark.asyncio
async def test_import_maps_columns_and_attributes():
    csv_rows = [
        ["phone_number", "first_name", "last_name", "email", "last_product"],
        ["+14155550100", "Ada", "Lovelace", "ada@example.com", "Gold Plan"],
    ]
    with (
        patch.object(
            import_service, "_fetch_csv_rows", AsyncMock(return_value=csv_rows)
        ),
        patch.object(
            import_service.db_client,
            "bulk_upsert_leads",
            AsyncMock(return_value={"inserted": 1, "skipped": 0, "total": 1}),
        ) as mock_upsert,
    ):
        result = await import_leads_from_csv(org_id_stub(), "leads.csv")

    rows = _captured_rows(mock_upsert)
    assert len(rows) == 1
    lead = rows[0]
    assert lead["phone_number"] == "+14155550100"
    assert lead["first_name"] == "Ada"
    assert lead["last_name"] == "Lovelace"
    assert lead["email"] == "ada@example.com"
    # Unrecognised column preserved as an attribute (template variable)
    assert lead["attributes"] == {"last_product": "Gold Plan"}
    assert result.imported == 1
    assert result.total_rows == 1


@pytest.mark.asyncio
async def test_import_header_aliases_are_normalised():
    csv_rows = [
        ["Phone", "First Name", "TZ"],
        ["+14155550111", "Grace", "America/New_York"],
    ]
    with (
        patch.object(
            import_service, "_fetch_csv_rows", AsyncMock(return_value=csv_rows)
        ),
        patch.object(
            import_service.db_client,
            "bulk_upsert_leads",
            AsyncMock(return_value={"inserted": 1, "skipped": 0, "total": 1}),
        ) as mock_upsert,
    ):
        await import_leads_from_csv(org_id_stub(), "leads.csv")

    lead = _captured_rows(mock_upsert)[0]
    assert lead["phone_number"] == "+14155550111"
    assert lead["first_name"] == "Grace"
    assert lead["timezone"] == "America/New_York"


@pytest.mark.asyncio
async def test_import_skips_invalid_phone_numbers():
    csv_rows = [
        ["phone_number", "first_name"],
        ["+14155550100", "valid"],
        ["4155550100", "no_plus"],  # invalid: missing +
        ["", "empty"],  # invalid: empty
    ]
    with (
        patch.object(
            import_service, "_fetch_csv_rows", AsyncMock(return_value=csv_rows)
        ),
        patch.object(
            import_service.db_client,
            "bulk_upsert_leads",
            AsyncMock(return_value={"inserted": 1, "skipped": 0, "total": 1}),
        ) as mock_upsert,
    ):
        result = await import_leads_from_csv(org_id_stub(), "leads.csv")

    rows = _captured_rows(mock_upsert)
    assert [r["phone_number"] for r in rows] == ["+14155550100"]
    assert result.invalid == 2
    assert result.total_rows == 3


@pytest.mark.asyncio
async def test_import_dedupes_within_file():
    csv_rows = [
        ["phone_number", "first_name"],
        ["+14155550100", "first"],
        ["+14155550100", "dupe"],  # same phone within file
    ]
    with (
        patch.object(
            import_service, "_fetch_csv_rows", AsyncMock(return_value=csv_rows)
        ),
        patch.object(
            import_service.db_client,
            "bulk_upsert_leads",
            AsyncMock(return_value={"inserted": 1, "skipped": 0, "total": 1}),
        ) as mock_upsert,
    ):
        result = await import_leads_from_csv(org_id_stub(), "leads.csv")

    rows = _captured_rows(mock_upsert)
    assert len(rows) == 1
    assert rows[0]["first_name"] == "first"  # first occurrence wins
    assert result.duplicates_in_file == 1


@pytest.mark.asyncio
async def test_import_dnc_lead_is_suppressed_and_consent_parsed():
    csv_rows = [
        ["phone_number", "dnc", "consent_sms"],
        ["+14155550100", "true", "yes"],
        ["+14155550101", "false", "no"],
    ]
    with (
        patch.object(
            import_service, "_fetch_csv_rows", AsyncMock(return_value=csv_rows)
        ),
        patch.object(
            import_service.db_client,
            "bulk_upsert_leads",
            AsyncMock(return_value={"inserted": 2, "skipped": 0, "total": 2}),
        ) as mock_upsert,
    ):
        await import_leads_from_csv(org_id_stub(), "leads.csv")

    rows = _captured_rows(mock_upsert)
    dnc_lead = next(r for r in rows if r["phone_number"] == "+14155550100")
    ok_lead = next(r for r in rows if r["phone_number"] == "+14155550101")
    assert dnc_lead["dnc"] is True
    assert dnc_lead["consent_sms"] is True
    assert dnc_lead["status"] == "suppressed"  # DNC imported already suppressed
    assert ok_lead["dnc"] is False
    assert ok_lead["consent_sms"] is False
    assert "status" not in ok_lead  # defaults to "new" at the DB layer


@pytest.mark.asyncio
async def test_import_requires_phone_number_column():
    csv_rows = [["name", "email"], ["Ada", "ada@example.com"]]
    with patch.object(
        import_service, "_fetch_csv_rows", AsyncMock(return_value=csv_rows)
    ):
        with pytest.raises(ValueError, match="phone_number"):
            await import_leads_from_csv(org_id_stub(), "leads.csv")


def org_id_stub() -> int:
    # organization_id is only forwarded to the (mocked) bulk upsert in unit tests
    return 1


# ---------------------------------------------------------------------------
# Integration tests: real DB dedup + activity timeline (uses the test database)
# ---------------------------------------------------------------------------


async def _make_org(db_session) -> int:
    user, _ = await db_session.get_or_create_user_by_provider_id(
        f"lead-test-user-{uuid.uuid4()}"
    )
    org, _ = await db_session.get_or_create_organization_by_provider_id(
        f"lead-test-org-{uuid.uuid4()}", user.id
    )
    return org.id


@pytest.mark.asyncio
async def test_bulk_upsert_dedupes_against_db(db_session):
    org_id = await _make_org(db_session)

    first = await db_session.bulk_upsert_leads(
        org_id,
        [
            {"phone_number": "+14155550100", "first_name": "Ada"},
            {"phone_number": "+14155550101", "first_name": "Grace"},
        ],
    )
    assert first == {"inserted": 2, "skipped": 0, "total": 2}

    # Re-importing an overlapping batch inserts only the new number.
    second = await db_session.bulk_upsert_leads(
        org_id,
        [
            {"phone_number": "+14155550100", "first_name": "Ada again"},  # dupe
            {"phone_number": "+14155550102", "first_name": "Alan"},  # new
        ],
    )
    assert second == {"inserted": 1, "skipped": 1, "total": 2}

    assert await db_session.count_leads(org_id) == 3


@pytest.mark.asyncio
async def test_activity_timeline_and_touch(db_session):
    org_id = await _make_org(db_session)
    lead = await db_session.create_lead(
        organization_id=org_id, phone_number="+14155550100", first_name="Ada"
    )
    assert lead.last_contacted_at is None

    await db_session.add_lead_activity(
        lead_id=lead.id,
        organization_id=org_id,
        channel="voice",
        direction="outbound",
        activity_type="call_placed",
        touch=True,
    )
    await db_session.add_lead_activity(
        lead_id=lead.id,
        organization_id=org_id,
        channel="sms",
        direction="inbound",
        activity_type="sms_reply",
        payload={"body": "STOP"},
    )

    activities = await db_session.list_lead_activities(lead.id, org_id)
    assert [a.type for a in activities] == ["call_placed", "sms_reply"]

    refreshed = await db_session.get_lead(lead.id, org_id)
    assert refreshed.last_contacted_at is not None


@pytest.mark.asyncio
async def test_leads_are_org_scoped(db_session):
    org_a = await _make_org(db_session)
    org_b = await _make_org(db_session)

    await db_session.create_lead(
        organization_id=org_a, phone_number="+14155550100"
    )
    # Same number in a different org is allowed (dedup is per-org).
    await db_session.create_lead(
        organization_id=org_b, phone_number="+14155550100"
    )

    assert await db_session.count_leads(org_a) == 1
    assert await db_session.count_leads(org_b) == 1
    # org B cannot see org A's lead by id
    org_a_lead = (await db_session.list_leads(org_a))[0]
    assert await db_session.get_lead(org_a_lead.id, org_b) is None
