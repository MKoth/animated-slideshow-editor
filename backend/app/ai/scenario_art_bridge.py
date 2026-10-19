"""Scenario art-pipeline bridge (issue #466).

Pure seam mapping scenario markdown visuals into the existing
Generation Workflow inputs without changing that workflow:

- `reuse` references resolve against Asset Definition names by exact
  (trimmed, case-insensitive) match — no fuzzy scoring, no new ranking.
- `> Brief:` texts flow into the existing Prompt Variant shape
  (Detailed / Concise / Stylized) reusing the Generation Workflow style
  profile, production constraints, and provider note verbatim from
  `reconciliations.py`.
- Generation Workflow, Style Profile, Prompt Variant, and Metadata
  Assistant flows are otherwise unchanged: this module mints no images,
  makes no model calls, and writes no library rows. It only shapes the
  bridge inputs downstream reconciliation / generation UI consume.

No I/O, no DB access — tested at the pure seam.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from app.ai.reconciliations import (
    CHARACTER_CONSTRAINT_HINT,
    DEFAULT_STYLE_PROFILE,
    PRODUCTION_CONSTRAINT_BLOCK,
    PROVIDER_NOTE,
)


def normalize_brief_key(alt: str) -> str:
    """Machine key mirroring the free-text visual alt.

    Mirrors `frontend/src/engine/scenarioMarkdown.ts#normalizeAssetKey`:
    trim, collapse whitespace, lowercase, spaces to hyphens.
    """
    return re.sub(r"\s+", " ", (alt or "").strip()).lower().replace(" ", "-")


def _clean(value: object) -> str:
    return str(value or "").strip()


def resolve_reuse_against_definitions(
    visuals: list[dict[str, Any]],
    definitions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Resolve each visual's `reuse` against Asset Definition names.

    Exact (trimmed, case-insensitive) name match only. Reuse names stay
    internal and never render into the chalk page. Visuals without a reuse
    reference are skipped (they flow to briefs, not here).

    Returns `{matched, missing}` where each entry carries
    `{key, alt, reuse, definitionId?, definitionName?}`.
    """
    by_name: dict[str, dict[str, Any]] = {}
    for definition in definitions:
        if not isinstance(definition, dict):
            continue
        name = _clean(definition.get("name", ""))
        if not name:
            continue
        lowered = name.lower()
        if lowered not in by_name:
            by_name[lowered] = definition

    matched: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for visual in visuals:
        if not isinstance(visual, dict):
            continue
        reuse = _clean(visual.get("reuse", ""))
        if not reuse:
            continue
        key = _clean(visual.get("key", "")) or normalize_brief_key(_clean(visual.get("alt", "")))
        alt = _clean(visual.get("alt", ""))
        hit = by_name.get(reuse.lower())
        if hit is not None:
            matched.append(
                {
                    "key": key,
                    "alt": alt,
                    "reuse": reuse,
                    "definitionId": str(hit.get("id", "")),
                    "definitionName": _clean(hit.get("name", "")),
                }
            )
        else:
            missing.append(
                {
                    "key": key,
                    "alt": alt,
                    "reuse": reuse,
                    "reason": "no asset definition with that name",
                }
            )
    return {"matched": matched, "missing": missing}


def briefs_from_scenario_visuals(
    visuals: list[dict[str, Any]],
    style_profile: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Seed Generation Workflow Prompt Variants from scenario visual briefs.

    Only visuals carrying a non-empty `brief` and no `reuse` reference
    produce a brief: reuse visuals already bind to library art and need no
    generation. Visuals with neither brief nor reuse produce nothing here
    (they warn in the markdown parser, never block).

    Output mirrors `reconciliations.draft_image_brief`: same
    `styleProfile` / `productionConstraints` / `providerNote` constants,
    same `{detailed, concise, stylized}` variant keys, same `wizardEntry`
    shape feeding the Generation Workflow wizard + copyable prompt.
    """
    style = dict(style_profile) if style_profile else dict(DEFAULT_STYLE_PROFILE)
    style_name = style.get("name", DEFAULT_STYLE_PROFILE["name"])
    suffix = style.get("promptSuffix", DEFAULT_STYLE_PROFILE["promptSuffix"])
    description = style.get("description", DEFAULT_STYLE_PROFILE["description"])
    _ = description

    out: list[dict[str, Any]] = []
    for visual in visuals:
        if not isinstance(visual, dict):
            continue
        if _clean(visual.get("reuse", "")):
            continue
        brief = _clean(visual.get("brief", ""))
        if not brief:
            continue
        alt = _clean(visual.get("alt", ""))
        key = _clean(visual.get("key", "")) or normalize_brief_key(alt)
        step = visual.get("step")
        try:
            step_num = int(step) if step is not None else 0
        except (TypeError, ValueError):
            step_num = 0
        step_label = f"Step {step_num}" if step_num > 0 else "Step ?"
        subject = alt or key
        constraints = PRODUCTION_CONSTRAINT_BLOCK
        if "cat" in subject.lower() or "character" in subject.lower():
            constraints = f"{constraints} {CHARACTER_CONSTRAINT_HINT}"
        detailed = (
            f"Create a single {subject} for a children's language lesson "
            f"({style_name}: {suffix}). Visual brief: {brief}. {step_label}."
            f" {constraints}"
        )
        concise = f"{subject}, {style_name} style, {brief}"
        stylized = f"{subject} in {style_name} ({suffix}), centered single object, no text"
        note = f"{step_label}: {subject} — {brief}"
        brief_id = str(uuid4())
        out.append(
            {
                "id": brief_id,
                "stepId": f"step-{step_num}" if step_num > 0 else "step-?",
                "hint": key,
                "name": subject,
                "note": note,
                "styleProfile": dict(style),
                "productionConstraints": constraints,
                "providerNote": PROVIDER_NOTE,
                "variants": {"detailed": detailed, "concise": concise, "stylized": stylized},
                "prompt": detailed,
                "editable": True,
                "wizardEntry": {
                    "assetName": subject,
                    "note": note,
                    "styleProfile": dict(style),
                    "productionConstraints": constraints,
                    "providerNote": PROVIDER_NOTE,
                },
            }
        )
    return out
