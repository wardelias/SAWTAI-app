"""In-editor AI assistant for voice agents.

The assistant answers a builder's questions about one workflow and, when asked
to change something, proposes complete replacement prompts for existing nodes.
It never writes to the workflow itself: suggestions go back to the editor,
where the builder applies them to the canvas and saves as usual.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, Literal

from loguru import logger
from pipecat.processors.aggregators.llm_context import LLMContext

from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.configuration.registry import ServiceProviders
from api.services.gen_ai.json_parser import parse_llm_json
from api.services.managed_model_services import get_dograh_service_api_key
from api.services.pipecat.service_factory import create_llm_service
from api.services.voice_prompting_guide import Stage, build_briefing

ASSISTANT_USAGE_CONTEXT = "agent_assistant"
_ASSISTANT_TIMEOUT_SECONDS = 90
# Room for up to MAX_SUGGESTIONS complete node prompts in one answer.
_ASSISTANT_MAX_TOKENS = 6000

# Node types whose `prompt` field the assistant may rewrite.
PROMPT_NODE_TYPES = frozenset({"startCall", "agentNode", "endCall", "globalNode"})

MAX_SUGGESTIONS = 3
# Budget for the workflow projection placed in the system prompt. Long agents
# keep every node visible; only the longest prompts get truncated.
_MAX_PROMPT_CHARS_PER_NODE = 6000
_MAX_WORKFLOW_CHARS = 40000

ASSISTANT_SYSTEM_PROMPT = """You are SawtAI's agent-building assistant. You help a builder understand and improve ONE voice AI agent. The agent talks to callers over the phone or in the browser, so every prompt must read well when spoken aloud: short turns, no markdown, no emojis, numbers and symbols written the way they are said.

The agent is a workflow of nodes connected by edges:
- startCall: the first node of the call; usually owns the greeting and opening flow.
- agentNode: a conversation step; its edges are the transitions out of it.
- endCall: wraps up and hangs up.
- globalNode: instructions prepended to every node (persona, tone, guardrails).
Edges carry a label and a condition; the agent moves along an edge when its condition is met.

You will receive the current workflow as JSON, then the builder's conversation with you.

How to help:
- Answer questions about the agent concretely, referring to nodes by name.
- When the builder asks you to change, improve, fix, translate or shorten something, propose edits as suggestions. Only rewrite the `prompt` of existing nodes listed in the workflow.
- Each suggestion's `prompt` is the COMPLETE replacement text for that node, never a diff or an excerpt. Preserve everything the builder did not ask to change, including variables written like {{name}}.
- Suggest at most {max_suggestions} node edits per reply and keep them focused on what was asked. If nothing needs to change, return no suggestions.
- If a request needs something a prompt cannot do (new nodes, tools, telephony, voices, models), say so and tell the builder where to do it in the editor.
- Never invent node ids.

{guidance}

Respond with ONLY a JSON object, no prose before or after it:
{{
  "reply": "your answer to the builder in plain text; short '- ' bullet lines are fine",
  "suggestions": [
    {{"node_id": "id of an existing node", "summary": "one line on what changed and why", "prompt": "the complete new prompt"}}
  ]
}}"""


@dataclass
class AssistantSuggestion:
    node_id: str
    node_name: str
    summary: str
    prompt: str


@dataclass
class AssistantReply:
    reply: str
    suggestions: list[AssistantSuggestion] = field(default_factory=list)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[truncated]"


def _node_name(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    name = data.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return str(node.get("type") or node.get("id") or "node")


def project_workflow(workflow_definition: dict[str, Any] | None) -> dict[str, Any]:
    """Reduce a workflow definition to what the assistant needs to reason about.

    Drops canvas state (positions, selection, validation flags) and secrets-bearing
    integration config, keeping node identity, type, prompt and greeting plus the
    edge graph by node name.
    """
    definition = workflow_definition or {}
    nodes = [n for n in definition.get("nodes") or [] if isinstance(n, dict)]
    edges = [e for e in definition.get("edges") or [] if isinstance(e, dict)]

    names_by_id = {str(n.get("id")): _node_name(n) for n in nodes}
    projected_nodes = []
    for node in nodes:
        data = node.get("data") or {}
        entry: dict[str, Any] = {
            "id": str(node.get("id")),
            "type": node.get("type"),
            "name": _node_name(node),
        }
        prompt = data.get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            entry["prompt"] = _truncate(prompt, _MAX_PROMPT_CHARS_PER_NODE)
        greeting = data.get("greeting")
        if isinstance(greeting, str) and greeting.strip():
            entry["greeting"] = _truncate(greeting, 1000)
        projected_nodes.append(entry)

    projected_edges = []
    for edge in edges:
        data = edge.get("data") or {}
        projected_edges.append(
            {
                "from": names_by_id.get(str(edge.get("source")), edge.get("source")),
                "to": names_by_id.get(str(edge.get("target")), edge.get("target")),
                "label": data.get("label") or "",
                "condition": _truncate(str(data.get("condition") or ""), 1000),
            }
        )

    return {"nodes": projected_nodes, "edges": projected_edges}


def _fit_projection(projection: dict[str, Any]) -> str:
    """Serialize the projection, shrinking per-node prompts until it fits."""
    serialized = json.dumps(projection, ensure_ascii=False, indent=1)
    limit = _MAX_PROMPT_CHARS_PER_NODE
    while len(serialized) > _MAX_WORKFLOW_CHARS and limit > 500:
        limit //= 2
        for node in projection["nodes"]:
            if "prompt" in node:
                node["prompt"] = _truncate(node["prompt"], limit)
        serialized = json.dumps(projection, ensure_ascii=False, indent=1)
    return serialized


def _guidance_block() -> str:
    briefing = build_briefing(Stage.review)
    lines = ["Voice-prompting checks to apply when reviewing or rewriting:"]
    for topic in briefing.get("topics", []):
        lens = (topic.get("lens") or "").strip()
        title = topic.get("title") or topic.get("id")
        lines.append(f"- {title}: {lens}" if lens else f"- {title}")
    return "\n".join(lines)


def build_system_prompt(
    *,
    workflow_name: str,
    workflow_definition: dict[str, Any] | None,
    focus_node_id: str | None = None,
) -> str:
    projection = project_workflow(workflow_definition)
    prompt = ASSISTANT_SYSTEM_PROMPT.format(
        max_suggestions=MAX_SUGGESTIONS,
        guidance=_guidance_block(),
    )
    parts = [
        prompt,
        f'Agent name: "{workflow_name}"',
        "Current workflow:",
        _fit_projection(projection),
    ]
    if focus_node_id:
        focus = next(
            (n for n in projection["nodes"] if n["id"] == str(focus_node_id)), None
        )
        if focus is not None:
            parts.append(
                f'The builder is currently looking at the node "{focus["name"]}" '
                f"(id {focus['id']}); prefer it when the request is ambiguous."
            )
    return "\n\n".join(parts)


def build_messages(
    messages: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Map the editor chat history onto LLM context messages."""
    out: list[dict[str, str]] = []
    for message in messages:
        role: Literal["user", "assistant"] = (
            "assistant" if message.get("role") == "assistant" else "user"
        )
        content = (message.get("content") or "").strip()
        if content:
            out.append({"role": role, "content": content})
    return out


def parse_assistant_output(
    raw: str | None,
    workflow_definition: dict[str, Any] | None,
) -> AssistantReply:
    """Turn the LLM's JSON answer into a reply plus validated suggestions.

    Suggestions that point at unknown nodes, nodes without a prompt field, or
    carry an empty prompt are dropped rather than surfaced to the builder.
    """
    if not raw or not raw.strip():
        return AssistantReply(
            reply="I couldn't come up with an answer. Please try rephrasing."
        )

    parsed = parse_llm_json(raw)
    if not isinstance(parsed, dict) or "raw" in parsed and len(parsed) == 1:
        # Model ignored the JSON contract; show its text as-is.
        return AssistantReply(reply=raw.strip())

    reply = parsed.get("reply")
    reply_text = reply.strip() if isinstance(reply, str) else ""

    nodes_by_id = {
        str(n.get("id")): n
        for n in (workflow_definition or {}).get("nodes") or []
        if isinstance(n, dict)
    }

    suggestions: list[AssistantSuggestion] = []
    seen: set[str] = set()
    raw_suggestions = parsed.get("suggestions")
    for item in raw_suggestions if isinstance(raw_suggestions, list) else []:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("node_id") or "").strip()
        new_prompt = item.get("prompt")
        node = nodes_by_id.get(node_id)
        if (
            node is None
            or node_id in seen
            or not isinstance(new_prompt, str)
            or not new_prompt.strip()
        ):
            continue
        node_data = node.get("data") or {}
        if node.get("type") not in PROMPT_NODE_TYPES and not isinstance(
            node_data.get("prompt"), str
        ):
            continue
        summary = item.get("summary")
        suggestions.append(
            AssistantSuggestion(
                node_id=node_id,
                node_name=_node_name(node),
                summary=summary.strip() if isinstance(summary, str) else "",
                prompt=new_prompt.strip(),
            )
        )
        seen.add(node_id)
        if len(suggestions) >= MAX_SUGGESTIONS:
            break

    if not reply_text:
        reply_text = (
            "Here are my suggested changes."
            if suggestions
            else "I don't have anything to add for that."
        )
    return AssistantReply(reply=reply_text, suggestions=suggestions)


class AssistantUnavailableError(Exception):
    """The workflow has no LLM the assistant can use."""


class AssistantFailedError(Exception):
    """The LLM call failed or timed out."""


async def _resolve_managed_correlation_id(user_config) -> str | None:
    """Mint an MPS correlation id for a managed-LLM call made outside a run.

    Mirrors the managed-embeddings path: billing works without one, so a
    minting failure degrades to an uncorrelated call instead of failing.
    """
    llm = user_config.llm
    if llm is None or getattr(llm, "provider", None) not in (
        ServiceProviders.DOGRAH,
        ServiceProviders.DOGRAH.value,
    ):
        return None
    service_key = get_dograh_service_api_key(user_config)
    if not service_key:
        return None

    # Imported lazily, matching the embeddings factory, to avoid import cycles.
    from api.services.mps_service_key_client import mps_service_key_client

    try:
        minted = await mps_service_key_client.create_correlation_id(
            service_key=service_key
        )
        return minted.get("correlation_id")
    except Exception as e:
        logger.warning(f"Agent assistant: could not mint MPS correlation id: {e}")
        return None


async def run_agent_assistant(
    *,
    organization_id: int | None,
    workflow_name: str,
    workflow_definition: dict[str, Any] | None,
    workflow_configurations: dict[str, Any] | None,
    messages: list[dict[str, str]],
    focus_node_id: str | None = None,
) -> AssistantReply:
    """Answer the builder's latest message using the workflow's own LLM."""
    user_config = await get_effective_ai_model_configuration_for_workflow(
        organization_id=organization_id,
        workflow_configurations=workflow_configurations,
    )
    if user_config.llm is None:
        raise AssistantUnavailableError(
            "No language model is configured for this agent. "
            "Add one under Models to use the AI assistant."
        )

    correlation_id = await _resolve_managed_correlation_id(user_config)
    try:
        llm = create_llm_service(
            user_config,
            correlation_id=correlation_id,
            usage_context=ASSISTANT_USAGE_CONTEXT,
        )
    except Exception as e:
        raise AssistantUnavailableError(
            "The language model configured for this agent can't be used by the "
            "assistant. Check its settings under Models."
        ) from e

    context = LLMContext()
    context.set_messages(build_messages(messages))
    system_prompt = build_system_prompt(
        workflow_name=workflow_name,
        workflow_definition=workflow_definition,
        focus_node_id=focus_node_id,
    )

    try:
        raw = await asyncio.wait_for(
            llm.run_inference(
                context,
                max_tokens=_ASSISTANT_MAX_TOKENS,
                system_instruction=system_prompt,
            ),
            timeout=_ASSISTANT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as e:
        raise AssistantFailedError(
            "The assistant took too long to answer. Please try again."
        ) from e
    except NotImplementedError as e:
        raise AssistantUnavailableError(
            "The language model configured for this agent doesn't support the "
            "assistant. Pick a different LLM under Models."
        ) from e
    except Exception as e:
        logger.warning(f"Agent assistant inference failed: {e}")
        raise AssistantFailedError(
            "The assistant couldn't reach the language model. Please try again."
        ) from e

    return parse_assistant_output(raw, workflow_definition)
