"""One chat turn of the agent copilot: a streamed Claude tool-use loop.

`run_turn` yields UI events (plain dicts the route serializes as SSE):

    {"type": "step_start"}                         new model call begins
    {"type": "step_retry"}                         discard UI output since step_start
    {"type": "text", "text": str}                  reply text delta
    {"type": "progress", "text": str}              between-tool progress note delta
    {"type": "tool_start", "id": str, "name": str}
    {"type": "tool_end", "id": str, "name": str, "ok": bool, ...summary}
    {"type": "error", "message": str}
    {"type": "done"}

History is append-only and checkpointed after every completed tool round,
so a dropped connection never leaves a `tool_use` without its result.
"""

from __future__ import annotations

from typing import Any, AsyncIterator

import anthropic
from loguru import logger

from api.constants import AGENT_COPILOT_EFFORT, AGENT_COPILOT_MODEL, ANTHROPIC_API_KEY
from api.db.models import UserModel
from api.services.agent_copilot import history
from api.services.agent_copilot.prompt import (
    COPILOT_SYSTEM_PROMPT,
    editor_context_block,
)
from api.services.agent_copilot.tools import build_tool_definitions, run_tool

_BETAS = [
    # Re-run a safety-classifier decline on Anthropic's recommended fallback
    # model instead of failing the turn.
    "server-side-fallback-2026-07-01",
    # Return the model's notes between tool calls as short summaries so the
    # chat isn't silent during long edits.
    "thinking-display-updates-2026-08-18",
    # Lets us set prefix_mismatch_behavior: a deploy that changes the system
    # prompt or tool list drops stale thinking blocks instead of 400-ing every
    # open conversation.
    "thinking-binding-controls-2026-08-01",
]
_MAX_TOKENS = 64000
# Model calls per user message. A full build (guide lookups, node specs,
# save, fix-up saves) takes ~10-15; this only stops runaway loops.
_MAX_STEPS = 40
_MAX_JSON_RETRIES = 2

# The request shape (adaptive thinking with display "updates", fallbacks
# "default") is accepted by these models; others may reject it.
SUPPORTED_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5")
if AGENT_COPILOT_MODEL not in SUPPORTED_MODELS:
    logger.warning(
        f"AGENT_COPILOT_MODEL={AGENT_COPILOT_MODEL!r} is not one of "
        f"{SUPPORTED_MODELS}; the agent copilot may fail."
    )

_client: anthropic.AsyncAnthropic | None = None


def is_enabled() -> bool:
    return ANTHROPIC_API_KEY is not None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _client


def _ui_event(event: Any) -> dict[str, Any] | None:
    """Map a raw stream event to a UI event, or None to skip it."""
    if event.type == "content_block_start" and event.content_block.type == "tool_use":
        return {
            "type": "tool_start",
            "id": event.content_block.id,
            "name": event.content_block.name,
        }
    if event.type == "content_block_delta":
        if event.delta.type == "text_delta":
            return {"type": "text", "text": event.delta.text}
        if event.delta.type == "thinking_delta" and event.delta.thinking:
            return {"type": "progress", "text": event.delta.thinking}
    return None


def _api_error_message(e: anthropic.APIError) -> str:
    if isinstance(e, anthropic.AuthenticationError):
        return "The assistant is misconfigured (invalid Anthropic API key)."
    if isinstance(e, anthropic.RateLimitError):
        return "The assistant is busy right now. Please try again in a minute."
    if isinstance(e, anthropic.APIConnectionError):
        return "Couldn't reach the AI service. Please try again."
    return "The assistant hit an error. Please try again."


async def run_turn(
    *,
    user: UserModel,
    conversation_id: str,
    message: str,
    editor_workflow: tuple[int, str] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run one user message to completion. Caller must hold the turn lock.

    ``editor_workflow`` is the (id, name) of the agent open in the editor,
    already verified to belong to the user's organization.
    """
    org_id, user_id = user.selected_organization_id, user.id
    prior = await history.load_messages(org_id, user_id, conversation_id)

    user_content: list[dict[str, Any]] = []
    if editor_workflow is not None:
        user_content.append(
            {"type": "text", "text": editor_context_block(*editor_workflow)}
        )
    user_content.append({"type": "text", "text": message})
    # Messages from this turn that are safe to persist: never an assistant
    # tool_use without the user tool_result that answers it.
    pending: list[dict[str, Any]] = [{"role": "user", "content": user_content}]

    async def commit() -> None:
        await history.save_messages(org_id, user_id, conversation_id, prior + pending)

    tools = await build_tool_definitions()
    client = _get_client()
    usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    json_retries = 0
    steps = 0

    try:
        while True:
            if steps >= _MAX_STEPS:
                yield {
                    "type": "error",
                    "message": "Stopped after too many steps. Send a message to continue.",
                }
                break
            steps += 1
            yield {"type": "step_start"}

            try:
                async with client.beta.messages.stream(
                    model=AGENT_COPILOT_MODEL,
                    max_tokens=_MAX_TOKENS,
                    betas=_BETAS,
                    fallbacks="default",
                    thinking={
                        "type": "adaptive",
                        "display": "updates",
                        "block_binding": {"prefix_mismatch_behavior": "drop_block"},
                    },
                    output_config={"effort": AGENT_COPILOT_EFFORT},
                    cache_control={"type": "ephemeral"},
                    system=COPILOT_SYSTEM_PROMPT,
                    tools=tools,
                    messages=prior + pending,
                ) as stream:
                    async for event in stream:
                        ui_event = _ui_event(event)
                        if ui_event is not None:
                            yield ui_event
                    response = await stream.get_final_message()
            except anthropic.APIError as e:
                logger.warning(f"agent copilot API error (org {org_id}): {e}")
                yield {"type": "error", "message": _api_error_message(e)}
                break
            except ValueError:
                # Eagerly streamed tool input the SDK could not parse at all.
                # It raised before the tool_use block completed, so there is
                # no id to answer; re-issue the step.
                json_retries += 1
                if json_retries > _MAX_JSON_RETRIES:
                    yield {
                        "type": "error",
                        "message": "The assistant produced an invalid edit. Please try again.",
                    }
                    break
                yield {"type": "step_retry"}
                continue
            json_retries = 0

            usage["input"] += response.usage.input_tokens or 0
            usage["output"] += response.usage.output_tokens or 0
            usage["cache_read"] += response.usage.cache_read_input_tokens or 0
            usage["cache_write"] += response.usage.cache_creation_input_tokens or 0
            dropped = getattr(response, "input_transformations", None)
            if dropped:
                logger.info(f"agent copilot input_transformations: {dropped}")

            assistant = {
                "role": "assistant",
                "content": [block.to_dict(mode="json") for block in response.content],
            }
            tool_uses = [b for b in response.content if b.type == "tool_use"]

            if response.stop_reason == "refusal":
                yield {
                    "type": "error",
                    "message": "The assistant declined this request.",
                }
                break
            if response.stop_reason == "max_tokens":
                # A truncated tool input can parse as a valid partial object;
                # never run it.
                yield {
                    "type": "error",
                    "message": "The reply was too long and got cut off. Try a smaller change.",
                }
                break
            if response.stop_reason == "pause_turn":
                pending.append(assistant)
                continue
            if not tool_uses:
                pending.append(assistant)
                break

            results: list[dict[str, Any]] = []
            for block in tool_uses:
                outcome = await run_tool(user, block.name, block.input)
                result: dict[str, Any] = {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": outcome.content,
                }
                if outcome.is_error:
                    result["is_error"] = True
                results.append(result)
                yield {
                    "type": "tool_end",
                    "id": block.id,
                    "name": block.name,
                    "ok": not outcome.is_error
                    and "error_code" not in outcome.ui_summary,
                    **outcome.ui_summary,
                }
            pending.append(assistant)
            pending.append({"role": "user", "content": results})
            await commit()
    finally:
        logger.info(
            f"agent copilot turn org={org_id} user={user_id} "
            f"conversation={conversation_id} model={AGENT_COPILOT_MODEL} "
            f"steps={steps} usage={usage}"
        )

    await commit()
    yield {"type": "done"}
