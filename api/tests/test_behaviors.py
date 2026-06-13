"""Tests for Behavior tools (instruction-injecting tools).

Covers the three behaviors of the feature:
- ``extract_behaviors`` splits behavior tools into instructions + specials.
- ``compose_system_prompt_for_node`` appends behavior instructions under a
  header and omits the section when there are none.
- Behavior-category tools are skipped during LLM function-schema building.
- The built-in preset catalog is well-formed (gender preset is special).
"""

import asyncio
from types import SimpleNamespace

from api.enums import ToolCategory
from api.services.workflow.behaviors.presets import BEHAVIOR_PRESETS, get_preset
from api.services.workflow.behaviors.resolver import extract_behaviors
from api.services.workflow.pipecat_engine_context_composer import (
    BEHAVIOR_GUIDELINES_HEADER,
    compose_system_prompt_for_node,
)


def _behavior_tool(instructions="", special=None, category=ToolCategory.BEHAVIOR.value):
    return SimpleNamespace(
        category=category,
        tool_uuid="t-1",
        name="b",
        definition={"config": {"instructions": instructions, "special": special}},
    )


# ---------------------------------------------------------------------------
# extract_behaviors
# ---------------------------------------------------------------------------


class TestExtractBehaviors:
    def test_collects_instructions_and_specials(self):
        tools = [
            _behavior_tool("Be concise."),
            _behavior_tool("Adapt gender.", special="voice_gender_detection"),
        ]
        instructions, specials = extract_behaviors(tools)
        assert instructions == ["Be concise.", "Adapt gender."]
        assert specials == {"voice_gender_detection"}

    def test_ignores_non_behavior_tools(self):
        tools = [_behavior_tool("X", category=ToolCategory.HTTP_API.value)]
        instructions, specials = extract_behaviors(tools)
        assert instructions == []
        assert specials == set()

    def test_skips_empty_instructions(self):
        instructions, specials = extract_behaviors([_behavior_tool("   ")])
        assert instructions == []


# ---------------------------------------------------------------------------
# compose_system_prompt_for_node
# ---------------------------------------------------------------------------


def _node_and_workflow():
    node = SimpleNamespace(prompt="You are a helpful agent.", add_global_prompt=False)
    workflow = SimpleNamespace(global_node_id=None, nodes={})
    return node, workflow


class TestComposeBehaviorInstructions:
    def test_appends_under_header(self):
        node, workflow = _node_and_workflow()
        prompt = compose_system_prompt_for_node(
            node=node,
            workflow=workflow,
            format_prompt=lambda s: s,
            has_recordings=False,
            behavior_instructions=["Keep replies short.", "Stay in character."],
        )
        assert BEHAVIOR_GUIDELINES_HEADER in prompt
        assert "- Keep replies short." in prompt
        assert "- Stay in character." in prompt

    def test_no_header_when_empty(self):
        node, workflow = _node_and_workflow()
        prompt = compose_system_prompt_for_node(
            node=node,
            workflow=workflow,
            format_prompt=lambda s: s,
            has_recordings=False,
            behavior_instructions=["   ", ""],
        )
        assert BEHAVIOR_GUIDELINES_HEADER not in prompt

    def test_omitted_by_default(self):
        node, workflow = _node_and_workflow()
        prompt = compose_system_prompt_for_node(
            node=node,
            workflow=workflow,
            format_prompt=lambda s: s,
            has_recordings=False,
        )
        assert BEHAVIOR_GUIDELINES_HEADER not in prompt


# ---------------------------------------------------------------------------
# Behaviors are skipped during function-schema building
# ---------------------------------------------------------------------------


class _StubEngine:
    _mcp_sessions: dict = {}

    async def _get_organization_id(self):
        return 1


class TestBehaviorsSkippedForFunctions:
    def test_no_function_schema_for_behavior(self, monkeypatch):
        from api.services.workflow import pipecat_engine_custom_tools as ct

        async def fake_get(uuids, org_id):
            return [_behavior_tool("Be concise.")]

        monkeypatch.setattr(ct.db_client, "get_tools_by_uuids", fake_get)
        manager = ct.CustomToolManager(_StubEngine())

        schemas = asyncio.run(manager.get_tool_schemas(["t-1"]))
        assert schemas == []

        instructions = asyncio.run(manager.get_behavior_instructions(["t-1"]))
        assert instructions == ["Be concise."]


# ---------------------------------------------------------------------------
# Preset catalog
# ---------------------------------------------------------------------------


class TestPresetCatalog:
    def test_ids_unique_and_instructions_present(self):
        ids = [p.id for p in BEHAVIOR_PRESETS]
        assert len(ids) == len(set(ids))
        for preset in BEHAVIOR_PRESETS:
            assert preset.name and preset.description
            assert preset.instructions.strip()

    def test_gender_preset_is_special(self):
        preset = get_preset("caller_gender_adaptation")
        assert preset is not None
        assert preset.special == "voice_gender_detection"
