"""Agent copilot chat: build and customize agents by talking to an assistant.

`POST /agent-copilot/chat` streams Server-Sent Events. Each event is a
JSON object on a `data:` line; the first is
`{"type": "conversation", "conversation_id": ...}` and the rest are the
events documented in `api/services/agent_copilot/runner.py`.
"""

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, field_validator

from api.constants import AGENT_COPILOT_MODEL
from api.db import db_client
from api.db.models import UserModel
from api.services.agent_copilot import (
    acquire_turn_lock,
    is_enabled,
    release_turn_lock,
    run_turn,
)
from api.services.auth.depends import get_user

router = APIRouter(prefix="/agent-copilot")


class CopilotStatusResponse(BaseModel):
    enabled: bool
    model: str | None


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


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.get("/status")
async def get_copilot_status(
    user: UserModel = Depends(get_user),
) -> CopilotStatusResponse:
    """Whether the copilot is configured on this deployment."""
    enabled = is_enabled()
    return CopilotStatusResponse(
        enabled=enabled, model=AGENT_COPILOT_MODEL if enabled else None
    )


@router.post("/chat")
async def chat_with_copilot(
    request: CopilotChatRequest,
    user: UserModel = Depends(get_user),
) -> StreamingResponse:
    """Send one message to the copilot and stream its reply."""
    if not is_enabled():
        raise HTTPException(
            status_code=503,
            detail="The AI assistant is not configured (ANTHROPIC_API_KEY is unset).",
        )
    org_id = user.selected_organization_id

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

    async def events():
        try:
            yield _sse({"type": "conversation", "conversation_id": conversation_id})
            async for event in run_turn(
                user=user,
                conversation_id=conversation_id,
                message=request.message,
                editor_workflow=editor_workflow,
            ):
                yield _sse(event)
        except Exception as e:  # noqa: BLE001 — end the stream with a readable error
            logger.exception(f"agent copilot turn failed: {e}")
            yield _sse(
                {
                    "type": "error",
                    "message": "The assistant hit an error. Please try again.",
                }
            )
            yield _sse({"type": "done"})
        finally:
            await release_turn_lock(org_id, user.id, conversation_id)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
