"""One-click "Connect with Facebook" for the Marketing page.

Flow:

1. ``create_authorize_url`` signs a short-lived ``state`` bound to the caller's
   organization and user, and returns the Facebook Login dialog URL.
2. Facebook redirects the browser back to the UI callback page with ``code`` and
   ``state``; the UI posts both to ``complete_oauth`` while still signed in.
3. ``complete_oauth`` checks that the state belongs to the same org + user
   (CSRF protection), exchanges the code for a long-lived (~60 day) user token,
   and stores it under the org's ``META_ADS_ACCOUNT`` configuration.
4. ``list_pages`` / ``list_forms`` drive the Page -> lead form picker. Page
   access tokens stay server-side; the browser only ever sees ids and names.

Connecting a form copies that Page's token into the form's own credential (see
``meta_connection_service``). Page tokens minted from a long-lived user token
do not expire, so connected forms keep polling even after the user token
lapses or the account is disconnected here.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from loguru import logger

from api.constants import META_APP_SECRET
from api.db import db_client
from api.enums import OrganizationConfigurationKey
from api.services.marketing import meta_graph_client
from api.services.marketing.meta_graph_client import MetaTokenInvalidError

_ACCOUNT_KEY = OrganizationConfigurationKey.META_ADS_ACCOUNT.value
_STATE_PURPOSE = "meta_oauth"
_STATE_TTL = timedelta(minutes=10)
# Page tasks that grant access to lead data.
_LEAD_ACCESS_TASKS = {"ADVERTISE", "MANAGE"}


class MetaOAuthError(ValueError):
    """An OAuth or account operation failed with an operator-safe message."""


class MetaReconnectRequired(MetaOAuthError):
    """The stored Facebook connection is missing, expired, or revoked."""


def _state_key() -> bytes:
    """Derive a dedicated signing key so the app secret isn't reused raw."""
    return hmac.new(
        META_APP_SECRET.encode(), b"sawtai-meta-oauth-state", hashlib.sha256
    ).digest()


def _require_configured() -> None:
    if not meta_graph_client.oauth_configured():
        raise MetaOAuthError(
            "Connect with Facebook isn't set up on this server. "
            "Set META_APP_ID and META_APP_SECRET, or paste a Page access token instead."
        )


def create_state(organization_id: int, user_id: int) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "purpose": _STATE_PURPOSE,
            "org": organization_id,
            "uid": user_id,
            "nonce": secrets.token_urlsafe(16),
            "iat": now,
            "exp": now + _STATE_TTL,
        },
        _state_key(),
        algorithm="HS256",
    )


def verify_state(state: str, organization_id: int, user_id: int) -> None:
    """Reject a state that's forged, expired, or minted for someone else."""
    try:
        claims = jwt.decode(state, _state_key(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise MetaOAuthError("The Facebook sign-in took too long. Please try again.")
    except jwt.PyJWTError:
        raise MetaOAuthError("Invalid Facebook sign-in response. Please try again.")
    if (
        claims.get("purpose") != _STATE_PURPOSE
        or claims.get("org") != organization_id
        or claims.get("uid") != user_id
    ):
        raise MetaOAuthError(
            "This Facebook sign-in was started from a different account or "
            "organization. Please try again."
        )


def create_authorize_url(organization_id: int, user_id: int) -> str:
    _require_configured()
    return meta_graph_client.build_oauth_dialog_url(
        create_state(organization_id, user_id)
    )


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _account_view(value: dict[str, Any] | None) -> dict[str, Any]:
    """Shape the stored account into what the UI needs (never the token)."""
    configured = meta_graph_client.oauth_configured()
    if not value or not value.get("user_access_token"):
        return {"oauth_configured": configured, "connected": False}
    expires_at = _parse_iso(value.get("token_expires_at"))
    expired = bool(expires_at and expires_at <= datetime.now(UTC))
    return {
        "oauth_configured": configured,
        "connected": True,
        "needs_reconnect": expired or bool(value.get("needs_reconnect")),
        "meta_user_id": value.get("meta_user_id"),
        "meta_user_name": value.get("meta_user_name"),
        "connected_at": _parse_iso(value.get("connected_at")),
        "token_expires_at": expires_at,
    }


async def _load_account(organization_id: int) -> dict[str, Any] | None:
    return await db_client.get_configuration_value(organization_id, _ACCOUNT_KEY)


async def get_account(organization_id: int) -> dict[str, Any]:
    return _account_view(await _load_account(organization_id))


async def complete_oauth(
    *, organization_id: int, user_id: int, code: str, state: str
) -> dict[str, Any]:
    """Finish Facebook Login: verify state, swap the code, store the account."""
    _require_configured()
    verify_state(state, organization_id, user_id)

    short_lived = await meta_graph_client.exchange_code_for_user_token(code)
    long_lived = await meta_graph_client.exchange_for_long_lived_user_token(short_lived)
    user_token = long_lived["access_token"]
    me = await meta_graph_client.get_me(user_token)

    now = datetime.now(UTC)
    expires_in = long_lived.get("expires_in")
    value = {
        "user_access_token": user_token,
        "token_expires_at": (
            (now + timedelta(seconds=int(expires_in))).isoformat()
            if expires_in
            else None
        ),
        "meta_user_id": me.get("id"),
        "meta_user_name": me.get("name"),
        "connected_by_user_id": user_id,
        "connected_at": now.isoformat(),
    }
    await db_client.upsert_configuration(
        organization_id, _ACCOUNT_KEY, value, last_validated_at=now
    )
    logger.info(
        f"Org {organization_id} connected Facebook account {me.get('id')} via OAuth"
    )
    return _account_view(value)


async def disconnect_account(organization_id: int) -> bool:
    """Forget the stored Facebook login.

    Already-connected forms keep their own Page tokens and keep calling leads;
    disconnect those individually. We deliberately don't revoke the app's
    permissions on Facebook, since that would also kill those Page tokens.
    """
    return await db_client.delete_configuration(organization_id, _ACCOUNT_KEY)


async def _user_token(organization_id: int) -> str:
    account = await _load_account(organization_id)
    view = _account_view(account)
    if not view["connected"]:
        raise MetaReconnectRequired("Connect your Facebook account first.")
    if view["needs_reconnect"]:
        raise MetaReconnectRequired(
            "Your Facebook connection expired. Click Reconnect to continue."
        )
    assert account is not None  # connected implies a stored account
    return account["user_access_token"]


async def _mark_needs_reconnect(organization_id: int) -> None:
    account = await _load_account(organization_id)
    if account:
        await db_client.upsert_configuration(
            organization_id, _ACCOUNT_KEY, {**account, "needs_reconnect": True}
        )


async def _raw_pages(organization_id: int) -> list[dict[str, Any]]:
    token = await _user_token(organization_id)
    try:
        return await meta_graph_client.list_pages(token)
    except MetaTokenInvalidError:
        await _mark_needs_reconnect(organization_id)
        raise MetaReconnectRequired(
            "Facebook no longer accepts this connection (it was revoked or the "
            "password changed). Click Reconnect to continue."
        )


async def list_pages(organization_id: int) -> list[dict[str, Any]]:
    """Pages the connected person manages, without their access tokens."""
    pages = await _raw_pages(organization_id)
    result = []
    for page in pages:
        tasks = page.get("tasks")
        result.append(
            {
                "id": page["id"],
                "name": page.get("name") or page["id"],
                "picture_url": ((page.get("picture") or {}).get("data") or {}).get(
                    "url"
                ),
                # No tasks list means Graph didn't report roles; assume access.
                "can_read_leads": (
                    True if tasks is None else bool(_LEAD_ACCESS_TASKS & set(tasks))
                ),
            }
        )
    return result


async def get_managed_page(organization_id: int, page_id: str) -> dict[str, Any]:
    """Return one of the connected person's Pages, including its access token.

    Looking it up in ``/me/accounts`` is also the ownership check: a page id
    the person doesn't manage is rejected.
    """
    for page in await _raw_pages(organization_id):
        if page.get("id") == page_id and page.get("access_token"):
            return page
    raise MetaOAuthError(
        "That Facebook Page isn't available to the connected account. "
        "Make sure you granted access to it when connecting."
    )


async def list_forms(organization_id: int, page_id: str) -> list[dict[str, Any]]:
    """Instant Forms on a Page, for the lead form picker."""
    page = await get_managed_page(organization_id, page_id)
    forms = await meta_graph_client.list_lead_forms(page_id, page["access_token"])
    return [
        {
            "id": form["id"],
            "name": form.get("name") or f"Form {form['id']}",
            "status": form.get("status"),
            "leads_count": form.get("leads_count"),
            "created_time": form.get("created_time"),
        }
        for form in forms
    ]
