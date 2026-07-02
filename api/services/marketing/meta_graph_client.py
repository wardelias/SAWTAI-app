"""Thin async client for the Meta (Facebook) Graph API.

Only the surface needed for Instant Form (Lead Ads) ingestion is implemented:
reading a form's metadata and paging through its leads. Errors returned by the
Graph API are surfaced as ``ValueError`` carrying Meta's own message so callers
(connect flow, poller) can relay a useful reason to the operator.

OAuth is intentionally out of scope for v1 — the caller supplies a long-lived
Page access token that it stored via the credential subsystem.
"""

from typing import AsyncIterator, Dict, List, Optional

import httpx
from loguru import logger

from api.constants import META_GRAPH_API_BASE_URL, META_GRAPH_API_VERSION

# Fields we request for each lead. ``field_data`` holds the answers the user
# submitted; ``created_time`` drives the "call after N minutes" scheduling.
_LEAD_FIELDS = "id,created_time,field_data"
_PAGE_LIMIT = 100
_TIMEOUT = httpx.Timeout(30.0)


class MetaGraphError(ValueError):
    """A Graph API call failed. Message is safe to surface to the operator."""


def _base_url() -> str:
    return f"{META_GRAPH_API_BASE_URL.rstrip('/')}/{META_GRAPH_API_VERSION}"


def _raise_for_graph_error(response: httpx.Response) -> None:
    """Translate a Graph API error body into a MetaGraphError.

    Graph returns 200 for success and a JSON ``{"error": {...}}`` envelope for
    failures (usually with a 4xx status). We prefer the human-readable message.
    """
    if response.is_success:
        return
    message = f"Meta Graph API error (HTTP {response.status_code})"
    try:
        err = response.json().get("error") or {}
        detail = err.get("message")
        if detail:
            message = detail
    except Exception:
        pass
    logger.warning(f"Meta Graph API call failed: {message}")
    raise MetaGraphError(message)


async def get_form(form_id: str, access_token: str) -> Dict:
    """Fetch basic metadata for a lead form. Used to validate a connection.

    Raises MetaGraphError if the token can't read the form.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(
            f"{_base_url()}/{form_id}",
            params={"fields": "id,name,status", "access_token": access_token},
        )
        _raise_for_graph_error(response)
        return response.json()


async def iter_leads(
    form_id: str,
    access_token: str,
    since_epoch: Optional[int] = None,
) -> AsyncIterator[Dict]:
    """Yield leads for a form, newest-page first, following pagination cursors.

    Args:
        form_id: The Meta lead form id.
        access_token: Long-lived Page access token with leads_retrieval.
        since_epoch: When set, only leads created strictly after this Unix
            timestamp are returned (server-side ``filtering``), so repeat polls
            stay cheap. Callers should still dedupe on ``leadgen_id``.
    """
    params: Dict[str, object] = {
        "fields": _LEAD_FIELDS,
        "access_token": access_token,
        "limit": _PAGE_LIMIT,
    }
    if since_epoch is not None:
        # Graph "filtering" expects a JSON-encoded array of predicates.
        import json

        params["filtering"] = json.dumps(
            [
                {
                    "field": "time_created",
                    "operator": "GREATER_THAN",
                    "value": since_epoch,
                }
            ]
        )

    url: Optional[str] = f"{_base_url()}/{form_id}/leads"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        while url:
            response = await client.get(url, params=params)
            _raise_for_graph_error(response)
            payload = response.json()

            data: List[Dict] = payload.get("data", [])
            for lead in data:
                yield lead

            # After the first request, the ``next`` cursor URL already carries
            # all query params, so drop our params to avoid duplicating them.
            url = (payload.get("paging") or {}).get("next")
            params = {}


def flatten_field_data(field_data: List[Dict]) -> Dict[str, str]:
    """Turn Meta's ``[{name, values: [...]}]`` shape into a flat ``{name: value}``.

    Meta lowercases/normalizes field names (e.g. ``full_name``, ``phone_number``,
    ``email``). Multi-value answers are joined with ", ".
    """
    flat: Dict[str, str] = {}
    for field in field_data or []:
        name = (field.get("name") or "").strip()
        if not name:
            continue
        values = field.get("values") or []
        flat[name] = ", ".join(str(v) for v in values)
    return flat
