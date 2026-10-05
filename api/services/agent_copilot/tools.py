"""Bridge between the copilot's Claude tool loop and the MCP tool surface.

The copilot exposes exactly the tools registered on the MCP server, with
the same names, descriptions, and JSON schemas, so the in-app chat and
external MCP clients (Claude Desktop etc.) drive one implementation. Tools
run in-process as the signed-in user via `acting_as`, so every tool keeps
its own organization scoping.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from loguru import logger
from pydantic import ValidationError

from api.db.models import UserModel
from api.mcp_server import mcp
from api.mcp_server.auth import acting_as

# Tools whose successful result changes an agent the editor may be showing.
_WORKFLOW_MUTATING_TOOLS = {"save_workflow", "create_workflow"}


@dataclass
class ToolOutcome:
    """Result of one tool call, shaped for both Claude and the UI."""

    content: str
    is_error: bool
    # Set when a save/create succeeded, so the UI can reload or navigate.
    changed_workflow_id: int | None = None
    ui_summary: dict[str, Any] = field(default_factory=dict)


async def build_tool_definitions() -> list[dict[str, Any]]:
    """Claude tool definitions for every registered MCP tool.

    Sorted by name so the list is byte-stable across requests (it sits at
    the front of the cached prompt prefix). Inputs stream eagerly because
    `save_workflow` / `create_workflow` carry whole TypeScript files;
    `run_tool` validates every input before executing it.
    """
    tools = await mcp.list_tools()
    return [
        {
            "name": tool.name,
            "description": tool.description or "",
            "input_schema": tool.parameters,
            "eager_input_streaming": True,
        }
        for tool in sorted(tools, key=lambda t: t.name)
    ]


async def run_tool(user: UserModel, name: str, arguments: Any) -> ToolOutcome:
    """Validate and execute one MCP tool call as ``user``.

    Failures come back as `is_error` outcomes (never raised) so Claude can
    read the message and correct its call.
    """
    tool = await mcp.get_tool(name)
    if tool is None:
        return ToolOutcome(content=f"Unknown tool: {name}", is_error=True)
    if not isinstance(arguments, dict):
        return ToolOutcome(
            content=json.dumps({"INVALID_JSON": json.dumps(arguments)}),
            is_error=True,
        )

    try:
        with acting_as(user):
            result = await tool.run(arguments)
    except ValidationError as e:
        return ToolOutcome(content=f"Invalid arguments for {name}: {e}", is_error=True)
    except HTTPException as e:
        return ToolOutcome(content=f"{name} failed: {e.detail}", is_error=True)
    except Exception as e:  # noqa: BLE001 — surface to the model, never crash the turn
        logger.exception(f"agent copilot tool {name} raised: {e}")
        return ToolOutcome(
            content=f"{name} failed with an internal error.", is_error=True
        )

    text = "\n".join(
        block.text for block in result.content if getattr(block, "type", "") == "text"
    )
    structured = result.structured_content or {}
    outcome = ToolOutcome(content=text or json.dumps(structured), is_error=False)

    # Tools report author-side failures (parse/validation errors) in-band.
    if structured.get("saved") is False or structured.get("created") is False:
        outcome.ui_summary = {"error_code": structured.get("error_code")}
    elif name in _WORKFLOW_MUTATING_TOOLS and isinstance(
        structured.get("workflow_id"), int
    ):
        outcome.changed_workflow_id = structured["workflow_id"]
        outcome.ui_summary = {
            "workflow_id": structured["workflow_id"],
            "workflow_name": structured.get("name"),
            "version_number": structured.get("version_number"),
        }
    return outcome
