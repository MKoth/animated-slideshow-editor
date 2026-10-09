# ruff: noqa: BLE001, TRY004, SIM102
"""Action Scenario generation helpers: JSON schema, validation, edit preservation.

Stage A (issue #423, spec R27-R29): slide-agnostic ordered steps with
intro/middle/outro tags, verbatim spoken lines, on-screen actions, bare asset
hints (names only), and rough non-binding durations.
"""

from __future__ import annotations

import json
from typing import Any

from app.ai.schemas import AiScenarioContent

SCENARIO_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["title", "steps"],
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "steps": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": [
                    "partTag",
                    "spokenLine",
                    "onScreenAction",
                    "estimatedDurationSec",
                ],
                "properties": {
                    "partTag": {"type": "string", "enum": ["intro", "middle", "outro"]},
                    "spokenLine": {"type": "string"},
                    "onScreenAction": {"type": "string"},
                    "assetHints": {"type": "array", "items": {"type": "string"}},
                    "estimatedDurationSec": {"type": "number"},
                },
            },
        },
    },
}

# Refs that must never ride a scenario step: resolution belongs to Stage B.
# Bare asset hints are names only.
_FORBIDDEN_STEP_KEYS = frozenset(
    {
        "definitionId",
        "definition",
        "clipName",
        "clip",
        "material",
        "shader",
        "cameraRig",
        "camera",
        "script",
    }
)


def parse_and_validate_scenario(data: Any) -> AiScenarioContent:
    """Validate raw Zen JSON into a typed scenario. Raises ValueError on shape errors."""
    if not isinstance(data, dict):
        raise ValueError("scenario must be a JSON object")
    steps = data.get("steps")
    if isinstance(steps, list):
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            forbidden = _FORBIDDEN_STEP_KEYS.intersection(step.keys())
            if forbidden:
                names = ", ".join(sorted(forbidden))
                raise ValueError(
                    f"scenario step #{index} must carry bare asset hints only "
                    f"(no definition/clip/material/shader refs): found {names}"
                )
            hints = step.get("assetHints", [])
            if hints is not None and not isinstance(hints, list):
                raise ValueError(f"scenario step #{index}: assetHints must be a list of names")
            if isinstance(hints, list):
                for hint in hints:
                    if not isinstance(hint, str) or not hint.strip():
                        raise ValueError(
                            f"scenario step #{index}: assetHints must be non-empty names"
                        )
    try:
        return AiScenarioContent.model_validate(data)
    except Exception as exc:
        raise ValueError(f"invalid action scenario shape: {exc}") from exc


def build_scenario_user_text(
    request_text: str,
    *,
    prior_scenario: dict[str, Any] | None = None,
    user_edits: dict[str, Any] | None = None,
) -> str:
    """Revision prompts carry prior scenario + user edits as context (R29)."""
    parts = [request_text.strip()]
    if prior_scenario:
        try:
            parts.append("Prior scenario (JSON):\n" + json.dumps(prior_scenario)[:6000])
        except Exception:
            parts.append("Prior scenario: (unserializable)")
    if user_edits:
        try:
            encoded = json.dumps(user_edits)
        except Exception:
            encoded = str(user_edits)
        if encoded and encoded != "{}":
            parts.append(
                "Author edits to preserve unless this request explicitly changes them "
                f"(JSON):\n{encoded[:4000]}\nKeep prior accepted content unless the user requests a change."
            )
    return "\n\n".join(p for p in parts if p)


def _mentions(haystack: str, *needles: str) -> bool:
    lowered = haystack.lower()
    return any(n in lowered for n in needles)


def apply_scenario_edits_preservation(
    generated: dict[str, Any],
    user_edits: dict[str, Any],
    request_text: str,
) -> dict[str, Any]:
    """Overlay stored author edits onto a fresh scenario generation.

    Top-level title / description survive unless the new request explicitly
    mentions that field. Step spoken lines / actions / hints / durations /
    part tags survive by spoken-line/index matching under the same rule, and an
    explicit user reorder survives when the step count is unchanged.
    """
    if not user_edits:
        return generated
    merged: dict[str, Any] = json.loads(json.dumps(generated))

    if isinstance(user_edits.get("title"), str) and user_edits["title"].strip():
        if not _mentions(request_text, "title", "retitle", "rename"):
            merged["title"] = user_edits["title"]
    if isinstance(user_edits.get("description"), str) and user_edits["description"].strip():
        if not _mentions(request_text, "description"):
            merged["description"] = user_edits["description"]

    step_fields = user_edits.get("stepFields")
    new_steps = merged.get("steps")
    if isinstance(step_fields, dict) and isinstance(new_steps, list) and new_steps:
        old_order = user_edits.get("stepOrder")
        old_ids: list[str] = list(step_fields.keys())
        old_index: dict[str, int] = {}
        if isinstance(old_order, list):
            for idx, sid in enumerate(old_order):
                if isinstance(sid, str):
                    old_index[sid] = idx
        for idx, sid in enumerate(old_ids):
            old_index.setdefault(sid, idx)
        for override_id, override in step_fields.items():
            if not isinstance(override, dict):
                continue
            target: dict[str, Any] | None = None
            override_line = (
                override.get("spokenLine") if isinstance(override.get("spokenLine"), str) else None
            )
            old_line = (
                override.get("_oldSpokenLine")
                if isinstance(override.get("_oldSpokenLine"), str)
                else None
            )
            for cand in new_steps:
                if not isinstance(cand, dict):
                    continue
                if old_line and cand.get("spokenLine") == old_line:
                    target = cand
                    break
                if override_line and cand.get("spokenLine") == override_line:
                    target = cand
                    break
            if target is None and override_id in old_index:
                idx = old_index[override_id]
                if 0 <= idx < len(new_steps) and isinstance(new_steps[idx], dict):
                    target = new_steps[idx]
            if target is None:
                continue
            if isinstance(override.get("spokenLine"), str) and override["spokenLine"].strip():
                if not _mentions(request_text, "spoken", "narration", "line", "say"):
                    target["spokenLine"] = override["spokenLine"]
            if (
                isinstance(override.get("onScreenAction"), str)
                and override["onScreenAction"].strip()
            ):
                if not _mentions(request_text, "action", "visual", "screen", "show"):
                    target["onScreenAction"] = override["onScreenAction"]
            if isinstance(override.get("partTag"), str) and override["partTag"] in (
                "intro",
                "middle",
                "outro",
            ):
                if not _mentions(request_text, "part", "tag", "intro", "middle", "outro"):
                    target["partTag"] = override["partTag"]
            if isinstance(override.get("assetHints"), list):
                if not _mentions(request_text, "hint", "asset", "prop"):
                    target["assetHints"] = override["assetHints"]
            if isinstance(override.get("estimatedDurationSec"), (int, float)):
                if not _mentions(request_text, "duration"):
                    target["estimatedDurationSec"] = override["estimatedDurationSec"]

        # Preserve an explicit user reorder when the step count is unchanged
        # and the request does not ask for a reorder.
        user_order = user_edits.get("stepOrder")
        if (
            isinstance(user_order, list)
            and len(user_order) == len(new_steps)
            and not _mentions(request_text, "order", "reorder", "swap", "move step")
        ):
            by_old_index: list[dict[str, Any]] = []
            for old_id in user_order:
                if not isinstance(old_id, str) or old_id not in old_index:
                    by_old_index = []
                    break
                pos = old_index[old_id]
                by_old_index.append(new_steps[pos] if 0 <= pos < len(new_steps) else {})
            if len(by_old_index) == len(new_steps) and all(
                isinstance(s, dict) for s in by_old_index
            ):
                natural = sorted(old_index.values())
                current_positions = [old_index.get(sid, -1) for sid in user_order]
                if current_positions != natural:
                    merged["steps"] = by_old_index

    return merged
