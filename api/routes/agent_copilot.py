"""Agent copilot chat: build and customize agents by talking to an assistant.

`POST /agent-copilot/chat` streams Server-Sent Events. Each event is a
JSON object on a `data:` line; the first is
`{"type": "conversation", "conversation_id": ...}` and the rest are the
events documented in `api/services/agent_copilot/runner.py`. SSE comment
lines (`: keepalive`) are sent while the model works so idle-timeout
proxies keep the connection open.

`GET /agent-copilot/conversations/{id}` returns the displayable transcript
so a reloaded page can restore the chat.

`GET/PUT /agent-copilot/settings` manage the organization's own Anthropic
key, model, effort, daily limit, and on/off switch.
"""

import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, field_validator

from api.constants import ANTHROPIC_API_KEY
from api.db import db_client
from api.db.models import UserModel
from api.services.agent_copilot import (
    EFFORT_LEVELS,
    SUPPORTED_MODELS,
    InvalidApiKeyError,
    acquire_turn_lock,
    build_transcript,
    consume_daily_message,
    get_effective_settings,
    load_messages,
    load_stored_settings,
    release_turn_lock,
    resolve_settings,
    run_turn,
    save_stored_settings,
    verify_api_key,
)
from api.services.auth.depends import get_user
from api.services.configuration.masking import is_mask_of, mask_key

router = APIRouter(prefix="/agent-copilot")

_KEEPALIVE_SECONDS = 15.0


class CopilotStatusResponse(BaseModel):
    # The organization hasn't switched the assistant off.
    enabled: bool
    # An API key is available (the organization's own, or the platform's).
    configured: bool
    model: str | None


class CopilotSettingsResponse(BaseModel):
    enabled: bool
    # Masked; empty when the organization uses the platform key.
    api_key: str
    has_own_key: bool
    platform_key_available: bool
    model: str
    effort: str
    # The organization's own limit (None = default).
    daily_message_limit: int | None
    # What applies right now (0 = unlimited).
    effective_daily_message_limit: int
    supported_models: list[str]
    effort_levels: list[str]


class CopilotSettingsRequest(BaseModel):
    enabled: bool = True
    # The masked value keeps the stored key; "" removes it.
    api_key: str = ""
    model: str = SUPPORTED_MODELS[0]
    effort: str = "medium"
    daily_message_limit: int | None = Field(default=None, ge=0, le=100000)

    @field_validator("model")
    @classmethod
    def validate_model(cls, v: str) -> str:
        if v not in SUPPORTED_MODELS:
            raise ValueError(f"model must be one of {', '.join(SUPPORTED_MODELS)}")
        return v

    @field_validator("effort")
    @classmethod
    def validate_effort(cls, v: str) -> str:
        if v not in EFFORT_LEVELS:
            raise ValueError(f"effort must be one of {', '.join(EFFORT_LEVELS)}")
        return v

    @field_validator("api_key")
    @classmethod
    def strip_api_key(cls, v: str) -> str:
        return v.strip()


class CopilotChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=20000)
    # Omit to start a new conversation; the server returns the new id.
    conversation_id: str | None = None
    # The agent open in the editor, if any. Gives the assistant context.
    workflow_id: int | None = None

    @field_validator("conversation_id")
    @classmethod
    def validate_conversation_id(cls, v: str | None) -> str | None:
        if v is None:
            return v
        try:
            return str(uuid.UUID(v))
        except ValueError:
            raise ValueError("conversation_id must be a UUID")


class CopilotConversationResponse(BaseModel):
    conversation_id: str
    messages: list[dict[str, Any]]


def _parse_conversation_id(conversation_id: str) -> str:
    try:
        return str(uuid.UUID(conversation_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Conversation not found")


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


@router.get("/status")
async def get_copilot_status(
    user: UserModel = Depends(get_user),
) -> CopilotStatusResponse:
    """Whether the assistant is switched on and has an API key for this org."""
    settings = await get_effective_settings(_require_org(user))
    return CopilotStatusResponse(
        enabled=settings.enabled,
        configured=settings.api_key is not None,
        model=settings.model if settings.available else None,
    )


def _settings_response(stored: dict[str, Any]) -> CopilotSettingsResponse:
    effective = resolve_settings(stored)
    own_key = stored.get("api_key") or ""
    return CopilotSettingsResponse(
        enabled=effective.enabled,
        api_key=mask_key(own_key) if own_key else "",
        has_own_key=bool(own_key),
        platform_key_available=ANTHROPIC_API_KEY is not None,
        model=effective.model,
        effort=effective.effort,
        daily_message_limit=stored.get("daily_message_limit"),
        effective_daily_message_limit=effective.daily_message_limit,
        supported_models=list(SUPPORTED_MODELS),
        effort_levels=list(EFFORT_LEVELS),
    )


@router.get("/settings")
async def get_copilot_settings(
    user: UserModel = Depends(get_user),
) -> CopilotSettingsResponse:
    """The organization's AI assistant settings (API key masked)."""
    return _settings_response(await load_stored_settings(_require_org(user)))


@router.put("/settings")
async def update_copilot_settings(
    request: CopilotSettingsRequest,
    user: UserModel = Depends(get_user),
) -> CopilotSettingsResponse:
    """Save the organization's AI assistant settings.

    A new API key is verified with Anthropic before it is stored.
    """
    org_id = _require_org(user)
    stored = await load_stored_settings(org_id)
    existing_key = stored.get("api_key") or ""

    if existing_key and is_mask_of(request.api_key, existing_key):
        api_key = existing_key
    else:
        api_key = request.api_key

    # Check a new key, or the existing key against a newly chosen model.
    if api_key and (api_key != existing_key or request.model != stored.get("model")):
        try:
            await verify_api_key(api_key, request.model)
        except InvalidApiKeyError as e:
            raise HTTPException(status_code=400, detail=str(e))

    value = {
        "enabled": request.enabled,
        "model": request.model,
        "effort": request.effort,
        "daily_message_limit": request.daily_message_limit,
    }
    if api_key:
        value["api_key"] = api_key
    await save_stored_settings(org_id, value)
    return _settings_response(value)


@router.get("/conversations/{conversation_id}")
async def get_copilot_conversation(
    conversation_id: str,
    user: UserModel = Depends(get_user),
) -> CopilotConversationResponse:
    """The displayable transcript of one of the caller's conversations."""
    conversation_id = _parse_conversation_id(conversation_id)
    messages = await load_messages(
        user.selected_organization_id, user.id, conversation_id
    )
    if not messages:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return CopilotConversationResponse(
        conversation_id=conversation_id, messages=build_transcript(messages)
    )


@router.post("/chat")
async def chat_with_copilot(
    request: CopilotChatRequest,
    user: UserModel = Depends(get_user),
) -> StreamingResponse:
    """Send one message to the copilot and stream its reply."""
    org_id = _require_org(user)
    settings = await get_effective_settings(org_id)
    if not settings.enabled:
        raise HTTPException(
            status_code=403,
            detail="The AI assistant is turned off for your organization. Turn it on in Settings.",
        )
    if settings.api_key is None:
        raise HTTPException(
            status_code=503,
            detail="The AI assistant needs an Anthropic API key. Add one in Settings → AI Assistant.",
        )

    editor_workflow = None
    if request.workflow_id is not None:
        workflow = await db_client.get_workflow(
            request.workflow_id, organization_id=org_id
        )
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        editor_workflow = (workflow.id, workflow.name)

    conversation_id = request.conversation_id or str(uuid.uuid4())
    if not await acquire_turn_lock(org_id, user.id, conversation_id):
        raise HTTPException(
            status_code=409,
            detail="The assistant is still replying in this conversation.",
        )
    if not await consume_daily_message(org_id, settings.daily_message_limit):
        await release_turn_lock(org_id, user.id, conversation_id)
        raise HTTPException(
            status_code=429,
            detail="Your organization has reached today's AI assistant limit. It resets at midnight UTC.",
        )

    # The turn runs in its own task feeding a queue, so the response can
    # interleave keepalive comments while the model is thinking. Closing
    # the stream (client disconnect / Stop) cancels the turn.
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def produce() -> None:
        try:
            async for event in run_turn(
                user=user,
                conversation_id=conversation_id,
                message=request.message,
                settings=settings,
                editor_workflow=editor_workflow,
            ):
                await queue.put(event)
        except Exception as e:  # noqa: BLE001 — end the stream with a readable error
            logger.exception(f"agent copilot turn failed: {e}")
            await queue.put(
                {
                    "type": "error",
                    "message": "The assistant hit an error. Please try again.",
                }
            )
            await queue.put({"type": "done"})
        finally:
            await release_turn_lock(org_id, user.id, conversation_id)
            await queue.put(None)

    async def events():
        task = asyncio.create_task(produce())
        try:
            yield _sse({"type": "conversation", "conversation_id": conversation_id})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), _KEEPALIVE_SECONDS)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if event is None:
                    break
                yield _sse(event)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
