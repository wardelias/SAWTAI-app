"""Resolve Behavior tools into prompt instructions and runtime specials.

Shared by ``run_pipeline`` (global behaviors from
``workflow_configurations.behaviors``) and the engine (node-level behaviors
attached via ``node.tool_uuids``).
"""

from __future__ import annotations

from typing import Any, Iterable

from api.enums import ToolCategory


def extract_behaviors(tools: Iterable[Any]) -> tuple[list[str], set[str]]:
    """Split behavior-category tools into (instructions, specials).

    Args:
        tools: ToolModel rows (non-behavior tools are ignored).

    Returns:
        ``(instructions, specials)`` where ``instructions`` is the list of
        non-empty instruction strings and ``specials`` is the set of runtime
        capability flags (e.g. ``"voice_gender_detection"``).
    """
    instructions: list[str] = []
    specials: set[str] = set()
    for tool in tools:
        if getattr(tool, "category", None) != ToolCategory.BEHAVIOR.value:
            continue
        config = ((getattr(tool, "definition", None) or {}).get("config", {})) or {}
        text = (config.get("instructions") or "").strip()
        if text:
            instructions.append(text)
        special = config.get("special")
        if special:
            specials.add(special)
    return instructions, specials
