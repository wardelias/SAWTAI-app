from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from api.db import db_client
from api.db.models import UserModel
from api.services.auth.depends import get_user_with_selected_organization
from api.services.workflow.assistant import (
    AssistantFailedError,
    AssistantUnavailableError,
    run_agent_assistant,
)

router = APIRouter(prefix="/workflow", tags=["workflow-assistant"])


class AgentAssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)


class AgentAssistantRequest(BaseModel):
    messages: list[AgentAssistantMessage] = Field(min_length=1, max_length=40)
    # The editor's current (possibly unsaved) graph. Falls back to the stored
    # draft/published definition when omitted.
    workflow_definition: dict[str, Any] | None = None
    focus_node_id: str | None = Field(default=None, max_length=200)

    @field_validator("messages")
    @classmethod
    def last_message_from_user(
        cls, messages: list[AgentAssistantMessage]
    ) -> list[AgentAssistantMessage]:
        if messages[-1].role != "user":
            raise ValueError("The last message must come from the user")
        return messages


class AgentAssistantSuggestion(BaseModel):
    node_id: str
    node_name: str
    summary: str
    prompt: str


class AgentAssistantResponse(BaseModel):
    reply: str
    suggestions: list[AgentAssistantSuggestion]


@router.post("/{workflow_id}/assistant")
async def chat_with_agent_assistant(
    workflow_id: int,
    request: AgentAssistantRequest,
    user: UserModel = Depends(get_user_with_selected_organization),
) -> AgentAssistantResponse:
    """Ask the AI assistant about an agent, optionally getting prompt rewrites.

    Suggestions are returned to the editor and never written to the workflow;
    the builder applies and saves them like any other edit.
    """
    workflow = await db_client.get_workflow(
        workflow_id, organization_id=user.selected_organization_id
    )
    if workflow is None:
        raise HTTPException(
            status_code=404, detail=f"Workflow with id {workflow_id} not found"
        )

    # Same version the editor shows: the draft when one exists.
    active_definition = (
        await db_client.get_draft_version(workflow_id) or workflow.released_definition
    )
    stored_definition = active_definition.workflow_json if active_definition else None
    workflow_configurations = (
        active_definition.workflow_configurations
        if active_definition
        else workflow.workflow_configurations
    )

    try:
        result = await run_agent_assistant(
            organization_id=user.selected_organization_id,
            workflow_name=workflow.name,
            workflow_definition=request.workflow_definition or stored_definition,
            workflow_configurations=workflow_configurations,
            messages=[m.model_dump() for m in request.messages],
            focus_node_id=request.focus_node_id,
        )
    except AssistantUnavailableError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except AssistantFailedError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return AgentAssistantResponse(
        reply=result.reply,
        suggestions=[
            AgentAssistantSuggestion(
                node_id=s.node_id,
                node_name=s.node_name,
                summary=s.summary,
                prompt=s.prompt,
            )
            for s in result.suggestions
        ],
    )
