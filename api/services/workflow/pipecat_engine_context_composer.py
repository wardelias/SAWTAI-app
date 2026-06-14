"""System prompt and function schema composition for PipecatEngine nodes.

Extracts prompt and function composition logic from PipecatEngine into
reusable functions. Defines recording response mode markers and instructions.
"""

from typing import TYPE_CHECKING, Callable, Optional

if TYPE_CHECKING:
    from api.services.workflow.pipecat_engine_custom_tools import CustomToolManager
    from api.services.workflow.workflow_graph import Node, WorkflowGraph

from api.services.workflow.pipecat_engine_custom_tools import get_function_schema
from api.services.workflow.tools.knowledge_base import get_knowledge_base_tool

# ---------------------------------------------------------------------------
# Recording response mode markers
# ---------------------------------------------------------------------------

RECORDING_MARKER = "●"  # Play pre-recorded audio
TTS_MARKER = "▸"  # Generate dynamic TTS text

# ---------------------------------------------------------------------------
# Recording response mode system prompt instructions
# ---------------------------------------------------------------------------

RECORDING_RESPONSE_MODE_INSTRUCTIONS = """\
RESPONSE MODE INSTRUCTIONS - MANDATORY FORMAT:
Every response you generate MUST begin with excatcly one response mode indicator.
You have two modes for responding:

1. DYNAMIC SPEECH (▸): Generate text that will be converted to speech by TTS.
   Format: ▸ followed by a space and your full spoken response. Nothing else.
   Example: ▸ Hello! How can I help you today?

2. PRE-RECORDED AUDIO (●): Play a pre-recorded audio message.
   Format: ● followed by a space followed by recording_id followed by provided transcript. Nothing else.
   Example: ● rec_greeting_01 [ Provided Transcript ]

RULES:
- Your response MUST start with either ▸ or ● as the very first character.
- For ▸ (dynamic speech): Follow with a space and your response to be generated using TTS engine. Dont mix with ●
- For ● (pre-recorded audio): Follow with a space and recording_id of the audio clip with its transcript. Dont mix with ▸
- Use ● when a pre-recorded message matches the situation well.
- Use ▸ when you need to generate a dynamic, contextual response.
- *NEVER* mix modes in a single response, since we rely on the markers to decide whether to play using TTS or Pre-recorded audio."""


# ---------------------------------------------------------------------------
# Caller profile note (voice-based gender detection)
# ---------------------------------------------------------------------------

CALLER_PROFILE_NOTE_TEMPLATE = """\
CALLER PROFILE:
The caller's voice suggests they are most likely {gender}. When speaking a \
grammatically gendered language (such as Arabic or Hebrew), address the \
caller using the corresponding {gender} second-person forms (verb \
conjugations, pronouns, and adjectives). If the caller states or clearly \
implies a different gender, follow their lead instead of this note. Never \
mention this inference to the caller."""

# Female callers need an extra clause: undiacritized Arabic spells masculine
# and feminine address identically (e.g. أساعدك), so the TTS voice defaults to
# the MASCULINE pronunciation even when the agent intends feminine. Forcing the
# feminine reading requires explicit diacritics (tashkeel) and/or feminine verb
# forms whose consonants already differ.
FEMALE_PRONUNCIATION_GUIDANCE = """\
 IMPORTANT — make the feminine address audible to the text-to-speech voice: \
undiacritized Arabic spells masculine and feminine address the same way, so \
without help the voice will pronounce it as masculine. For every gendered word \
addressed to the caller (not just the first one):
- Add the diacritic (tashkeel) that forces the feminine reading — in \
particular a kasra under the second-person kaf ـكِ, e.g. write "أساعِدُكِ" \
(not "أساعدك"), "مَعَكِ", "شُكراً لكِ", "كيف حالُكِ".
- Prefer feminine verb forms whose letters already differ, so they read \
correctly even without diacritics: present tense adds ـِين ("تُريدِين", \
"تَستطيعِين"), the imperative adds ـي ("تفضّلي", "قولي"), and use the \
feminine pronoun ـكِ / أنتِ."""


def build_caller_profile_note(gender: str) -> str:
    """Build the caller-profile system-prompt note for a detected gender.

    For female callers, append explicit Arabic pronunciation guidance so the TTS
    voice actually speaks feminine forms (see ``FEMALE_PRONUNCIATION_GUIDANCE``).
    """
    note = CALLER_PROFILE_NOTE_TEMPLATE.format(gender=gender)
    if gender == "female":
        note += FEMALE_PRONUNCIATION_GUIDANCE
    return note


BEHAVIOR_GUIDELINES_HEADER = "BEHAVIOR GUIDELINES:"


def compose_system_prompt_for_node(
    *,
    node: "Node",
    workflow: "WorkflowGraph",
    format_prompt: Callable[[str], str],
    has_recordings: bool,
    caller_profile_note: Optional[str] = None,
    behavior_instructions: Optional[list[str]] = None,
) -> str:
    """Compose the full system prompt text for a workflow node.

    Combines the global prompt, node-specific prompt, optional caller
    profile note (from voice-based gender detection), and (when recordings
    are enabled anywhere in the workflow) the recording response mode
    instructions into a single string.

    Args:
        node: The workflow node to compose the prompt for.
        workflow: The full workflow graph (needed for global node prompt).
        format_prompt: Callable to render template variables in prompts.
        has_recordings: Whether any node in the workflow uses recordings.
        caller_profile_note: Optional note about the caller (e.g. detected
            gender) appended to every node prompt once known.

    Returns:
        The composed system prompt text.
    """
    global_prompt = ""
    if workflow.global_node_id and node.add_global_prompt:
        global_node = workflow.nodes[workflow.global_node_id]
        global_prompt = format_prompt(global_node.prompt)

    formatted_node_prompt = format_prompt(node.prompt)

    parts = [p for p in (global_prompt, formatted_node_prompt) if p]

    if caller_profile_note:
        parts.append(caller_profile_note)

    if behavior_instructions:
        cleaned = [
            instr.strip() for instr in behavior_instructions if instr and instr.strip()
        ]
        if cleaned:
            bullets = "\n".join(f"- {instr}" for instr in cleaned)
            parts.append(f"{BEHAVIOR_GUIDELINES_HEADER}\n{bullets}")

    if has_recordings and "RECORDING_ID:" in formatted_node_prompt:
        parts.append(RECORDING_RESPONSE_MODE_INSTRUCTIONS)

    return "\n\n".join(parts)


async def compose_functions_for_node(
    *,
    node: "Node",
    custom_tool_manager: Optional["CustomToolManager"],
) -> list[dict]:
    """Compose the function/tool schemas for a workflow node.

    Gathers knowledge-base tools, custom tools (including built-in
    categories like calculator), and transition function schemas
    into a single list.

    Args:
        node: The workflow node to compose functions for.
        custom_tool_manager: Manager for custom and built-in tools (may be None).

    Returns:
        A list of function schemas to register with the LLM.
    """
    functions: list[dict] = []

    # Knowledge base retrieval tool
    if node.document_uuids:
        kb_tool_def = get_knowledge_base_tool(node.document_uuids)
        kb_schema = get_function_schema(
            kb_tool_def["function"]["name"],
            kb_tool_def["function"]["description"],
            properties=kb_tool_def["function"]["parameters"].get("properties", {}),
            required=kb_tool_def["function"]["parameters"].get("required", []),
        )
        functions.append(kb_schema)

    # Custom tools
    if node.tool_uuids and custom_tool_manager:
        custom_tool_schemas = await custom_tool_manager.get_tool_schemas(
            node.tool_uuids,
            mcp_tool_filters=getattr(node, "mcp_tool_filters", None),
        )
        functions.extend(custom_tool_schemas)

    # Transition function schemas
    for outgoing_edge in node.out_edges:
        function_schema = get_function_schema(
            outgoing_edge.get_function_name(), outgoing_edge.condition
        )
        functions.append(function_schema)

    return functions
