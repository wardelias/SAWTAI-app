"""Thin async client for the Meta (Facebook) Graph API.

Only the surface needed for Instant Form (Lead Ads) ingestion is implemented:
the Facebook Login code exchange, listing the Pages a person manages and their
lead forms, subscribing a Page to the app's leadgen webhook, reading a form's
metadata and paging through its leads. Errors returned by the Graph API are
surfaced as ``ValueError`` carrying Meta's own message so callers (connect
flow, poller) can relay a useful reason to the operator.
"""

from typing import Any, AsyncIterator, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from loguru import logger

from api.constants import (
    META_APP_ID,
    META_APP_SECRET,
    META_GRAPH_API_BASE_URL,
    META_GRAPH_API_VERSION,
    META_LOGIN_CONFIG_ID,
    META_OAUTH_DIALOG_BASE_URL,
    META_OAUTH_REDIRECT_URI,
    META_OAUTH_SCOPES,
)

# Fields we request for each lead. ``field_data`` holds the answers the user
# submitted; ``created_time`` drives the "call after N minutes" scheduling.
_LEAD_FIELDS = "id,created_time,field_data"
_PAGE_FIELDS = "id,name,access_token,tasks,picture{url}"
_FORM_FIELDS = "id,name,status,leads_count,created_time"
_PAGE_LIMIT = 100
_TIMEOUT = httpx.Timeout(30.0)

# Graph error code for an invalid, expired, or revoked access token.
_INVALID_TOKEN_CODE = 190


class MetaGraphError(ValueError):
    """A Graph API call failed. Message is safe to surface to the operator."""


class MetaTokenInvalidError(MetaGraphError):
    """The access token is expired or revoked; the person must reconnect."""


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
    code = None
    try:
        err = response.json().get("error") or {}
        code = err.get("code")
        detail = err.get("message")
        if detail:
            message = detail
    except Exception:
        pass
    logger.warning(f"Meta Graph API call failed: {message}")
    if code == _INVALID_TOKEN_CODE:
        raise MetaTokenInvalidError(message)
    raise MetaGraphError(message)


async def _collect_paginated(url: str, params: Dict[str, Any]) -> List[Dict]:
    """GET a Graph edge and follow ``paging.next`` until exhausted."""
    items: List[Dict] = []
    next_url: Optional[str] = url
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        while next_url:
            response = await client.get(next_url, params=params)
            _raise_for_graph_error(response)
            payload = response.json()
            items.extend(payload.get("data", []))
            # The ``next`` cursor URL already carries every query param.
            next_url = (payload.get("paging") or {}).get("next")
            params = {}
    return items


# ---------------------------------------------------------------------------
# Facebook Login (OAuth)
# ---------------------------------------------------------------------------


def oauth_configured() -> bool:
    """True when a Meta app is configured for one-click "Connect with Facebook"."""
    return bool(META_APP_ID and META_APP_SECRET)


def build_oauth_dialog_url(state: str) -> str:
    """Build the Facebook Login dialog URL the browser is sent to.

    Uses a Facebook Login for Business ``config_id`` when one is configured,
    otherwise requests ``META_OAUTH_SCOPES`` directly.
    """
    params: Dict[str, str] = {
        "client_id": META_APP_ID,
        "redirect_uri": META_OAUTH_REDIRECT_URI,
        "state": state,
        "response_type": "code",
    }
    if META_LOGIN_CONFIG_ID:
        params["config_id"] = META_LOGIN_CONFIG_ID
    else:
        params["scope"] = META_OAUTH_SCOPES
    base = META_OAUTH_DIALOG_BASE_URL.rstrip("/")
    return f"{base}/{META_GRAPH_API_VERSION}/dialog/oauth?{urlencode(params)}"


async def exchange_code_for_user_token(code: str) -> str:
    """Swap the OAuth ``code`` for a short-lived user access token."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(
            f"{_base_url()}/oauth/access_token",
            params={
                "client_id": META_APP_ID,
                "client_secret": META_APP_SECRET,
                "redirect_uri": META_OAUTH_REDIRECT_URI,
                "code": code,
            },
        )
        _raise_for_graph_error(response)
        return response.json()["access_token"]


async def exchange_for_long_lived_user_token(short_lived_token: str) -> Dict:
    """Upgrade a short-lived user token to a ~60-day one.

    Returns ``{"access_token": ..., "expires_in": seconds | None}``. Page tokens
    fetched with a long-lived user token do not expire, which is what keeps
    connected forms polling after the user token lapses.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(
            f"{_base_url()}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": META_APP_ID,
                "client_secret": META_APP_SECRET,
                "fb_exchange_token": short_lived_token,
            },
        )
        _raise_for_graph_error(response)
        payload = response.json()
        return {
            "access_token": payload["access_token"],
            "expires_in": payload.get("expires_in"),
        }


async def get_me(user_token: str) -> Dict:
    """Return the Facebook profile (``id``, ``name``) behind a user token."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(
            f"{_base_url()}/me",
            params={"fields": "id,name", "access_token": user_token},
        )
        _raise_for_graph_error(response)
        return response.json()


# ---------------------------------------------------------------------------
# Pages and lead forms
# ---------------------------------------------------------------------------


async def list_pages(user_token: str) -> List[Dict]:
    """List the Pages the person manages, each with its own Page access token."""
    return await _collect_paginated(
        f"{_base_url()}/me/accounts",
        {"fields": _PAGE_FIELDS, "access_token": user_token, "limit": _PAGE_LIMIT},
    )


async def list_lead_forms(page_id: str, page_token: str) -> List[Dict]:
    """List a Page's Instant Forms (any status), newest first as Graph returns them."""
    return await _collect_paginated(
        f"{_base_url()}/{page_id}/leadgen_forms",
        {"fields": _FORM_FIELDS, "access_token": page_token, "limit": _PAGE_LIMIT},
    )


async def subscribe_page_to_leadgen(page_id: str, page_token: str) -> None:
    """Subscribe the app to a Page's ``leadgen`` webhook so new leads push in."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(
            f"{_base_url()}/{page_id}/subscribed_apps",
            params={"subscribed_fields": "leadgen", "access_token": page_token},
        )
        _raise_for_graph_error(response)


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
