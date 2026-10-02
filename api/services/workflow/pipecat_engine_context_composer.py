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
CALLER PROFILE — GENDER: {gender_upper}
The caller's voice indicates they are {gender}. When speaking a grammatically \
gendered language (such as Arabic or Hebrew), address the caller ONLY with \
{gender} second-person forms: pronouns, verb conjugations, imperatives, \
adjectives and participles. This applies to EVERYTHING you say, including \
scripted lines, example phrases and fixed wording given in the instructions \
above: keep their meaning, but change every word addressed to the caller to \
the {gender} form even if the script is written in another gender, and stop \
using any gender-neutral or plural address you used before. Words about \
yourself keep your own grammatical gender — only words addressed to the \
caller change. If the caller states or clearly implies a different gender, \
follow their lead instead of this note. Never mention this inference to the \
caller."""

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
(not "أساعدك"), "مَعَكِ", "شُكراً لكِ", "كيف حالُكِ", and "أنتِ".
- Prefer feminine verb forms whose letters already differ, so they read \
correctly even without diacritics: present tense adds ـِين ("تُريدِين", \
"تَستطيعِين"), the imperative adds ـي ("تفضّلي", "قولي"), and use the \
feminine pronoun ـكِ / أنتِ.
- Adjectives and participles describing the caller take ـة ("هل أنتِ \
مهتمة؟", "متأكدة", "جاهزة"); past-tense verbs addressed to her end in ـتِ \
("سجّلتِ", "قلتِ")."""

FEMALE_HEBREW_GUIDANCE = """
- Hebrew: use את (never אתה), feminine future and imperative forms ending in \
־י ("תרצי", "תוכלי", "תגידי", "חכי"), feminine participles ("את רוצה", \
"יכולה", "צריכה", "מעוניינת", "בטוחה"), and feminine suffixes (לָךְ, \
שֶׁלָּךְ, אוֹתָךְ, אִיתָּךְ, אֵלַיִךְ)."""

MALE_ARABIC_GUIDANCE = """
- Arabic: use masculine forms ("أنتَ", "تريد", "تفضّل", "هل أنتَ مهتم؟") and \
never feminine endings (ـكِ, ـين, ـي) when addressing the caller."""

MALE_HEBREW_GUIDANCE = """
- Hebrew: use אתה, masculine verbs ("תרצה", "תוכל", "תגיד"), masculine \
participles ("רוצה", "יכול", "צריך", "מעוניין"), and masculine suffixes \
(לְךָ, שֶׁלְּךָ, אוֹתְךָ)."""

# Before the caller's gender is known the agent would otherwise default to
# masculine address, which is wrong for every female caller's first turns.
CALLER_GENDER_PENDING_NOTE = """\
CALLER PROFILE — GENDER: NOT YET KNOWN
The caller's gender has not been determined yet. Until this note is replaced, \
when speaking a grammatically gendered language, avoid gender-marked \
second-person forms wherever a natural alternative exists — including in \
scripted lines and fixed wording above (keep their meaning, adjust only the \
gendered words):
- Arabic: use the respectful plural address, which suits both men and women \
("كيف أقدر أساعدكم؟", "تفضلوا", "هل أنتم مهتمون؟", "حضرتكم").
- Hebrew: use impersonal or infinitive phrasing ("אפשר לשאול...?", \
"מה מתאים?", "רציתי לבדוק אם זה רלוונטי") instead of אתה/את.
Do not mention this to the caller."""


def build_caller_profile_note(gender: str, language: Optional[str] = None) -> str:
    """Build the caller-profile system-prompt note for a detected gender.

    Female callers get explicit Arabic pronunciation guidance so the TTS voice
    actually speaks feminine forms (see ``FEMALE_PRONUNCIATION_GUIDANCE``) plus
    the Hebrew feminine forms; male callers get a short reminder of the
    masculine forms. ``language`` ("arabic" / "hebrew") limits the guidance to
    that language; anything else includes both.
    """
    note = CALLER_PROFILE_NOTE_TEMPLATE.format(
        gender=gender, gender_upper=gender.upper()
    )
    lang = (language or "").strip().lower()
    if gender == "female":
        arabic, hebrew = FEMALE_PRONUNCIATION_GUIDANCE, FEMALE_HEBREW_GUIDANCE
    elif gender == "male":
        arabic, hebrew = MALE_ARABIC_GUIDANCE, MALE_HEBREW_GUIDANCE
    else:
        return note
    if lang != "hebrew":
        note += arabic
    if lang != "arabic":
        note += hebrew
    return note


def build_caller_gender_pending_note() -> str:
    """Note used while voice gender detection is running or was inconclusive."""
    return CALLER_GENDER_PENDING_NOTE


BEHAVIOR_GUIDELINES_HEADER = "BEHAVIOR GUIDELINES:"


# ---------------------------------------------------------------------------
# Agent language directive
# ---------------------------------------------------------------------------
#
# An agent can be pinned to a single spoken language. The stored prompts and
# behaviors are instructions written for the model (usually in English); this
# directive forces the model to *conduct the conversation* in the chosen
# language regardless of the language the instructions are written in. It is
# placed first in the composed prompt so it takes precedence.
#
# ``None`` / unset / "english" leaves the default behavior unchanged for
# existing workflows. The directive is intentionally phrased in both English
# (so it's understood alongside the rest of the prompt) and the target language
# (so it anchors strongly for non-Latin scripts).

LANGUAGE_DIRECTIVES: dict[str, str] = {
    "arabic": (
        "LANGUAGE: Conduct this entire conversation in Arabic (العربية). "
        "Every spoken response — the greeting, questions, confirmations, and "
        "everything else — must be in natural, conversational Arabic, no "
        "matter what language the instructions below are written in. Do not "
        "switch to another language unless the caller explicitly asks you to. "
        "تحدّث بالعربية طوال المكالمة."
    ),
    "hebrew": (
        "LANGUAGE: Conduct this entire conversation in Hebrew (עברית). "
        "Every spoken response — the greeting, questions, confirmations, and "
        "everything else — must be in natural, conversational Hebrew, no "
        "matter what language the instructions below are written in. Do not "
        "switch to another language unless the caller explicitly asks you to. "
        "דבר/י בעברית לאורך כל השיחה."
    ),
    "english": (
        "LANGUAGE: Conduct this entire conversation in English. Every spoken "
        "response — the greeting, questions, confirmations, and everything "
        "else — must be in natural, conversational English. Do not switch to "
        "another language unless the caller explicitly asks you to."
    ),
}


def build_language_directive(language: Optional[str]) -> Optional[str]:
    """Return the system-prompt directive for an agent language, or None.

    ``language`` is matched case-insensitively against ``LANGUAGE_DIRECTIVES``.
    Unknown or empty values return ``None`` (no directive injected).
    """
    if not language:
        return None
    return LANGUAGE_DIRECTIVES.get(language.strip().lower())


def compose_system_prompt_for_node(
    *,
    node: "Node",
    workflow: "WorkflowGraph",
    format_prompt: Callable[[str], str],
    has_recordings: bool,
    caller_profile_note: Optional[str] = None,
    behavior_instructions: Optional[list[str]] = None,
    language: Optional[str] = None,
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
        language: Optional agent language ("arabic", "hebrew", "english").
            When set, a directive forcing that spoken language is placed first.

    Returns:
        The composed system prompt text.
    """
    global_prompt = ""
    if workflow.global_node_id and node.add_global_prompt:
        global_node = workflow.nodes[workflow.global_node_id]
        global_prompt = format_prompt(global_node.prompt)

    formatted_node_prompt = format_prompt(node.prompt)

    parts: list[str] = []

    language_directive = build_language_directive(language)
    if language_directive:
        parts.append(language_directive)

    parts += [p for p in (global_prompt, formatted_node_prompt) if p]

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
