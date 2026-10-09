"""Stage B reconciliation helpers: Discovery-Run scoring reuse, motion verdicts, sound, briefs.

Implements issue #424 (Spec 12 build Stage B) against the resolution on #412:
middle-tagged steps only, Discovery Run floor 0.35 with accept/reject/replace,
4-state motion verdicts citing clip/param/script-verb evidence from the live
Context Snapshot, sfx/music-only sound reconciliation (narration untouched),
and auto-drafted editable provider-agnostic image-gen briefs feeding the
Generation Workflow wizard entry + copyable prompt.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

# Same absolute matched floor as Spec 13 Step 25 R3.
DISCOVERY_MATCH_FLOOR = 0.35

# Animation Script reveal/mark/wipe verbs.
SCRIPT_VERBS: tuple[str, ...] = ("reveal", "mark", "wipe")

# Animatable surface from frontend/src/engine/animationProperties.ts plus
# clip/morph/shadow lanes the manager surfaces.
ANIMATABLE_PARAMS: tuple[str, ...] = (
    "positionX",
    "positionY",
    "rotation",
    "scaleX",
    "scaleY",
    "opacity",
    "radius",
    "startAngle",
    "endAngle",
    "segments",
    "borderRadius",
    "padding",
    "morphCoefficient",
    "tint",
)

MOTION_STATES: tuple[str, ...] = (
    "feasible",
    "feasible-with-substitution",
    "needs-new-asset",
    "needs-new-motion",
)

DEFAULT_STYLE_PROFILE: dict[str, str] = {
    "name": "Educational Illustration",
    "description": "Clear flat educational art for language lessons",
    "promptSuffix": "flat educational illustration, bold shapes, high contrast",
}

PRODUCTION_CONSTRAINT_BLOCK = (
    "Production constraints: transparent background preferred, centered, "
    "single object, no text, no watermark, high resolution, no perspective."
)

CHARACTER_CONSTRAINT_HINT = "Characters: front-facing, full body."

PROVIDER_NOTE = (
    "Provider-agnostic: use any general image generation tool "
    "(character illustration / icon generation). The editor never generates "
    "images itself — copy the prompt to an external tool, import the artwork "
    "through the standard upload, then prepare it in the Asset Playground."
)

_SOUND_KEYWORDS: tuple[str, ...] = (
    "sfx",
    "sound",
    "music",
    "jingle",
    "chime",
    "ding",
    "whoosh",
    "tick",
    "tock",
    "pop sound",
    "applause",
    "fanfare",
    "sting",
    "background music",
    "effect sound",
)

# on-screen-action keyword -> (evidence clip name fragment, evidence kind)
_ACTION_CLIP_HINTS: tuple[tuple[str, str], ...] = (
    ("fade in", "Fade In"),
    ("appear", "Fade In"),
    ("reveal", "reveal"),
    ("fade out", "Fade Out"),
    ("disappear", "Disappear"),
    ("wipe", "wipe"),
    ("pop", "Pop"),
    ("bounce", "Bounce"),
    ("jump", "Jump"),
    ("shake", "Shake"),
    ("wobble", "Wobble"),
    ("float", "Float"),
    ("pulse", "Pulse"),
    ("blink", "Blink"),
    ("slide", "Slide Left"),
    ("move", "Slide Left"),
    ("pan", "Slide Left"),
    ("scale", "Scale Up"),
    ("grow", "Scale Up"),
    ("shrink", "Scale Down"),
    ("zoom", "Scale Up"),
    ("rotate", "Rotate"),
    ("spin", "Rotate"),
    ("wave", "Wave"),
    ("point", "Point"),
    ("tick", "Clock Tick"),
    ("clock", "Clock Tick"),
    ("chalk", "Fade In"),
    ("write", "Fade In"),
    ("draw", "Fade In"),
    ("text", "reveal"),
    ("table", "reveal"),
    ("board", "reveal"),
    ("mark", "mark"),
    ("highlight", "Pulse"),
    ("show", "Fade In"),
)


def _tokens(text: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if t}


def score_hint_against_definition(hint: str, definition: dict[str, Any]) -> tuple[float, str]:
    """Weighted Discovery-Run-style similarity for one hint x definition pair.

    Signals (Spec 13 R3): name substring (exact-name boost to 1.0), tags
    overlap, category compatibility, AI-description token hits. Normalized to
    [0, 1]; the matched floor lives in DISCOVERY_MATCH_FLOOR.
    """
    hint_clean = hint.strip()
    if not hint_clean:
        return 0.0, "empty hint"
    name = str(definition.get("name", ""))
    hint_lower = hint_clean.lower()
    name_lower = name.lower()
    if hint_lower == name_lower and hint_lower:
        return 1.0, f"exact name match '{name}'"

    hint_tokens = _tokens(hint_clean)
    name_tokens = _tokens(name)
    name_hit = 0.0
    if hint_lower in name_lower or name_lower in hint_lower:
        name_hit = 1.0
    elif hint_tokens and name_tokens:
        for ht in hint_tokens:
            for nt in name_tokens:
                if ht in nt or nt in ht:
                    name_hit = 1.0
                    break
            if name_hit:
                break

    tags = definition.get("tags", [])
    tag_tokens: set[str] = set()
    if isinstance(tags, list):
        for tag in tags:
            if isinstance(tag, str):
                tag_tokens.update(_tokens(tag))
    hint_tokens = _tokens(hint_clean)
    tags_hit = 0.0
    shared_tag = ""
    if hint_tokens and tag_tokens:
        shared = hint_tokens.intersection(tag_tokens)
        if not shared:
            # Substring fallback: tag 'chalk' matches hint token 'chalkboard' etc.
            for ht in hint_tokens:
                for tt in tag_tokens:
                    if ht in tt or tt in ht:
                        shared = {tt}
                        break
                if shared:
                    break
        if shared:
            tags_hit = 1.0
            shared_tag = min(shared)

    category = str(definition.get("category", ""))
    category_hit = 0.0
    if category and (category.lower() in hint_lower or hint_lower in category.lower()):
        category_hit = 1.0

    ai_desc = str(definition.get("ai_description", "") or definition.get("aiDescription", ""))
    desc_hit = 0.0
    if hint_tokens and ai_desc.strip():
        desc_tokens = _tokens(ai_desc)
        overlap = hint_tokens.intersection(desc_tokens)
        if not overlap:
            for ht in hint_tokens:
                for dt in desc_tokens:
                    if ht in dt or dt in ht:
                        overlap = {ht}
                        break
                if overlap:
                    break
        if overlap:
            desc_hit = 1.0

    # Server-side weights: any single strong signal (name/tags/desc) clears
    # the 0.35 floor; category alone informs but never matches by itself.
    score = 0.45 * name_hit + 0.35 * tags_hit + 0.1 * category_hit + 0.25 * desc_hit
    score = max(0.0, min(1.0, score))

    parts: list[str] = []
    if name_hit:
        parts.append(f"name matches '{name}'")
    if tags_hit and shared_tag:
        parts.append(f"tag '{shared_tag}' shared")
    if category_hit and category:
        parts.append(f"category {category} compatible")
    if desc_hit:
        parts.append("AI description matches")
    if not parts:
        return score, "no signal matched"
    return score, "; ".join(parts)


def reconcile_hint(hint: str, definitions: list[dict[str, Any]]) -> dict[str, Any]:
    """One hint -> matched/missing verdict with ranked candidates + alternatives."""
    scored: list[dict[str, Any]] = []
    for definition in definitions:
        if not isinstance(definition, dict):
            continue
        def_id = str(definition.get("id", ""))
        if not def_id:
            continue
        score, explanation = score_hint_against_definition(hint, definition)
        scored.append(
            {
                "definitionId": def_id,
                "name": str(definition.get("name", "")),
                "score": round(score, 4),
                "explanation": explanation,
            }
        )
    scored.sort(key=lambda c: (-c["score"], c["name"]))
    candidates = [c for c in scored if c["score"] >= DISCOVERY_MATCH_FLOOR]
    alternatives = [c for c in scored if c["score"] < DISCOVERY_MATCH_FLOOR]
    return {
        "hint": hint,
        "verdict": "matched" if candidates else "missing",
        "candidates": candidates,
        "alternatives": alternatives,
    }


def is_sound_hint(hint: str, audio_names: list[str] | None = None) -> bool:
    """True when a bare hint reads as sfx/music (never narration)."""
    lowered = hint.strip().lower()
    if not lowered:
        return False
    if any(keyword in lowered for keyword in _SOUND_KEYWORDS):
        return True
    if audio_names:
        for name in audio_names:
            if lowered in name.lower() or name.lower() in lowered:
                return True
    return False


def _available_clip_names(motion_surface: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for key in ("clips", "clipNames", "libraryClips", "builtinClips"):
        value = motion_surface.get(key)
        if isinstance(value, list):
            for entry in value:
                if isinstance(entry, str) and entry.strip():
                    names.append(entry.strip())
                elif isinstance(entry, dict) and isinstance(entry.get("name"), str):
                    names.append(entry["name"].strip())
    # Built-ins are always part of the animatable surface even when the
    # snapshot omits them (seeded server-side at startup).
    from app.clips.model import BUILTIN_CLIP_NAMES

    for builtin in BUILTIN_CLIP_NAMES:
        if builtin not in names:
            names.append(builtin)
    return names


def _available_collections(motion_surface: dict[str, Any]) -> list[str]:
    out: list[str] = []
    value = motion_surface.get("clipCollections", motion_surface.get("collections", []))
    if isinstance(value, list):
        for entry in value:
            if isinstance(entry, str) and entry.strip():
                out.append(entry.strip())
            elif isinstance(entry, dict):
                name = entry.get("name")
                if isinstance(name, str) and name.strip():
                    out.append(name.strip())
                bindings = entry.get("bindings")
                if isinstance(bindings, dict):
                    for key in bindings:
                        if isinstance(key, str) and key.strip():
                            out.append(key.strip())
    return out


def motion_verdict_for_step(
    on_screen_action: str,
    asset_verdicts: list[dict[str, Any]],
    motion_surface: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Per middle step, one 4-state motion verdict with cited evidence."""
    surface = motion_surface or {}
    missing = [v for v in asset_verdicts if v.get("verdict") == "missing"]
    if missing:
        names = ", ".join(f"'{v.get('hint', '')}'" for v in missing)
        return {
            "state": "needs-new-asset",
            "explanation": f"missing asset {names} — create artwork before motion can be staged",
            "evidence": {
                "kind": "missing-asset",
                "missingHints": [v.get("hint", "") for v in missing],
            },
        }

    action = (on_screen_action or "").strip()
    action_lower = action.lower()
    clip_names = _available_clip_names(surface)
    clip_lower = [c.lower() for c in clip_names]
    collections = _available_collections(surface)
    animatable = list(surface.get("animatableParams", list(ANIMATABLE_PARAMS)))
    verbs = list(surface.get("scriptVerbs", list(SCRIPT_VERBS)))

    # Direct clip/collection hit on the action text.
    for clip in clip_names:
        if clip.lower() in action_lower and clip.lower():
            return {
                "state": "feasible",
                "explanation": f"'{action}' covered by clip '{clip}'",
                "evidence": {"kind": "clip", "clip": clip},
            }
    for collection in collections:
        if collection.lower() in action_lower and collection.lower():
            return {
                "state": "feasible",
                "explanation": f"'{action}' covered by Clip Collection '{collection}'",
                "evidence": {"kind": "collection", "collection": collection},
            }

    # Keyword-mapped evidence against the live surface.
    for keyword, clip_hint in _ACTION_CLIP_HINTS:
        if keyword not in action_lower:
            continue
        if any(clip_hint.lower() == c for c in clip_lower):
            return {
                "state": "feasible",
                "explanation": f"'{action}' feasible with clip '{clip_hint}'",
                "evidence": {"kind": "clip", "clip": clip_hint},
            }
        if clip_hint in verbs:
            return {
                "state": "feasible",
                "explanation": f"'{action}' feasible with Animation Script verb '{clip_hint}'",
                "evidence": {"kind": "script-verb", "verb": clip_hint},
            }
        # Substitution: the beat is stageable with a neighbouring clip/param.
        if "opacity" in animatable and keyword in (
            "appear",
            "show",
            "chalk",
            "write",
            "draw",
            "text",
            "board",
            "reveal",
            "fade in",
        ):
            return {
                "state": "feasible-with-substitution",
                "explanation": (
                    f"'{action}' stageable with substitution: Fade In + opacity "
                    f"(no exact '{clip_hint}' match on this project)"
                ),
                "evidence": {"kind": "params", "params": ["opacity"]},
            }
        return {
            "state": "needs-new-motion",
            "explanation": (
                f"'{action}' needs new motion: no '{clip_hint}' clip, Clip Collection, "
                "animatable param, or reveal/mark/wipe verb on this project covers it"
            ),
            "evidence": {"kind": "none", "wanted": clip_hint},
        }

    # Generic board/text beats degrade to script verbs + opacity.
    if "reveal" in verbs and any(
        word in action_lower for word in ("text", "board", "chalk", "table", "sentence")
    ):
        return {
            "state": "feasible",
            "explanation": f"'{action}' feasible with Animation Script reveal + opacity",
            "evidence": {"kind": "script-verb", "verb": "reveal", "params": ["opacity"]},
        }

    return {
        "state": "needs-new-motion",
        "explanation": (
            f"'{action}' has no covering clip, Clip Collection, animatable param, "
            "or reveal/mark/wipe verb on this project"
        ),
        "evidence": {"kind": "none"},
    }


def draft_image_brief(
    *,
    step_id: str,
    hint: str,
    spoken_line: str,
    on_screen_action: str,
    style_profile: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Auto-drafted, editable, provider-agnostic image-gen brief for one missing hint."""
    style = dict(style_profile) if style_profile else dict(DEFAULT_STYLE_PROFILE)
    style_name = style.get("name", DEFAULT_STYLE_PROFILE["name"])
    suffix = style.get("promptSuffix", DEFAULT_STYLE_PROFILE["promptSuffix"])
    note = f'Spoken: "{spoken_line.strip()}" / On-screen: {on_screen_action.strip()}'
    constraints = PRODUCTION_CONSTRAINT_BLOCK
    if "cat" in hint.lower() or "character" in hint.lower():
        constraints = f"{constraints} {CHARACTER_CONSTRAINT_HINT}"
    detailed = (
        f"Create a single {hint} for a children's language lesson ({style_name}: {suffix}). "
        f'Scene: {on_screen_action.strip()}. Narration: "{spoken_line.strip()}". '
        f"{constraints}"
    )
    concise = f"{hint}, {style_name} style, {on_screen_action.strip()}"
    stylized = f"{hint} in {style_name} ({suffix}), centered single object, no text"
    return {
        "id": str(uuid4()),
        "stepId": step_id,
        "hint": hint,
        "name": hint,
        "note": note,
        "styleProfile": style,
        "productionConstraints": constraints,
        "providerNote": PROVIDER_NOTE,
        "variants": {"detailed": detailed, "concise": concise, "stylized": stylized},
        "prompt": detailed,
        "editable": True,
        "wizardEntry": {
            "assetName": hint,
            "note": note,
            "styleProfile": style,
            "productionConstraints": constraints,
            "providerNote": PROVIDER_NOTE,
        },
    }


def reconcile_middle_steps(
    *,
    steps: list[dict[str, Any]],
    definitions: list[dict[str, Any]],
    motion_surface: dict[str, Any] | None = None,
    audio_definitions: list[dict[str, Any]] | None = None,
    embedded_audio_names: list[str] | None = None,
    style_profile: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Reconcile middle-tagged steps only; intro/outro are left alone.

    Returns (step_verdicts, briefs). Non-middle steps get a skipped verdict
    with no asset/motion work so pregenerated references stay untouched.
    """
    surface = motion_surface or {}
    image_defs = [d for d in definitions if str(d.get("category", "")) != "audio"]
    audio_defs = list(audio_definitions or [])
    audio_names = [str(d.get("name", "")) for d in audio_defs if isinstance(d, dict)]
    audio_names.extend(embedded_audio_names or [])
    # Embedded project audio is matchable even though it has no library row:
    # it scores by name so sfx/music hints can resolve to the take itself.
    # Candidates carry an "embedded:" id; decisions accept that id directly.
    for name in embedded_audio_names or []:
        if name.strip() and all(str(d.get("name", "")) != name for d in audio_defs):
            audio_defs.append(
                {
                    "id": f"embedded:{name}",
                    "name": name,
                    "tags": [],
                    "category": "audio",
                    "ai_description": "",
                }
            )
    step_verdicts: list[dict[str, Any]] = []
    briefs: list[dict[str, Any]] = []
    for step in steps:
        step_id = str(step.get("id", ""))
        part_tag = str(step.get("partTag", ""))
        if part_tag != "middle":
            step_verdicts.append(
                {
                    "stepId": step_id,
                    "order": step.get("order", 0),
                    "partTag": part_tag,
                    "skipped": True,
                    "reason": "pregenerated intro/outro reference — left alone",
                    "assetVerdicts": [],
                    "motion": None,
                    "soundVerdicts": [],
                }
            )
            continue
        hints = step.get("assetHints", [])
        hint_list = (
            [str(h) for h in hints if isinstance(h, str) and str(h).strip()]
            if isinstance(hints, list)
            else []
        )
        # Sound-like hints (sfx/music) reconcile against audio only; visual
        # hints reconcile against the image library. Narration (spokenLine)
        # is never reconciled — Stage C owns it.
        sound_hints = [h for h in hint_list if is_sound_hint(h, audio_names)]
        visual_hints = [h for h in hint_list if h not in sound_hints]
        asset_verdicts = [reconcile_hint(h, image_defs) for h in visual_hints]
        motion = motion_verdict_for_step(
            str(step.get("onScreenAction", "")), asset_verdicts, surface
        )
        sound_verdicts = [reconcile_hint(h, audio_defs) for h in sound_hints]
        step_verdicts.append(
            {
                "stepId": step_id,
                "order": step.get("order", 0),
                "partTag": part_tag,
                "skipped": False,
                "assetVerdicts": asset_verdicts,
                "motion": motion,
                "soundVerdicts": sound_verdicts,
            }
        )
        spoken = str(step.get("spokenLine", ""))
        action = str(step.get("onScreenAction", ""))
        for verdict in asset_verdicts:
            if verdict.get("verdict") == "missing":
                briefs.append(
                    draft_image_brief(
                        step_id=step_id,
                        hint=str(verdict.get("hint", "")),
                        spoken_line=spoken,
                        on_screen_action=action,
                        style_profile=style_profile,
                    )
                )
    return step_verdicts, briefs
