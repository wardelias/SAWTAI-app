"""Built-in Behavior presets.

A Behavior is a tool (``ToolCategory.BEHAVIOR``) that injects curated
instructions into the agent's system prompt instead of registering a callable
function. These presets are ready-made templates surfaced in the UI library;
"using" one creates a behavior tool pre-filled from the preset (and the user
can then edit the instructions).

Most presets are pure instruction text. A preset may also be ``special``,
meaning it toggles a runtime capability in addition to (or instead of)
injecting text — e.g. ``voice_gender_detection`` turns on the voice-based
caller gender detector, which then injects its own dynamic, confidence-gated
note at runtime.
"""

from dataclasses import asdict, dataclass
from typing import Optional


@dataclass(frozen=True)
class BehaviorPreset:
    """A ready-made behavior template shown in the UI library."""

    id: str
    name: str
    description: str
    icon: str  # lucide-react icon name
    icon_color: str  # hex
    instructions: str
    special: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


BEHAVIOR_PRESETS: list[BehaviorPreset] = [
    BehaviorPreset(
        id="caller_gender_adaptation",
        name="Caller Gender Adaptation",
        description=(
            "Detect the caller's gender from their voice and adapt gendered "
            "language (Arabic, Hebrew, ...) accordingly."
        ),
        icon="users",
        icon_color="#3B82F6",
        instructions=(
            "When the caller's gender is known, address them using the matching "
            "gendered second-person forms (verb conjugations, pronouns, "
            "adjectives) in grammatically gendered languages such as Arabic or "
            "Hebrew. If the caller states or implies a different gender, follow "
            "their lead. Never mention this inference to the caller."
        ),
        special="voice_gender_detection",
    ),
    BehaviorPreset(
        id="no_ai_disclosure",
        name="Stay in Character",
        description="Never claim or imply that the agent is an AI or a bot.",
        icon="user-round",
        icon_color="#6B7280",
        instructions=(
            "Stay in character as a human representative. Do not claim or imply "
            "that you are an AI, bot, or automated system. If asked directly "
            "whether you are a robot, deflect politely and continue helping."
        ),
    ),
    BehaviorPreset(
        id="concise_voice_replies",
        name="Concise Voice Replies",
        description="Keep answers short and spoken-style; no markdown or lists.",
        icon="message-square",
        icon_color="#10B981",
        instructions=(
            "Keep replies short and conversational — usually one or two spoken "
            "sentences. Do not use markdown, bullet points, numbered lists, or "
            "emojis; your words are spoken aloud."
        ),
    ),
    BehaviorPreset(
        id="confirm_readback",
        name="Confirm by Read-back",
        description="Read back names, emails, and numbers to confirm them.",
        icon="check-check",
        icon_color="#F59E0B",
        instructions=(
            "When the caller gives a name, email address, phone number, or other "
            "identifier, read it back to them to confirm before relying on it."
        ),
    ),
    BehaviorPreset(
        id="empathetic_tone",
        name="Empathetic Tone",
        description="Warm, patient, acknowledges the caller's feelings.",
        icon="heart",
        icon_color="#EC4899",
        instructions=(
            "Speak warmly and patiently. Acknowledge the caller's feelings and "
            "show that you understand their situation before moving the "
            "conversation forward."
        ),
    ),
    BehaviorPreset(
        id="confirm_before_end_or_transfer",
        name="Confirm Before Ending",
        description="Check the caller is ready before ending or transferring.",
        icon="shield-check",
        icon_color="#8B5CF6",
        instructions=(
            "Before ending the call or transferring it, briefly confirm with the "
            "caller that they are ready and have no other questions."
        ),
    ),
    BehaviorPreset(
        id="mirror_caller_language",
        name="Mirror Caller's Language",
        description="Respond in the caller's language and dialect.",
        icon="languages",
        icon_color="#06B6D4",
        instructions=(
            "Respond in the same language and dialect the caller uses. If they "
            "switch languages mid-conversation, switch with them."
        ),
    ),
    BehaviorPreset(
        id="dnc_compliance",
        name="Honor Opt-outs",
        description="Immediately respect do-not-call / opt-out requests.",
        icon="shield-ban",
        icon_color="#EF4444",
        instructions=(
            "If the caller asks to opt out, stop being contacted, or be placed on "
            "a do-not-call list, acknowledge immediately, stop any sales or "
            "persuasion, and confirm they will not be contacted again."
        ),
    ),
]

PRESETS_BY_ID: dict[str, BehaviorPreset] = {p.id: p for p in BEHAVIOR_PRESETS}


def get_preset(preset_id: str) -> Optional[BehaviorPreset]:
    return PRESETS_BY_ID.get(preset_id)
