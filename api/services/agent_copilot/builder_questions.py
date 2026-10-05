"""AI-written questions for the agent builder.

The "Create Voice Agent" page interviews the user before an agent is
built. After the call direction and the agent's job, each next question is
written by Claude from everything answered so far, so the interview adapts
to the business (a clinic gets asked about appointment types, a real-estate
agency about areas and budgets). Once it knows enough, Claude writes the
brief the agent is generated from.

Stateless: the browser sends the questions and answers so far on every
request, and each request writes one question (or the final brief).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

import anthropic
from api.services.agent_copilot.client import (
    api_error_detail,
    api_error_message,
    get_client,
    remember_compat_request,
    uses_compat_request,
)
from api.services.agent_copilot.history import consume_daily_message
from api.services.agent_copilot.settings import EffectiveSettings
from loguru import logger

# AI-written questions per interview; the last request must finish.
MAX_QUESTIONS = 10
MAX_OPTIONS = 8
_MAX_TOKENS = 8_000
# Writing one question is a small task: keep each step quick.
_EFFORT = "low"

QuestionKind = Literal["single", "multi", "text"]

QUESTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "done": {"type": "boolean"},
        "section": {"type": "string"},
        "question": {"type": "string"},
        "helper": {"type": "string"},
        "kind": {"type": "string", "enum": ["single", "multi", "text"]},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "hint": {"type": "string"},
                },
                "required": ["label", "hint"],
                "additionalProperties": False,
            },
        },
        "allow_custom": {"type": "boolean"},
        "placeholder": {"type": "string"},
        "remaining": {"type": "integer"},
        "brief": {"type": "string"},
    },
    "required": [
        "done",
        "section",
        "question",
        "helper",
        "kind",
        "options",
        "allow_custom",
        "placeholder",
        "remaining",
        "brief",
    ],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = f"""\
You interview a business owner to design an AI phone agent for them. You ask one question at a time; after the interview an agent is generated from the brief you write.

The user message is JSON: whether the agent answers calls (inbound) or places them (outbound), its job, an optional description, and the questions you already asked with the owner's answers (an empty answer means they skipped it).

Each turn, either ask the single most useful next question, or finish.

Asking (done = false):
- Ask about the most important thing you don't know yet that changes how the agent should behave. Never re-ask something already answered, and build on earlier answers (refer to their business, industry, and offer by name).
- Over the interview, cover what this kind of agent needs, for example: the business and what it offers; who the callers are; languages and dialect; the agent's name, voice, and tone; how it should open the call; what it must find out or qualify, and the exact questions it must ask; how to handle common objections or questions; how a successful call ends (book a meeting, transfer, take a message); when to hand over to a person or end the call; facts it must know (hours, prices, address, policies); things it must never say or do. Skip what doesn't apply to this job.
- section: a 1-3 word label for the topic, e.g. "Languages".
- question: plain, friendly, under 90 characters.
- helper: one short sentence on why it matters or what a good answer looks like.
- Prefer kind "single" (one choice) or "multi" (several) with 3-6 options written for this specific business, each with a short hint (under 50 characters) or "" if the label says it all. Use "text" for open answers such as names, prices, opening hours, or exact wording, and give a concrete placeholder example. Set allow_custom true for choices when the owner might need their own answer.
- remaining: your best estimate of how many more questions you need after this one.
- brief: "".

Finishing (done = true): when you know enough to build a good agent (usually after 5-8 questions), or when the message says "must_finish": true.
- brief: a complete, specific spec for the agent written as instructions, in English, as plain sentences or short lines: who it is and who it works for, the call direction and goal, languages, persona and tone, the opening, what to find out (with the exact questions to ask), how to handle objections and questions, how a successful call ends, hand-off and ending rules, the facts it must know, and what it must never do. Use everything the owner told you; don't invent facts, prices, or names they didn't give. Quote exact phrases they gave in their own language.
- Set question, helper, section, placeholder to "", options to [], remaining to 0.

Write questions and options in the language the owner writes their answers in (English if unclear). Never mention prompts, nodes, models, or JSON. You may ask at most {MAX_QUESTIONS} questions in total.
"""


class BuilderError(Exception):
    """The next question couldn't be written; the message is user-facing."""


class BuilderLimitError(BuilderError):
    """The organization's daily AI Assistant allowance is used up."""


@dataclass
class BuilderAnswer:
    question: str
    answer: str


@dataclass
class BuilderStep:
    done: bool
    brief: str = ""
    remaining: int = 0
    section: str = ""
    question: str = ""
    helper: str = ""
    kind: QuestionKind = "text"
    options: list[dict[str, str]] = field(default_factory=list)
    allow_custom: bool = False
    placeholder: str = ""


def fallback_brief(
    call_type: str, use_case: str, description: str, answers: list[BuilderAnswer]
) -> str:
    """A brief made straight from the answers, for when Claude doesn't write one."""
    direction = (
        "places outbound calls" if call_type == "outbound" else "answers inbound calls"
    )
    lines = [
        f"Build a voice agent that {direction} to handle {use_case.strip().lower()}."
    ]
    if description.strip():
        lines.append(description.strip())
    for a in answers:
        if a.answer.strip():
            lines.append(f"{a.question.strip()} {a.answer.strip()}")
    return "\n".join(lines)


def normalize_step(
    data: dict[str, Any],
    *,
    must_finish: bool,
    asked: int,
    fallback: str,
) -> BuilderStep:
    """Validate the model's output into a step the UI can always render."""
    done = bool(data.get("done")) or must_finish
    if done:
        brief = str(data.get("brief") or "").strip()
        return BuilderStep(done=True, brief=brief or fallback)

    question = str(data.get("question") or "").strip()
    if not question:
        raise BuilderError("The next question came back empty. Please try again.")

    options: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in data.get("options") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label or label.lower() in seen:
            continue
        seen.add(label.lower())
        options.append(
            {"label": label[:120], "hint": str(item.get("hint") or "").strip()[:120]}
        )
        if len(options) == MAX_OPTIONS:
            break

    kind = data.get("kind")
    if kind not in ("single", "multi", "text"):
        kind = "text"
    if kind != "text" and len(options) < 2:
        # A choice with fewer than two options can't be answered by tapping.
        kind = "text"
    if kind == "text":
        options = []

    remaining = data.get("remaining")
    remaining = remaining if isinstance(remaining, int) else 3
    # The question being asked now counts toward the cap.
    remaining = max(0, min(remaining, MAX_QUESTIONS - asked - 1))

    return BuilderStep(
        done=False,
        remaining=remaining,
        section=str(data.get("section") or "").strip()[:40],
        question=question[:300],
        helper=str(data.get("helper") or "").strip()[:300],
        kind=kind,
        options=options,
        allow_custom=bool(data.get("allow_custom")) if kind != "text" else False,
        placeholder=str(data.get("placeholder") or "").strip()[:200],
    )


async def next_builder_step(
    organization_id: int,
    settings: EffectiveSettings,
    *,
    call_type: str,
    use_case: str,
    description: str,
    answers: list[BuilderAnswer],
    finish: bool = False,
) -> BuilderStep:
    """Write the next interview question, or the final brief.

    Caller checks that the assistant is available. Counts one message
    against the organization's daily AI Assistant allowance. Raises
    BuilderError (or BuilderLimitError) with a readable message.
    """
    # The user can stop early ("Finish now"); the cap always ends it.
    must_finish = finish or len(answers) >= MAX_QUESTIONS
    fallback = fallback_brief(call_type, use_case, description, answers)

    if not await consume_daily_message(organization_id, settings.daily_message_limit):
        raise BuilderLimitError(
            "Your organization has reached today's AI Assistant limit. It resets at midnight UTC."
        )

    body = json.dumps(
        {
            "call_type": call_type,
            "job": use_case,
            "description": description,
            "answers": [{"question": a.question, "answer": a.answer} for a in answers],
            "questions_asked": len(answers),
            "must_finish": must_finish,
        },
        ensure_ascii=False,
    )
    assert settings.api_key is not None, "caller checks settings.available"
    client = get_client(settings.api_key)

    async def request(compat: bool) -> Any:
        # Compat mode drops the beta-gated refusal fallback for accounts or
        # models that reject it (see runner._request_options).
        extra = (
            {}
            if compat
            else {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        )
        async with client.beta.messages.stream(
            model=settings.model,
            max_tokens=_MAX_TOKENS,
            output_config={
                "effort": _EFFORT,
                "format": {"type": "json_schema", "schema": QUESTION_SCHEMA},
            },
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": body}],
            **extra,
        ) as stream:
            return await stream.get_final_message()

    compat = uses_compat_request(settings.api_key, settings.model)
    try:
        try:
            response = await request(compat)
        except anthropic.BadRequestError as e:
            if compat:
                raise
            logger.warning(
                f"builder question request rejected (org {organization_id}, model "
                f"{settings.model}): {api_error_detail(e)}; retrying without "
                "optional features"
            )
            response = await request(True)
            remember_compat_request(settings.api_key, settings.model)
    except anthropic.APIError as e:
        logger.warning(f"builder question API error (org {organization_id}): {e}")
        raise BuilderError(api_error_message(e, settings.model))

    if response.stop_reason == "refusal":
        raise BuilderError("The assistant declined to continue this interview.")
    if response.stop_reason == "max_tokens":
        raise BuilderError("The assistant's answer ran too long. Please try again.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning(f"builder question returned non-JSON for org {organization_id}")
        raise BuilderError("The next question came back incomplete. Please try again.")

    logger.info(
        f"builder question org={organization_id} model={response.model} "
        f"asked={len(answers)} done={data.get('done')} "
        f"in={response.usage.input_tokens} out={response.usage.output_tokens}"
    )
    return normalize_step(
        data, must_finish=must_finish, asked=len(answers), fallback=fallback
    )
