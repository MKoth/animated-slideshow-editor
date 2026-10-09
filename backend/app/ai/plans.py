# ruff: noqa: BLE001, TRY004, SIM102
"""Lesson Plan generation helpers: JSON schema, validation, edit preservation."""

from __future__ import annotations

import json
from typing import Any

from app.ai.schemas import AiPlanContent

PLAN_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["title", "slides"],
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "language": {"type": "string"},
        "estimatedDurationSec": {"type": "number"},
        "learningObjective": {"type": "string"},
        "teachingStrategy": {"type": "string"},
        "slides": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": [
                    "title",
                    "goal",
                    "estimatedDurationSec",
                    "explanation",
                    "suggestedNarration",
                ],
                "properties": {
                    "title": {"type": "string"},
                    "goal": {"type": "string"},
                    "estimatedDurationSec": {"type": "number"},
                    "explanation": {"type": "string"},
                    "suggestedNarration": {"type": "string"},
                    "requiredAssets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["name", "classification"],
                            "properties": {
                                "name": {"type": "string"},
                                "classification": {
                                    "type": "string",
                                    "enum": ["existing", "missing", "optional"],
                                },
                                "definitionId": {"type": ["string", "null"]},
                            },
                        },
                    },
                    "recommendedMaterials": {"type": "array", "items": {"type": "string"}},
                    "recommendedShaders": {"type": "array", "items": {"type": "string"}},
                    "recommendedClips": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


def parse_and_validate_plan(data: Any) -> AiPlanContent:
    """Validate raw Zen JSON into a typed plan. Raises ValueError on shape errors."""
    if not isinstance(data, dict):
        raise ValueError("plan must be a JSON object")
    try:
        return AiPlanContent.model_validate(data)
    except Exception as exc:
        raise ValueError(f"invalid lesson plan shape: {exc}") from exc


def build_plan_user_text(
    request_text: str,
    *,
    prior_plan: dict[str, Any] | None = None,
    user_edits: dict[str, Any] | None = None,
) -> str:
    """Revision prompts carry prior plan + user edits as context (R24)."""
    parts = [request_text.strip()]
    if prior_plan:
        try:
            parts.append("Prior plan (JSON):\n" + json.dumps(prior_plan)[:6000])
        except Exception:
            parts.append("Prior plan: (unserializable)")
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


def apply_user_edits_preservation(
    generated: dict[str, Any],
    user_edits: dict[str, Any],
    request_text: str,
) -> dict[str, Any]:
    """Overlay stored author edits onto a fresh generation.

    Top-level title / teachingStrategy / description survive unless the new
    request explicitly mentions that field. Slide duration / order /
    descriptions survive by index/title matching under the same rule.
    """
    if not user_edits:
        return generated
    merged: dict[str, Any] = json.loads(json.dumps(generated))

    if isinstance(user_edits.get("title"), str) and user_edits["title"].strip():
        if not _mentions(request_text, "title", "retitle", "rename lesson"):
            merged["title"] = user_edits["title"]
    if (
        isinstance(user_edits.get("teachingStrategy"), str)
        and user_edits["teachingStrategy"].strip()
    ):
        if not _mentions(request_text, "strategy", "teaching", "pedagogy"):
            merged["teachingStrategy"] = user_edits["teachingStrategy"]
    if isinstance(user_edits.get("description"), str) and user_edits["description"].strip():
        if not _mentions(request_text, "description"):
            merged["description"] = user_edits["description"]
    if isinstance(user_edits.get("language"), str) and user_edits["language"].strip():
        if not _mentions(request_text, "language"):
            merged["language"] = user_edits["language"]
    if (
        isinstance(user_edits.get("learningObjective"), str)
        and user_edits["learningObjective"].strip()
    ):
        if not _mentions(request_text, "objective", "goal"):
            merged["learningObjective"] = user_edits["learningObjective"]

    slide_fields = user_edits.get("slideFields")
    new_slides = merged.get("slides")
    if isinstance(slide_fields, dict) and isinstance(new_slides, list) and new_slides:
        # Old order list maps old ids to their pre-revision index.
        old_order = user_edits.get("slideOrder")
        old_ids: list[str] = list(slide_fields.keys())
        old_index: dict[str, int] = {}
        if isinstance(old_order, list):
            for idx, sid in enumerate(old_order):
                if isinstance(sid, str):
                    old_index[sid] = idx
        # Fallback order from dict insertion order.
        for idx, sid in enumerate(old_ids):
            old_index.setdefault(sid, idx)
        for override_id, override in slide_fields.items():
            if not isinstance(override, dict):
                continue
            target: dict[str, Any] | None = None
            # Prefer title match (stable across id reassignment), else index match.
            override_title = (
                override.get("title") if isinstance(override.get("title"), str) else None
            )
            old_title = (
                override.get("_oldTitle") if isinstance(override.get("_oldTitle"), str) else None
            )
            for cand in new_slides:
                if not isinstance(cand, dict):
                    continue
                if old_title and cand.get("title") == old_title:
                    target = cand
                    break
                if override_title and cand.get("title") == override_title:
                    target = cand
                    break
            if target is None and override_id in old_index:
                idx = old_index[override_id]
                if 0 <= idx < len(new_slides) and isinstance(new_slides[idx], dict):
                    target = new_slides[idx]
            if target is None:
                continue
            for field in ("title", "goal", "explanation", "suggestedNarration"):
                value = override.get(field)
                if isinstance(value, str) and value.strip():
                    keyword = {
                        "title": ("title",),
                        "goal": ("goal",),
                        "explanation": ("description", "explanation"),
                        "suggestedNarration": ("narration",),
                    }[field]
                    if not _mentions(request_text, *keyword):
                        target[field] = value
            if isinstance(override.get("estimatedDurationSec"), (int, float)):
                if not _mentions(request_text, "duration"):
                    target["estimatedDurationSec"] = override["estimatedDurationSec"]

        # Preserve an explicit user reorder when the slide count is unchanged
        # and the request does not ask for a reorder.
        user_order = user_edits.get("slideOrder")
        if (
            isinstance(user_order, list)
            and len(user_order) == len(new_slides)
            and not _mentions(request_text, "order", "reorder", "swap", "move slide")
        ):
            # Map old index -> new slide by title/index, then emit in user order.
            by_old_index: list[dict[str, Any]] = []
            for old_id in user_order:
                if not isinstance(old_id, str) or old_id not in old_index:
                    by_old_index = []
                    break
                # Find the new slide that corresponds to this old position.
                pos = old_index[old_id]
                # The new generation may have reordered; match by old title when known.
                by_old_index.append(new_slides[pos] if 0 <= pos < len(new_slides) else {})
            if len(by_old_index) == len(new_slides) and all(
                isinstance(s, dict) for s in by_old_index
            ):
                # Only reorder when the user order differs from natural order.
                natural = sorted(old_index.values())
                current_positions = [old_index.get(sid, -1) for sid in user_order]
                if current_positions != natural:
                    merged["slides"] = by_old_index

    return merged
