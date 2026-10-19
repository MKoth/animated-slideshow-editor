"""Scenario art-pipeline bridge (issue #466): pure seam tests."""

from __future__ import annotations

from typing import Any

from app.ai import scenario_art_bridge as bridge
from app.ai.reconciliations import (
    DEFAULT_STYLE_PROFILE,
    PRODUCTION_CONSTRAINT_BLOCK,
    PROVIDER_NOTE,
)


def test_normalize_brief_key_mirrors_frontend() -> None:
    assert bridge.normalize_brief_key("  Young  Doctor Smiling ") == "young-doctor-smiling"
    assert bridge.normalize_brief_key("Clock") == "clock"
    assert bridge.normalize_brief_key("") == ""


def test_reuse_resolves_by_exact_name_case_insensitive() -> None:
    visuals: list[dict[str, Any]] = [
        {"key": "cat", "alt": "Cat", "reuse": "Blackboard Cat"},
        {"key": "dog", "alt": "Dog", "reuse": "  blackboard cat  "},
        {"key": "ghost", "alt": "Ghost", "reuse": "No Such Asset"},
        {"key": "brief-only", "alt": "Brief Only", "brief": "A brief"},
    ]
    definitions: list[dict[str, Any]] = [{"id": "d-1", "name": "Blackboard Cat"}]
    result = bridge.resolve_reuse_against_definitions(visuals, definitions)
    assert len(result["matched"]) == 2
    assert {m["key"] for m in result["matched"]} == {"cat", "dog"}
    assert result["matched"][0]["definitionId"] == "d-1"
    assert result["matched"][0]["definitionName"] == "Blackboard Cat"
    # Reuse visuals without a library match are reported, not scored.
    assert len(result["missing"]) == 1
    assert result["missing"][0]["reuse"] == "No Such Asset"
    # Visuals without reuse are skipped entirely.
    assert all(m["key"] != "brief-only" for m in result["matched"])
    assert all(m["key"] != "brief-only" for m in result["missing"])


def test_reuse_ignores_fuzzy_matches() -> None:
    visuals: list[dict[str, Any]] = [{"key": "chalk-text", "alt": "Chalk Text", "reuse": "chalk"}]
    definitions: list[dict[str, Any]] = [{"id": "d-1", "name": "chalkboard"}]
    result = bridge.resolve_reuse_against_definitions(visuals, definitions)
    assert result["matched"] == []
    assert len(result["missing"]) == 1


def test_briefs_flow_into_prompt_variant_shape() -> None:
    visuals: list[dict[str, Any]] = [
        {
            "key": "young-doctor-smiling",
            "alt": "Young Doctor Smiling",
            "brief": "Warm smile, arms open.",
            "step": 2,
        },
        # Reuse visuals need no generation.
        {"key": "cat", "alt": "Cat", "reuse": "Blackboard Cat", "brief": "Should be ignored."},
        # Neither brief nor reuse produces nothing.
        {"key": "empty", "alt": "Empty"},
    ]
    briefs = bridge.briefs_from_scenario_visuals(visuals)
    assert len(briefs) == 1
    brief = briefs[0]
    assert brief["hint"] == "young-doctor-smiling"
    assert brief["name"] == "Young Doctor Smiling"
    assert brief["stepId"] == "step-2"
    assert brief["editable"] is True
    # Generation Workflow shape is reused verbatim.
    assert brief["styleProfile"] == DEFAULT_STYLE_PROFILE
    assert brief["productionConstraints"] == PRODUCTION_CONSTRAINT_BLOCK
    assert brief["providerNote"] == PROVIDER_NOTE
    assert set(brief["variants"].keys()) == {"detailed", "concise", "stylized"}
    assert "Warm smile" in brief["prompt"]
    assert "Young Doctor Smiling" in brief["prompt"]
    assert brief["wizardEntry"]["assetName"] == "Young Doctor Smiling"
    assert brief["wizardEntry"]["styleProfile"] == DEFAULT_STYLE_PROFILE


def test_briefs_respect_style_profile_without_changing_workflow() -> None:
    visuals: list[dict[str, Any]] = [
        {"key": "sun", "alt": "Sun", "brief": "Bright sun.", "step": 1}
    ]
    style = {"name": "Watercolor", "description": "Soft", "promptSuffix": "watercolor wash"}
    briefs = bridge.briefs_from_scenario_visuals(visuals, style_profile=style)
    assert briefs[0]["styleProfile"] == style
    assert "Watercolor" in briefs[0]["prompt"]
    # No image bytes, no model call: pure shaping only.
    assert "id" in briefs[0] and briefs[0]["id"]
