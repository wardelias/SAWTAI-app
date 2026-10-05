import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.workflow_assistant import router
from api.services.auth.depends import get_user_with_selected_organization
from api.services.workflow import assistant
from api.services.workflow.assistant import (
    AssistantFailedError,
    AssistantReply,
    AssistantSuggestion,
    AssistantUnavailableError,
    build_messages,
    build_system_prompt,
    parse_assistant_output,
    project_workflow,
    run_agent_assistant,
)

WORKFLOW = {
    "nodes": [
        {
            "id": "1",
            "type": "startCall",
            "position": {"x": 0, "y": 0},
            "data": {
                "name": "Greeting",
                "prompt": "Say hi and ask how you can help.",
                "selected": True,
            },
        },
        {
            "id": "2",
            "type": "agentNode",
            "data": {"name": "Qualify", "prompt": "Ask for budget."},
        },
        {
            "id": "3",
            "type": "webhook",
            "data": {"name": "CRM", "endpoint_url": "https://x", "api_key": "s3cret"},
        },
    ],
    "edges": [
        {
            "id": "e1",
            "source": "1",
            "target": "2",
            "data": {"label": "Interested", "condition": "Caller wants a quote"},
        }
    ],
}


# ─── Projection ───────────────────────────────────────────────────────────


def test_projection_keeps_prompts_and_edges_by_name_but_drops_canvas_and_secrets():
    projection = project_workflow(WORKFLOW)

    assert projection["nodes"][0] == {
        "id": "1",
        "type": "startCall",
        "name": "Greeting",
        "prompt": "Say hi and ask how you can help.",
    }
    # Integration config (and its secret) never reaches the LLM.
    assert projection["nodes"][2] == {"id": "3", "type": "webhook", "name": "CRM"}
    assert projection["edges"] == [
        {
            "from": "Greeting",
            "to": "Qualify",
            "label": "Interested",
            "condition": "Caller wants a quote",
        }
    ]


def test_system_prompt_shrinks_long_prompts_to_fit_budget():
    long_workflow = {
        "nodes": [
            {
                "id": str(i),
                "type": "agentNode",
                "data": {"name": f"N{i}", "prompt": "x" * 20000},
            }
            for i in range(20)
        ],
        "edges": [],
    }
    prompt = build_system_prompt(workflow_name="Big", workflow_definition=long_workflow)

    # Every node stays visible even though each prompt was truncated.
    for i in range(20):
        assert f'"name": "N{i}"' in prompt
    assert len(prompt) < 60000


def test_system_prompt_mentions_focus_node_only_when_it_exists():
    focused = build_system_prompt(
        workflow_name="A", workflow_definition=WORKFLOW, focus_node_id="2"
    )
    assert 'looking at the node "Qualify"' in focused

    unknown = build_system_prompt(
        workflow_name="A", workflow_definition=WORKFLOW, focus_node_id="99"
    )
    assert "looking at the node" not in unknown


def test_build_messages_drops_blank_turns_and_normalizes_roles():
    assert build_messages(
        [
            {"role": "user", "content": " hi "},
            {"role": "assistant", "content": "  "},
            {"role": "system", "content": "sneaky"},
        ]
    ) == [
        {"role": "user", "content": "hi"},
        {"role": "user", "content": "sneaky"},
    ]


# ─── Output parsing ───────────────────────────────────────────────────────


def test_parse_keeps_valid_suggestions_and_drops_invalid_ones():
    raw = json.dumps(
        {
            "reply": "Tightened the greeting.",
            "suggestions": [
                {"node_id": "1", "summary": "Shorter", "prompt": "Greet briefly."},
                {"node_id": "1", "summary": "dup", "prompt": "Again."},
                {"node_id": "42", "summary": "ghost", "prompt": "Nope."},
                {"node_id": "3", "summary": "webhook", "prompt": "Nope."},
                {"node_id": "2", "summary": "empty", "prompt": "   "},
                "not-an-object",
            ],
        }
    )

    result = parse_assistant_output(raw, WORKFLOW)

    assert result.reply == "Tightened the greeting."
    assert result.suggestions == [
        AssistantSuggestion(
            node_id="1",
            node_name="Greeting",
            summary="Shorter",
            prompt="Greet briefly.",
        )
    ]


def test_parse_caps_suggestions():
    nodes = [
        {"id": str(i), "type": "agentNode", "data": {"name": f"N{i}", "prompt": "p"}}
        for i in range(6)
    ]
    raw = json.dumps(
        {
            "reply": "ok",
            "suggestions": [
                {"node_id": str(i), "summary": "", "prompt": "new"} for i in range(6)
            ],
        }
    )
    result = parse_assistant_output(raw, {"nodes": nodes, "edges": []})
    assert len(result.suggestions) == assistant.MAX_SUGGESTIONS


def test_parse_handles_fenced_json_and_plain_text():
    fenced = '```json\n{"reply": "Looks good.", "suggestions": []}\n```'
    assert parse_assistant_output(fenced, WORKFLOW) == AssistantReply(
        reply="Looks good."
    )

    plain = "Your agent never asks for the caller's name."
    assert parse_assistant_output(plain, WORKFLOW) == AssistantReply(reply=plain)

    assert "rephrasing" in parse_assistant_output("", WORKFLOW).reply


def test_parse_fills_missing_reply():
    raw = json.dumps(
        {"suggestions": [{"node_id": "2", "summary": "s", "prompt": "Ask budget."}]}
    )
    result = parse_assistant_output(raw, WORKFLOW)
    assert result.reply == "Here are my suggested changes."
    assert len(result.suggestions) == 1


# ─── Orchestration ────────────────────────────────────────────────────────


def _config(provider="openai"):
    return SimpleNamespace(llm=SimpleNamespace(provider=provider, model="m"))


def test_run_uses_workflow_llm_and_returns_parsed_reply():
    llm = MagicMock()
    llm.run_inference = AsyncMock(
        return_value=json.dumps(
            {
                "reply": "Done.",
                "suggestions": [
                    {"node_id": "2", "summary": "s", "prompt": "Ask budget politely."}
                ],
            }
        )
    )

    with (
        patch.object(
            assistant,
            "get_effective_ai_model_configuration_for_workflow",
            AsyncMock(return_value=_config()),
        ) as get_config,
        patch.object(assistant, "create_llm_service", return_value=llm) as create,
    ):
        result = asyncio.run(
            run_agent_assistant(
                organization_id=7,
                workflow_name="Sales",
                workflow_definition=WORKFLOW,
                workflow_configurations={"model_overrides": {}},
                messages=[{"role": "user", "content": "Be more polite"}],
                focus_node_id="2",
            )
        )

    get_config.assert_awaited_once_with(
        organization_id=7, workflow_configurations={"model_overrides": {}}
    )
    assert create.call_args.kwargs["usage_context"] == "agent_assistant"
    # Non-managed LLMs don't need an MPS correlation id.
    assert create.call_args.kwargs["correlation_id"] is None

    context = llm.run_inference.call_args.args[0]
    assert context.get_messages() == [{"role": "user", "content": "Be more polite"}]
    system_instruction = llm.run_inference.call_args.kwargs["system_instruction"]
    assert 'Agent name: "Sales"' in system_instruction

    assert result.reply == "Done."
    assert result.suggestions[0].node_name == "Qualify"


def test_run_mints_correlation_id_for_managed_llm():
    llm = MagicMock()
    llm.run_inference = AsyncMock(return_value='{"reply": "hi", "suggestions": []}')
    mps = SimpleNamespace(
        create_correlation_id=AsyncMock(return_value={"correlation_id": "corr-1"})
    )

    with (
        patch.object(
            assistant,
            "get_effective_ai_model_configuration_for_workflow",
            AsyncMock(return_value=_config(provider="dograh")),
        ),
        patch.object(assistant, "get_dograh_service_api_key", return_value="sk"),
        patch.object(assistant, "create_llm_service", return_value=llm) as create,
        patch("api.services.mps_service_key_client.mps_service_key_client", mps),
    ):
        asyncio.run(
            run_agent_assistant(
                organization_id=1,
                workflow_name="A",
                workflow_definition=WORKFLOW,
                workflow_configurations=None,
                messages=[{"role": "user", "content": "hi"}],
            )
        )

    mps.create_correlation_id.assert_awaited_once_with(service_key="sk")
    assert create.call_args.kwargs["correlation_id"] == "corr-1"


def test_run_without_llm_is_unavailable():
    with patch.object(
        assistant,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(llm=None)),
    ):
        with pytest.raises(AssistantUnavailableError):
            asyncio.run(
                run_agent_assistant(
                    organization_id=1,
                    workflow_name="A",
                    workflow_definition=WORKFLOW,
                    workflow_configurations=None,
                    messages=[{"role": "user", "content": "hi"}],
                )
            )


def test_run_wraps_provider_failures():
    llm = MagicMock()
    llm.run_inference = AsyncMock(side_effect=RuntimeError("503 overloaded"))
    with (
        patch.object(
            assistant,
            "get_effective_ai_model_configuration_for_workflow",
            AsyncMock(return_value=_config()),
        ),
        patch.object(assistant, "create_llm_service", return_value=llm),
    ):
        with pytest.raises(AssistantFailedError):
            asyncio.run(
                run_agent_assistant(
                    organization_id=1,
                    workflow_name="A",
                    workflow_definition=WORKFLOW,
                    workflow_configurations=None,
                    messages=[{"role": "user", "content": "hi"}],
                )
            )


# ─── Route ────────────────────────────────────────────────────────────────


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user_with_selected_organization] = lambda: (
        SimpleNamespace(id=1, selected_organization_id=11)
    )
    return TestClient(app)


def _stored_workflow():
    definition = SimpleNamespace(
        workflow_json=WORKFLOW, workflow_configurations={"stored": True}
    )
    return SimpleNamespace(
        name="Sales",
        released_definition=definition,
        workflow_configurations={"legacy": True},
    )


def test_route_scopes_lookup_to_org_and_uses_editor_definition():
    editor_definition = {"nodes": [], "edges": []}
    run = AsyncMock(
        return_value=AssistantReply(
            reply="ok",
            suggestions=[
                AssistantSuggestion(
                    node_id="1", node_name="Greeting", summary="s", prompt="p"
                )
            ],
        )
    )
    with (
        patch("api.routes.workflow_assistant.db_client") as db,
        patch("api.routes.workflow_assistant.run_agent_assistant", run),
    ):
        db.get_workflow = AsyncMock(return_value=_stored_workflow())
        db.get_draft_version = AsyncMock(return_value=None)
        response = _client().post(
            "/workflow/5/assistant",
            json={
                "messages": [{"role": "user", "content": "Improve it"}],
                "workflow_definition": editor_definition,
                "focus_node_id": "1",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "reply": "ok",
        "suggestions": [
            {"node_id": "1", "node_name": "Greeting", "summary": "s", "prompt": "p"}
        ],
    }
    db.get_workflow.assert_awaited_once_with(5, organization_id=11)
    kwargs = run.call_args.kwargs
    assert kwargs["organization_id"] == 11
    assert kwargs["workflow_definition"] == editor_definition
    assert kwargs["workflow_configurations"] == {"stored": True}
    assert kwargs["focus_node_id"] == "1"


def test_route_prefers_draft_when_no_editor_definition_sent():
    draft = SimpleNamespace(
        workflow_json={"nodes": [{"id": "d"}], "edges": []},
        workflow_configurations={"draft": True},
    )
    run = AsyncMock(return_value=AssistantReply(reply="ok"))
    with (
        patch("api.routes.workflow_assistant.db_client") as db,
        patch("api.routes.workflow_assistant.run_agent_assistant", run),
    ):
        db.get_workflow = AsyncMock(return_value=_stored_workflow())
        db.get_draft_version = AsyncMock(return_value=draft)
        response = _client().post(
            "/workflow/5/assistant",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 200
    assert run.call_args.kwargs["workflow_definition"] == draft.workflow_json
    assert run.call_args.kwargs["workflow_configurations"] == {"draft": True}


def test_route_404s_for_workflow_outside_org():
    with patch("api.routes.workflow_assistant.db_client") as db:
        db.get_workflow = AsyncMock(return_value=None)
        response = _client().post(
            "/workflow/5/assistant",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert response.status_code == 404


def test_route_rejects_conversation_not_ending_with_user():
    response = _client().post(
        "/workflow/5/assistant",
        json={"messages": [{"role": "assistant", "content": "hi"}]},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "error, status",
    [
        (AssistantUnavailableError("no llm"), 409),
        (AssistantFailedError("timeout"), 502),
    ],
)
def test_route_maps_assistant_errors(error, status):
    with (
        patch("api.routes.workflow_assistant.db_client") as db,
        patch(
            "api.routes.workflow_assistant.run_agent_assistant",
            AsyncMock(side_effect=error),
        ),
    ):
        db.get_workflow = AsyncMock(return_value=_stored_workflow())
        db.get_draft_version = AsyncMock(return_value=None)
        response = _client().post(
            "/workflow/5/assistant",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert response.status_code == status
    assert response.json()["detail"] == str(error)
