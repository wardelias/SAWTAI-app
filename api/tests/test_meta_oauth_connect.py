"""Tests for one-click Meta connect: OAuth state, account + Page/form picker,
connecting a picked form, the leadgen webhook, and the poll lock that keeps
webhook bursts from calling a lead twice.
"""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.marketing import (
    meta_connection_service,
    meta_graph_client,
    meta_oauth_service,
    meta_webhook_service,
)
from api.services.marketing.meta_graph_client import MetaTokenInvalidError
from api.services.marketing.meta_oauth_service import (
    MetaOAuthError,
    MetaReconnectRequired,
)

OAUTH = "api.services.marketing.meta_oauth_service"
GRAPH = "api.services.marketing.meta_graph_client"
CONNECT = "api.services.marketing.meta_connection_service"
WEBHOOK = "api.services.marketing.meta_webhook_service"
APP_SECRET = "test-app-secret"


@pytest.fixture(autouse=True)
def meta_app():
    """Configure a Meta app for every test in this module."""
    with (
        patch(f"{GRAPH}.META_APP_ID", "123"),
        patch(f"{GRAPH}.META_APP_SECRET", APP_SECRET),
        patch(f"{OAUTH}.META_APP_SECRET", APP_SECRET),
        patch(f"{WEBHOOK}.META_APP_SECRET", APP_SECRET),
        patch(f"{WEBHOOK}.META_WEBHOOK_VERIFY_TOKEN", "verify-me"),
    ):
        yield


def _account(**overrides):
    return {
        "user_access_token": "USER_TOKEN",
        "token_expires_at": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
        "meta_user_id": "fb-1",
        "meta_user_name": "Jane Marketer",
        "connected_by_user_id": 9,
        "connected_at": datetime.now(UTC).isoformat(),
        **overrides,
    }


_PAGES = [
    {
        "id": "P1",
        "name": "Acme Dental",
        "access_token": "PAGE_TOKEN_1",
        "tasks": ["ADVERTISE", "ANALYZE"],
        "picture": {"data": {"url": "https://img/p1.png"}},
    },
    {
        "id": "P2",
        "name": "Acme Fan Page",
        "access_token": "PAGE_TOKEN_2",
        "tasks": ["MODERATE"],
    },
]


class TestOAuthState:
    def test_round_trip(self):
        state = meta_oauth_service.create_state(7, 9)
        meta_oauth_service.verify_state(state, 7, 9)

    @pytest.mark.parametrize("org,uid", [(8, 9), (7, 10)])
    def test_rejects_other_org_or_user(self, org, uid):
        state = meta_oauth_service.create_state(7, 9)
        with pytest.raises(MetaOAuthError, match="different account"):
            meta_oauth_service.verify_state(state, org, uid)

    def test_rejects_expired(self):
        key = meta_oauth_service._state_key()
        past = datetime.now(UTC) - timedelta(minutes=1)
        state = jwt.encode(
            {"purpose": "meta_oauth", "org": 7, "uid": 9, "exp": past}, key, "HS256"
        )
        with pytest.raises(MetaOAuthError, match="too long"):
            meta_oauth_service.verify_state(state, 7, 9)

    def test_rejects_forged(self):
        state = jwt.encode(
            {"purpose": "meta_oauth", "org": 7, "uid": 9}, "attacker-key", "HS256"
        )
        with pytest.raises(MetaOAuthError, match="Invalid"):
            meta_oauth_service.verify_state(state, 7, 9)

    def test_authorize_url_requests_lead_scopes(self):
        url = meta_oauth_service.create_authorize_url(7, 9)
        query = parse_qs(urlparse(url).query)
        assert query["client_id"] == ["123"]
        assert "leads_retrieval" in query["scope"][0]
        assert query["response_type"] == ["code"]
        meta_oauth_service.verify_state(query["state"][0], 7, 9)

    def test_authorize_url_uses_login_config_when_set(self):
        with patch(f"{GRAPH}.META_LOGIN_CONFIG_ID", "cfg-1"):
            url = meta_oauth_service.create_authorize_url(7, 9)
        query = parse_qs(urlparse(url).query)
        assert query["config_id"] == ["cfg-1"]
        assert "scope" not in query

    def test_not_configured(self):
        with (
            patch(f"{GRAPH}.META_APP_ID", ""),
            pytest.raises(MetaOAuthError, match="isn't set up"),
        ):
            meta_oauth_service.create_authorize_url(7, 9)


class TestAccount:
    @pytest.mark.asyncio
    async def test_complete_oauth_stores_long_lived_token(self):
        db = MagicMock()
        db.upsert_configuration = AsyncMock()
        state = meta_oauth_service.create_state(7, 9)
        with (
            patch(f"{OAUTH}.db_client", db),
            patch(
                f"{GRAPH}.exchange_code_for_user_token", AsyncMock(return_value="SHORT")
            ),
            patch(
                f"{GRAPH}.exchange_for_long_lived_user_token",
                AsyncMock(return_value={"access_token": "LONG", "expires_in": 5184000}),
            ) as exchange,
            patch(
                f"{GRAPH}.get_me",
                AsyncMock(return_value={"id": "fb-1", "name": "Jane"}),
            ),
        ):
            view = await meta_oauth_service.complete_oauth(
                organization_id=7, user_id=9, code="CODE", state=state
            )

        exchange.assert_awaited_once_with("SHORT")
        org_id, key, value = db.upsert_configuration.call_args.args
        assert (org_id, key) == (7, "META_ADS_ACCOUNT")
        assert value["user_access_token"] == "LONG"
        assert value["meta_user_name"] == "Jane"
        assert view["connected"] is True and view["needs_reconnect"] is False
        assert "user_access_token" not in view

    @pytest.mark.asyncio
    async def test_complete_oauth_rejects_bad_state_before_exchanging(self):
        exchange = AsyncMock()
        with (
            patch(f"{GRAPH}.exchange_code_for_user_token", exchange),
            pytest.raises(MetaOAuthError),
        ):
            await meta_oauth_service.complete_oauth(
                organization_id=7, user_id=9, code="CODE", state="garbage"
            )
        exchange.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_expired_account_needs_reconnect(self):
        expired = _account(
            token_expires_at=(datetime.now(UTC) - timedelta(days=1)).isoformat()
        )
        db = MagicMock()
        db.get_configuration_value = AsyncMock(return_value=expired)
        with patch(f"{OAUTH}.db_client", db):
            view = await meta_oauth_service.get_account(7)
            assert view["needs_reconnect"] is True
            with pytest.raises(MetaReconnectRequired):
                await meta_oauth_service.list_pages(7)

    @pytest.mark.asyncio
    async def test_list_pages_hides_tokens_and_flags_lead_access(self):
        db = MagicMock()
        db.get_configuration_value = AsyncMock(return_value=_account())
        with (
            patch(f"{OAUTH}.db_client", db),
            patch(f"{GRAPH}.list_pages", AsyncMock(return_value=_PAGES)),
        ):
            pages = await meta_oauth_service.list_pages(7)

        assert pages == [
            {
                "id": "P1",
                "name": "Acme Dental",
                "picture_url": "https://img/p1.png",
                "can_read_leads": True,
            },
            {
                "id": "P2",
                "name": "Acme Fan Page",
                "picture_url": None,
                "can_read_leads": False,
            },
        ]

    @pytest.mark.asyncio
    async def test_revoked_token_marks_account_for_reconnect(self):
        db = MagicMock()
        db.get_configuration_value = AsyncMock(return_value=_account())
        db.upsert_configuration = AsyncMock()
        with (
            patch(f"{OAUTH}.db_client", db),
            patch(
                f"{GRAPH}.list_pages",
                AsyncMock(side_effect=MetaTokenInvalidError("revoked")),
            ),
            pytest.raises(MetaReconnectRequired),
        ):
            await meta_oauth_service.list_pages(7)
        assert db.upsert_configuration.call_args.args[2]["needs_reconnect"] is True

    @pytest.mark.asyncio
    async def test_unmanaged_page_is_rejected(self):
        db = MagicMock()
        db.get_configuration_value = AsyncMock(return_value=_account())
        with (
            patch(f"{OAUTH}.db_client", db),
            patch(f"{GRAPH}.list_pages", AsyncMock(return_value=_PAGES)),
            pytest.raises(MetaOAuthError, match="isn't available"),
        ):
            await meta_oauth_service.list_forms(7, "SOMEONE_ELSES_PAGE")


def _connect_db(existing_campaigns=()):
    db = MagicMock()
    db.get_workflow_name = AsyncMock(return_value="Dental Agent")
    db.get_campaigns_by_source_type = AsyncMock(return_value=list(existing_campaigns))
    db.create_credential = AsyncMock(
        return_value=SimpleNamespace(credential_uuid="cred-1")
    )
    db.get_default_telephony_configuration = AsyncMock(
        return_value=SimpleNamespace(id=3)
    )
    db.create_campaign = AsyncMock(
        return_value=SimpleNamespace(id=55, orchestrator_metadata={})
    )

    async def _update_campaign(campaign_id, **kwargs):
        return SimpleNamespace(
            id=campaign_id,
            source_type="meta_instant_form",
            workflow_id=1,
            state=kwargs.get("state", "running"),
            orchestrator_metadata=kwargs.get("orchestrator_metadata", {}),
            retry_config={"max_retries": 2},
            total_rows=0,
            created_at=datetime.now(UTC),
        )

    db.update_campaign = AsyncMock(side_effect=_update_campaign)
    return db


_CONNECT_ARGS = {
    "organization_id": 7,
    "user_id": 9,
    "form_id": "F1",
    "workflow_id": 1,
    "call_after_seconds": 0,
    "max_retries": 2,
}


class TestConnectPickedForm:
    @pytest.mark.asyncio
    async def test_connects_with_page_token_from_account(self):
        db = _connect_db()
        subscribe = AsyncMock()
        with (
            patch(f"{CONNECT}.db_client", db),
            patch(f"{CONNECT}.enqueue_job", AsyncMock()) as enqueue,
            patch(
                f"{OAUTH}.db_client",
                MagicMock(get_configuration_value=AsyncMock(return_value=_account())),
            ),
            patch(f"{GRAPH}.list_pages", AsyncMock(return_value=_PAGES)),
            patch(
                f"{GRAPH}.list_lead_forms",
                AsyncMock(return_value=[{"id": "F1", "name": "Free Checkup"}]),
            ),
            patch(f"{GRAPH}.subscribe_page_to_leadgen", subscribe),
        ):
            view = await meta_connection_service.connect_meta(
                page_id="P1", **_CONNECT_ARGS
            )

        # The Page token (never sent by the browser) is stored on the credential.
        assert db.create_credential.call_args.kwargs["credential_data"] == {
            "token": "PAGE_TOKEN_1"
        }
        subscribe.assert_awaited_once_with("P1", "PAGE_TOKEN_1")
        enqueue.assert_awaited_once()
        assert view["form_name"] == "Free Checkup"
        assert view["page_name"] == "Acme Dental"
        assert view["connected_via"] == "oauth"
        assert view["instant"] is True

    @pytest.mark.asyncio
    async def test_rejects_form_from_another_page(self):
        db = _connect_db()
        with (
            patch(f"{CONNECT}.db_client", db),
            patch(
                f"{OAUTH}.db_client",
                MagicMock(get_configuration_value=AsyncMock(return_value=_account())),
            ),
            patch(f"{GRAPH}.list_pages", AsyncMock(return_value=_PAGES)),
            patch(
                f"{GRAPH}.list_lead_forms", AsyncMock(return_value=[{"id": "OTHER"}])
            ),
            pytest.raises(ValueError, match="doesn't belong"),
        ):
            await meta_connection_service.connect_meta(page_id="P1", **_CONNECT_ARGS)
        db.create_credential.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_rejects_already_connected_form(self):
        existing = SimpleNamespace(source_id="F1", orchestrator_metadata={"meta": {}})
        db = _connect_db(existing_campaigns=[existing])
        with (
            patch(f"{CONNECT}.db_client", db),
            pytest.raises(ValueError, match="already connected"),
        ):
            await meta_connection_service.connect_meta(page_id="P1", **_CONNECT_ARGS)

    @pytest.mark.asyncio
    async def test_disconnected_form_can_be_reconnected(self):
        old = SimpleNamespace(
            source_id="F1", orchestrator_metadata={"meta": {"disconnected": True}}
        )
        db = _connect_db(existing_campaigns=[old])
        with (
            patch(f"{CONNECT}.db_client", db),
            patch(f"{CONNECT}.enqueue_job", AsyncMock()),
            patch(
                f"{GRAPH}.get_form",
                AsyncMock(return_value={"id": "F1", "name": "Form"}),
            ),
        ):
            view = await meta_connection_service.connect_meta(
                page_access_token="MANUAL", **_CONNECT_ARGS
            )
        assert view["connected_via"] == "token"
        assert view["instant"] is False

    @pytest.mark.asyncio
    async def test_webhook_subscribe_failure_still_connects(self):
        db = _connect_db()
        with (
            patch(f"{CONNECT}.db_client", db),
            patch(f"{CONNECT}.enqueue_job", AsyncMock()),
            patch(
                f"{OAUTH}.db_client",
                MagicMock(get_configuration_value=AsyncMock(return_value=_account())),
            ),
            patch(f"{GRAPH}.list_pages", AsyncMock(return_value=_PAGES)),
            patch(f"{GRAPH}.list_lead_forms", AsyncMock(return_value=[{"id": "F1"}])),
            patch(
                f"{GRAPH}.subscribe_page_to_leadgen",
                AsyncMock(side_effect=meta_graph_client.MetaGraphError("no perms")),
            ),
        ):
            view = await meta_connection_service.connect_meta(
                page_id="P1", **_CONNECT_ARGS
            )
        assert view["instant"] is False


def _sign(body: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()


def _leadgen_payload(form_id="F1", page_id="P1"):
    return {
        "object": "page",
        "entry": [
            {
                "id": page_id,
                "changes": [
                    {
                        "field": "leadgen",
                        "value": {
                            "form_id": form_id,
                            "page_id": page_id,
                            "leadgen_id": "L9",
                        },
                    }
                ],
            }
        ],
    }


def _campaign(cid, form_id="F1", page_id="P1", **meta):
    return SimpleNamespace(
        id=cid,
        source_id=form_id,
        orchestrator_metadata={"meta": {"page_id": page_id, **meta}},
    )


class TestWebhook:
    def test_signature(self):
        body = b'{"object":"page"}'
        assert meta_webhook_service.verify_signature(body, _sign(body))
        assert not meta_webhook_service.verify_signature(body, _sign(b"other"))
        assert not meta_webhook_service.verify_signature(body, None)

    def test_handshake(self):
        assert (
            meta_webhook_service.verify_subscription("subscribe", "verify-me", "42")
            == "42"
        )
        assert (
            meta_webhook_service.verify_subscription("subscribe", "wrong", "42") is None
        )

    @pytest.mark.asyncio
    async def test_polls_matching_connections_only(self):
        db = MagicMock()
        db.get_active_campaigns_by_source_ids = AsyncMock(
            return_value=[
                _campaign(1),
                _campaign(2, page_id="OTHER_PAGE"),
                _campaign(3, disconnected=True),
            ]
        )
        with (
            patch(f"{WEBHOOK}.db_client", db),
            patch(f"{WEBHOOK}.enqueue_job", AsyncMock()) as enqueue,
        ):
            count = await meta_webhook_service.handle_leadgen_payload(
                _leadgen_payload()
            )

        assert count == 1
        assert enqueue.call_args.args[1] == 1
        db.get_active_campaigns_by_source_ids.assert_awaited_once_with(
            "meta_instant_form", ["F1"]
        )

    def test_route_rejects_unsigned_and_accepts_signed(self):
        from api.routes.marketing import router

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        body = json.dumps(_leadgen_payload()).encode()
        handler = AsyncMock(return_value=1)
        with patch(f"{WEBHOOK}.handle_leadgen_payload", handler):
            bad = client.post(
                "/marketing/meta/webhook",
                content=body,
                headers={"X-Hub-Signature-256": "sha256=nope"},
            )
            good = client.post(
                "/marketing/meta/webhook",
                content=body,
                headers={"X-Hub-Signature-256": _sign(body)},
            )
            verify = client.get(
                "/marketing/meta/webhook",
                params={
                    "hub.mode": "subscribe",
                    "hub.verify_token": "verify-me",
                    "hub.challenge": "abc",
                },
            )
        assert bad.status_code == 403
        assert good.status_code == 200
        handler.assert_awaited_once()
        assert verify.status_code == 200 and verify.text == "abc"


class _FakeRedis:
    def __init__(self):
        self.store = {}

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    async def delete(self, key):
        return 1 if self.store.pop(key, None) is not None else 0

    async def exists(self, key):
        return 1 if key in self.store else 0


class TestPollLock:
    @pytest.mark.asyncio
    async def test_overlapping_poll_defers_to_holder_which_reruns(self):
        from api.tasks import campaign_tasks

        redis = _FakeRedis()
        ctx = {"redis": redis}
        calls = []

        async def fake_sync(campaign_id):
            calls.append(campaign_id)
            if len(calls) == 1:
                # A webhook-triggered poll arrives while this one is running.
                await campaign_tasks.poll_meta_leads(ctx, campaign_id)
            return 0

        service = SimpleNamespace(sync_source_data=fake_sync)
        with (
            patch.object(campaign_tasks, "get_sync_service", return_value=service),
            patch("api.tasks.arq.enqueue_job", AsyncMock()) as enqueue,
        ):
            await campaign_tasks.poll_meta_leads(ctx, 42)

        # Never concurrent: the overlapping request became one serial rerun.
        assert calls == [42, 42]
        assert redis.store == {}
        enqueue.assert_not_awaited()
