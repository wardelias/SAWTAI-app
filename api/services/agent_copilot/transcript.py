"""Render stored copilot history as the chat transcript the UI displays.

The stored history is the raw Claude message list (thinking blocks, tool
calls, tool results). The UI shows a simpler shape: user messages, and
assistant turns made of text, progress notes, and tool steps. Building it
here lets a reloaded page (or another device) restore the conversation.
"""

from __future__ import annotations

import json
from typing import Any

_EDITOR_CONTEXT_PREFIX = "<editor_context>"
_WORKFLOW_MUTATING_TOOLS = {"save_workflow", "create_workflow"}


def _blocks(message: dict[str, Any]) -> list[dict[str, Any]]:
    content = message.get("content")
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return content or []


def build_transcript(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    transcript: list[dict[str, Any]] = []
    tools_by_id: dict[str, dict[str, Any]] = {}

    def assistant_turn() -> dict[str, Any]:
        if not transcript or transcript[-1]["role"] != "assistant":
            transcript.append({"role": "assistant", "parts": []})
        return transcript[-1]

    for message in messages:
        blocks = _blocks(message)
        if message["role"] == "user":
            results = [b for b in blocks if b.get("type") == "tool_result"]
            for result in results:
                part = tools_by_id.get(result.get("tool_use_id", ""))
                if part is None:
                    continue
                part["status"] = "error" if result.get("is_error") else "ok"
                if part["status"] == "ok":
                    _apply_tool_payload(part, result.get("content"))
            texts = [
                b["text"]
                for b in blocks
                if b.get("type") == "text"
                and not b.get("text", "").startswith(_EDITOR_CONTEXT_PREFIX)
            ]
            if texts:
                transcript.append({"role": "user", "text": "\n".join(texts)})
            continue

        turn = assistant_turn()
        for block in blocks:
            kind = block.get("type")
            if kind == "text" and block.get("text"):
                turn["parts"].append({"kind": "text", "text": block["text"]})
            elif kind == "thinking" and block.get("thinking"):
                turn["parts"].append({"kind": "progress", "text": block["thinking"]})
            elif kind == "tool_use":
                part = {
                    "kind": "tool",
                    "id": block["id"],
                    "name": block["name"],
                    # A tool_use with no stored result was interrupted.
                    "status": "error",
                }
                tools_by_id[block["id"]] = part
                turn["parts"].append(part)
    return transcript


def _apply_tool_payload(part: dict[str, Any], content: Any) -> None:
    """Mirror the live stream: in-band save failures show as errors, and
    successful saves/creates carry the agent they touched."""
    if not isinstance(content, str):
        return
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return
    if not isinstance(payload, dict):
        return
    if payload.get("saved") is False or payload.get("created") is False:
        part["status"] = "error"
    elif part["name"] in _WORKFLOW_MUTATING_TOOLS and isinstance(
        payload.get("workflow_id"), int
    ):
        part["workflowId"] = payload["workflow_id"]
        part["workflowName"] = payload.get("name")
