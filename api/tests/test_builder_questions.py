"""Tests for the AI-written agent-builder interview: step normalization, the
request sent to a scripted Anthropic client, and the route."""

from __future__ import annotations

import copy
import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from anthropic.types.beta import BetaMessage
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.agent_copilot import router
from api.services.agent_copilot import builder_questions as builder_mod
from api.services.agent_copilot.builder_questions import (
    MAX_QUESTIONS,
    QUESTION_SCHEMA,
    BuilderAnswer,
    BuilderError,
    BuilderLimitError,
    BuilderStep,
    fallback_brief,
    next_builder_step,
    normalize_step,
)
from api.services.agent_copilot.settings import EffectiveSettings
from api.services.auth.depends import get_user

SETTINGS = EffectiveSettings(
    enabled=True,
    api_key="sk-ant-org",
    key_source="organization",
    model="claude-opus-5-5",
    effort="high",
    daily_message_limit=50,
)

ANSWERS = [
    BuilderAnswer("What's your business called?", "Haddad Real Estate"),
    BuilderAnswer("Which languages?", ""),
]


def _question(**overrides):
    data = {
        "done": False,
        "section": "Languages",
        "question": "Which languages do your callers speak?",
        "helper": "Pick every language, including the dialect.",
        "kind": "multi",
        "options": [
            {"label": "Arabic (Levantine)", "hint": ""},
            {"label": "Hebrew", "hint": "Most common in Haifa"},
            {"label": "English", "hint": ""},
        ],
        "allow_custom": True,
        "placeholder": "",
        "remaining": 4,
        "brief": "",
    }
    data.update(overrides)
    return data


# ─── Normalization ────────────────────────────────────────────────────────


def test_normalize_keeps_a_valid_question():
    step = normalize_step(_question(), must_finish=False, asked=2, fallback="fb")

    assert step == BuilderStep(
        done=False,
        remaining=4,
        section="Languages",
        question="Which languages do your callers speak?",
        helper="Pick every language, including the dialect.",
        kind="multi",
        options=[
            {"label": "Arabic (Levantine)", "hint": ""},
            {"label": "Hebrew", "hint": "Most common in Haifa"},
            {"label": "English", "hint": ""},
        ],
        allow_custom=True,
        placeholder="",
    )


def test_normalize_drops_blank_and_duplicate_options_and_caps_them():
    options = [{"label": " ", "hint": ""}, {"label": "Hebrew", "hint": ""}]
    options += [{"label": "hebrew", "hint": "dup"}]
    options += [{"label": f"Option {i}", "hint": ""} for i in range(12)]
    step = normalize_step(
        _question(options=options), must_finish=False, asked=0, fallback="fb"
    )

    assert step.options[0]["label"] == "Hebrew"
    assert len(step.options) == 8
    assert "hebrew" not in [o["label"] for o in step.options]


@pytest.mark.parametrize("kind", ["single", "multi", "rating"])
def test_choice_without_two_options_becomes_a_text_question(kind):
    step = normalize_step(
        _question(kind=kind, options=[{"label": "Only one", "hint": ""}]),
        must_finish=False,
        asked=0,
        fallback="fb",
    )
    assert step.kind == "text"
    assert step.options == []
    assert step.allow_custom is False


def test_remaining_is_bounded_by_the_question_cap():
    step = normalize_step(
        _question(remaining=50), must_finish=False, asked=MAX_QUESTIONS - 3, fallback=""
    )
    assert step.remaining == 2
    step = normalize_step(
        _question(remaining=-4), must_finish=False, asked=0, fallback=""
    )
    assert step.remaining == 0


def test_empty_question_is_an_error():
    with pytest.raises(BuilderError, match="empty"):
        normalize_step(
            _question(question="  "), must_finish=False, asked=0, fallback=""
        )


def test_done_returns_the_brief_or_falls_back():
    step = normalize_step(
        _question(done=True, brief=" Build an agent. "),
        must_finish=False,
        asked=3,
        fallback="fb",
    )
    assert step == BuilderStep(done=True, brief="Build an agent.")
    step = normalize_step(
        _question(done=True, brief=""), must_finish=False, asked=3, fallback="fb"
    )
    assert step.brief == "fb"


def test_must_finish_ends_the_interview_even_if_the_model_asks_more():
    step = normalize_step(_question(), must_finish=True, asked=10, fallback="fb")
    assert step == BuilderStep(done=True, brief="fb")


def test_fallback_brief_lists_answered_questions():
    brief = fallback_brief("outbound", "Lead qualification", "Book viewings.", ANSWERS)
    assert brief.split("\n") == [
        "Build a voice agent that places outbound calls to handle lead qualification.",
        "Book viewings.",
        "What's your business called? Haddad Real Estate",
    ]


# ─── Generation ───────────────────────────────────────────────────────────


def _message(text: str, stop_reason: str = "end_turn") -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": [{"type": "text", "text": text}],
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 100, "output_tokens": 50},
        }
    )


class _FakeStream:
    def __init__(self, final):
        self._final = final

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self._final


class _FakeClient:
    def __init__(self, final):
        self.requests: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))
        self._final = final

    def _stream(self, **kwargs):
        self.requests.append(copy.deepcopy(kwargs))
        return _FakeStream(self._final)


def _patches(client, consume=True):
    return (
        patch.object(builder_mod, "get_client", return_value=client),
        patch.object(
            builder_mod, "consume_daily_message", AsyncMock(return_value=consume)
        ),
    )


async def _step(answers=ANSWERS):
    return await next_builder_step(
        11,
        SETTINGS,
        call_type="outbound",
        use_case="Lead qualification",
        description="Book viewings.",
        answers=answers,
    )


async def test_sends_the_answers_and_returns_the_question():
    client = _FakeClient(_message(json.dumps(_question())))
    get_client_patch, consume_patch = _patches(client)
    with get_client_patch, consume_patch as consume_mock:
        step = await _step()

    consume_mock.assert_awaited_once_with(11, 50)
    request = client.requests[0]
    assert request["model"] == "claude-opus-5-5"
    # Each question is a small task, whatever effort the chat uses.
    assert request["output_config"] == {
        "effort": "low",
        "format": {"type": "json_schema", "schema": QUESTION_SCHEMA},
    }
    sent = json.loads(request["messages"][0]["content"])
    assert sent == {
        "call_type": "outbound",
        "job": "Lead qualification",
        "description": "Book viewings.",
        "answers": [
            {
                "question": "What's your business called?",
                "answer": "Haddad Real Estate",
            },
            {"question": "Which languages?", "answer": ""},
        ],
        "questions_asked": 2,
        "must_finish": False,
    }
    assert step.question == "Which languages do your callers speak?"
    assert step.kind == "multi"


async def test_tells_the_model_to_finish_at_the_question_cap():
    client = _FakeClient(_message(json.dumps(_question(done=True, brief="Spec."))))
    get_client_patch, consume_patch = _patches(client)
    answers = [BuilderAnswer(f"Q{i}", "A") for i in range(MAX_QUESTIONS)]
    with get_client_patch, consume_patch:
        step = await _step(answers)

    assert json.loads(client.requests[0]["messages"][0]["content"])["must_finish"]
    assert step == BuilderStep(done=True, brief="Spec.")


async def test_finish_now_asks_for_the_brief_early():
    client = _FakeClient(_message(json.dumps(_question(done=True, brief="Spec."))))
    get_client_patch, consume_patch = _patches(client)
    with get_client_patch, consume_patch:
        step = await next_builder_step(
            11,
            SETTINGS,
            call_type="inbound",
            use_case="Receptionist",
            description="",
            answers=ANSWERS,
            finish=True,
        )

    assert json.loads(client.requests[0]["messages"][0]["content"])["must_finish"]
    assert step == BuilderStep(done=True, brief="Spec.")


async def test_daily_limit_stops_before_the_model_call():
    client = _FakeClient(_message("{}"))
    get_client_patch, consume_patch = _patches(client, consume=False)
    with get_client_patch, consume_patch:
        with pytest.raises(BuilderLimitError):
            await _step()
    assert client.requests == []


@pytest.mark.parametrize(
    "final, message",
    [
        (_message("", "refusal"), "declined"),
        (_message('{"done": false', "max_tokens"), "too long"),
        (_message("not json"), "incomplete"),
    ],
)
async def test_bad_model_results_raise_readable_errors(final, message):
    get_client_patch, consume_patch = _patches(_FakeClient(final))
    with get_client_patch, consume_patch:
        with pytest.raises(BuilderError, match=message):
            await _step()


# ─── Route ────────────────────────────────────────────────────────────────


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=7, selected_organization_id=11
    )
    return app


BODY = {
    "call_type": "inbound",
    "use_case": "Receptionist",
    "answers": [{"question": "Business name?", "answer": "Clinic"}],
}


def _settings_patch(settings=SETTINGS):
    return patch(
        "api.routes.agent_copilot.get_effective_settings",
        AsyncMock(return_value=settings),
    )


def test_route_returns_the_next_question():
    step = normalize_step(_question(), must_finish=False, asked=1, fallback="")
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.next_builder_step", AsyncMock(return_value=step)
        ) as run,
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/builder/next-question", json=BODY
        )

    assert response.status_code == 200
    body = response.json()
    assert body["done"] is False
    assert body["brief"] == ""
    assert body["remaining"] == 4
    assert body["question"]["kind"] == "multi"
    assert body["question"]["options"][1] == {
        "label": "Hebrew",
        "hint": "Most common in Haifa",
    }
    kwargs = run.await_args.kwargs
    assert run.await_args.args[0] == 11
    assert kwargs["call_type"] == "inbound"
    assert kwargs["answers"] == [BuilderAnswer("Business name?", "Clinic")]
    assert kwargs["finish"] is False


def test_route_returns_the_brief_when_done():
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.next_builder_step",
            AsyncMock(return_value=BuilderStep(done=True, brief="Spec.")),
        ),
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/builder/next-question", json=BODY
        )
    assert response.json() == {
        "done": True,
        "question": None,
        "remaining": 0,
        "brief": "Spec.",
    }


@pytest.mark.parametrize(
    "error, status",
    [(BuilderLimitError("limit"), 429), (BuilderError("bad"), 502)],
)
def test_route_maps_errors(error, status):
    with (
        _settings_patch(),
        patch(
            "api.routes.agent_copilot.next_builder_step", AsyncMock(side_effect=error)
        ),
    ):
        response = TestClient(_app()).post(
            "/agent-copilot/builder/next-question", json=BODY
        )
    assert response.status_code == status


def test_route_requires_an_api_key():
    no_key = EffectiveSettings(
        enabled=True,
        api_key=None,
        key_source=None,
        model="claude-opus-5-5",
        effort="medium",
        daily_message_limit=0,
    )
    with _settings_patch(no_key):
        response = TestClient(_app()).post(
            "/agent-copilot/builder/next-question", json=BODY
        )
    assert response.status_code == 503


def test_route_rejects_too_many_answers():
    body = {**BODY, "answers": [{"question": "Q", "answer": "A"}] * (MAX_QUESTIONS + 1)}
    with _settings_patch():
        response = TestClient(_app()).post(
            "/agent-copilot/builder/next-question", json=body
        )
    assert response.status_code == 422
