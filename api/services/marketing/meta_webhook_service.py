"""Meta ``leadgen`` webhook: turn pushed lead notifications into instant polls.

Meta only sends ids in a leadgen event (``page_id``, ``form_id``,
``leadgen_id``), never the answers. Rather than fetching each lead here, the
webhook nudges an immediate poll of every matching connection. The poller
already handles phone normalization, scheduling, the high-watermark, and dedupe,
so a webhook (or a duplicate delivery) can never queue a lead twice. The cron
poller stays as the safety net if a webhook is missed.

Signature: Meta signs the raw request body with the app secret
(``X-Hub-Signature-256: sha256=<hex>``); unsigned or mis-signed requests are
rejected before parsing.
"""

import hashlib
import hmac
from typing import Any

from loguru import logger

from api.constants import META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN
from api.db import db_client
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames

SOURCE_TYPE = "meta_instant_form"


def webhook_enabled() -> bool:
    return bool(META_WEBHOOK_VERIFY_TOKEN and META_APP_SECRET)


def verify_subscription(
    mode: str | None, verify_token: str | None, challenge: str | None
) -> str | None:
    """Meta's subscription handshake. Returns the challenge to echo, or None."""
    if not webhook_enabled() or mode != "subscribe" or challenge is None:
        return None
    if not hmac.compare_digest(verify_token or "", META_WEBHOOK_VERIFY_TOKEN):
        return None
    return challenge


def verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
    if not META_APP_SECRET or not signature_header:
        return False
    prefix = "sha256="
    if not signature_header.startswith(prefix):
        return False
    expected = hmac.new(META_APP_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header[len(prefix) :])


def extract_leadgen_events(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Pull ``{form_id, page_id}`` pairs out of a Page webhook payload."""
    if payload.get("object") != "page":
        return []
    events = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "leadgen":
                continue
            value = change.get("value") or {}
            form_id = value.get("form_id")
            if not form_id:
                continue
            events.append(
                {
                    "form_id": str(form_id),
                    "page_id": str(value.get("page_id") or entry.get("id") or ""),
                }
            )
    return events


async def handle_leadgen_payload(payload: dict[str, Any]) -> int:
    """Enqueue an immediate poll for each connection a leadgen event targets.

    Returns how many polls were enqueued.
    """
    events = extract_leadgen_events(payload)
    if not events:
        return 0

    pages_by_form: dict[str, set[str]] = {}
    for event in events:
        pages = pages_by_form.setdefault(event["form_id"], set())
        if event["page_id"]:
            pages.add(event["page_id"])

    campaigns = await db_client.get_active_campaigns_by_source_ids(
        SOURCE_TYPE, list(pages_by_form)
    )
    enqueued = 0
    for campaign in campaigns:
        meta = (campaign.orchestrator_metadata or {}).get("meta") or {}
        if meta.get("disconnected"):
            continue
        # When the connection knows its Page, the event's Page must match.
        stored_page = meta.get("page_id")
        event_pages = pages_by_form.get(campaign.source_id, set())
        if stored_page and event_pages and stored_page not in event_pages:
            continue
        await enqueue_job(FunctionNames.POLL_META_LEADS, campaign.id)
        enqueued += 1

    if enqueued:
        logger.info(f"Meta leadgen webhook: enqueued {enqueued} instant poll(s)")
    return enqueued
