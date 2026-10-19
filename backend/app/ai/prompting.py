"""Server-side prompt composition + token-budget trimming.

Budget uses a documented character approximation (4 chars ≈ 1 token) when the
provider tokenizer is unavailable — which is always in this spec (no tokenizer
dep). Trimming drops the oldest history first, never splits a message, and
never drops the context block.
"""

# ruff: noqa: BLE001
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CHARS_PER_TOKEN = 4

ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS = (
    "Conversation continuity and request coverage are mandatory: treat every user message in the "
    "conversation as an active requirement unless the user explicitly changes or cancels it. "
    "A later clarification narrows or adds to the original request; it does not replace earlier "
    "requested actions. Before answering, privately account for every requested starting pose, "
    "hold/duration, transition, intermediate action, and final pose/direction. Every requirement "
    "must appear in both the proposed beats and the script, or be explicitly identified as "
    "unsupported or approximated. A requested clip or collection is one part of the sequence, "
    "not a substitute for the rest of the request. Never silently omit an action or start the "
    "requested ending animation at time 0 when earlier beats were requested. If scene resources "
    "cannot represent a requested pose or transition, state that limitation and either propose a "
    "clearly labelled closest supported approximation or ask a concise question; do not present an "
    "incomplete sequence as if it satisfies the request. Before sending, cross-check the script "
    "timeline against every proposed beat and the full conversation."
)


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN)


@dataclass(frozen=True)
class ChatMessage:
    role: str
    content: str


def compose_messages(
    system_prompt: str,
    context_text: str,
    history: list[ChatMessage],
    current_message: str,
    budget_tokens: int,
) -> list[ChatMessage]:
    """Oldest-history-first trim to fit budget. System + context + current never dropped."""
    system_tokens = estimate_tokens(system_prompt)
    context_tokens = estimate_tokens(context_text)
    current_tokens = estimate_tokens(current_message)
    fixed = system_tokens + context_tokens + current_tokens

    # Keep newest history that fits; drop oldest first.
    kept: list[ChatMessage] = list(history)
    while kept:
        history_tokens = sum(estimate_tokens(m.content) + 4 for m in kept)
        if fixed + history_tokens <= budget_tokens:
            break
        kept.pop(0)
    # If even empty history exceeds budget, still return system/context/current
    # (history fully trimmed) — context is never dropped per spec.
    messages: list[ChatMessage] = []
    if system_prompt:
        messages.append(ChatMessage(role="system", content=system_prompt))
    if context_text:
        messages.append(ChatMessage(role="system", content=f"Project context:\n{context_text}"))
    messages.extend(kept)
    messages.append(ChatMessage(role="user", content=current_message))
    return messages


def context_to_text(context: object) -> str:
    if context is None:
        return ""
    if isinstance(context, str):
        return context
    if isinstance(context, dict):
        parts: list[str] = []
        value = context.get("projectName")
        if isinstance(value, str) and value.strip():
            parts.append(f"project: {value.strip()}")
        value = context.get("activeSlideName")
        if isinstance(value, str) and value.strip():
            parts.append(f"active slide: {value.strip()}")
        slides = context.get("slides")
        if isinstance(slides, list) and slides:
            names = [str(s.get("name", s)) if isinstance(s, dict) else str(s) for s in slides]
            parts.append("slides: " + ", ".join(names[:50]))
        nodes = context.get("sceneNodes")
        if isinstance(nodes, list) and nodes:
            parts.append("scene nodes: " + ", ".join(str(n) for n in nodes[:100]))
        for key in ("materials", "shaders", "clips", "assets"):
            items = context.get(key)
            if isinstance(items, list) and items:
                parts.append(f"{key}: " + ", ".join(str(i) for i in items[:100]))
        selection = context.get("selection")
        if isinstance(selection, list) and selection:
            parts.append("selection: " + ", ".join(str(s) for s in selection[:50]))
        # Scenario markdown doc (issue #462): the model never sees the doc
        # unless it rides the context. Injected here (parallel prop accepted)
        # with a budget re-tune handled by the caller trimming history first.
        scenario_markdown = context.get("scenarioMarkdown")
        if isinstance(scenario_markdown, str) and scenario_markdown.strip():
            # Cap to keep the prompt bounded; the full doc lives in the
            # project file, this is the model's working view.
            parts.append("scenario markdown:\n" + scenario_markdown.strip()[:8000])
        scenario_version = context.get("scenarioActiveVersion")
        if isinstance(scenario_version, dict):
            summary = scenario_version.get("summary")
            touched = scenario_version.get("touchedSteps")
            version_id = scenario_version.get("id")
            bits: list[str] = []
            if isinstance(version_id, str) and version_id:
                bits.append(f"version {version_id}")
            if isinstance(summary, str) and summary.strip():
                bits.append(f'summary "{summary.strip()}"')
            if isinstance(touched, list) and touched:
                bits.append("touched steps " + ", ".join(str(n) for n in touched[:20]))
            if bits:
                parts.append("active scenario version: " + "; ".join(bits))
        animation = context.get("animation")
        if isinstance(animation, dict):
            animation_text = _animation_to_text(animation)
            if animation_text:
                parts.append(animation_text)
        # Fallback: include any other scalar context for grounding
        if not parts:
            import json

            try:
                return json.dumps(context)[:4000]
            except Exception:
                return str(context)[:4000]
        return "\n".join(parts)
    return str(context)[:4000]


def _dict_entries(items: object, limit: int) -> list[dict[str, Any]]:
    """Bounded dict entries from a snapshot list; non-dict rows are skipped."""
    if not isinstance(items, list):
        return []
    return [entry for entry in items[:limit] if isinstance(entry, dict)]


RENDERED_VIEW_NOTE = (
    "rendered views complement structured project data — identity and relationships "
    "come from stable Scene Node ids, hierarchy, and names, never from pixels"
)


def format_rendered_view_label(
    slide_name: str,
    slide_id: str,
    time: float,
    node_ids: list[str],
    scope: str = "current",
    node_names: dict[str, str] | None = None,
) -> str:
    """Canonical labelled rendered-view descriptor (issue #441).

    Mirrors the frontend `formatRenderedViewLabel` so both sides agree on the
    Slide/time/stable-id label. Pure and read-only: formats its arguments and
    never touches project data. Rendered views complement structured evidence —
    see RENDERED_VIEW_NOTE — they never replace it.
    """
    import math

    if scope == "focused":
        scope_word = "focused"
    elif scope == "current":
        scope_word = "current scene"
    else:
        raise ValueError(f'unknown rendered-view scope {scope!r} — use "current" or "focused"')
    if not isinstance(time, (int, float)) or not math.isfinite(time):
        raise ValueError("rendered-view time must be a finite number of Slide seconds")
    ids = [entry for entry in (node_ids or []) if isinstance(entry, str) and entry]
    if ids:
        names = node_names or {}
        rendered = ", ".join(
            f"{names[id]} [{id}]" if isinstance(names.get(id), str) and names[id] else f"[{id}]"
            for id in ids
        )
    else:
        rendered = "no scene nodes"
    return (
        f'Slide "{slide_name}" [{slide_id}] @ {round(float(time), 2):g}s — '
        f"{scope_word} view (nodes: {rendered})"
    )


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Monotone-chain exterior hull (CCW, no duplicate endpoint). Pure."""
    unique = sorted(set(points))
    if len(unique) <= 1:
        return unique

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _shape_geometry_to_text(animation: dict[str, Any]) -> str:
    """Compact exterior-hull outlines from snapshot shapeGeometry (issue: model shape sight).

    Bounds: at most 20 shapes, 24 hull points each — mesh-local x/y, exterior
    only (no interior triangulation). Pure and read-only.
    """
    node_names: dict[str, str] = {}
    for entry in _dict_entries(animation.get("nodes"), 150):
        node_id = entry.get("id")
        name = entry.get("name")
        if isinstance(node_id, str) and isinstance(name, str) and name.strip():
            node_names[node_id] = name.strip()
    raw = animation.get("shapeGeometry")
    if not isinstance(raw, list) or not raw:
        return ""
    parts: list[str] = []
    for node_entry in raw:
        if not isinstance(node_entry, dict) or len(parts) >= 20:
            continue
        node_id = node_entry.get("nodeId")
        key = node_id if isinstance(node_id, str) else "?"
        label = node_names.get(key, key) if isinstance(key, str) else "?"
        shapes = node_entry.get("shapes")
        if not isinstance(shapes, list):
            continue
        for shape in shapes[:10]:
            if len(parts) >= 20 or not isinstance(shape, dict):
                continue
            shape_name = shape.get("name")
            vertices = shape.get("vertices")
            if not isinstance(shape_name, str) or not shape_name.strip():
                continue
            if not isinstance(vertices, list) or not vertices:
                continue
            category_path = shape.get("categoryPath")
            if isinstance(category_path, list) and all(
                isinstance(seg, str) and seg for seg in category_path
            ):
                qualified = "/".join([*category_path, shape_name.strip()])
            else:
                qualified = shape_name.strip()
            points: list[tuple[float, float]] = []
            for vertex in vertices:
                if not isinstance(vertex, dict):
                    continue
                x, y = vertex.get("x"), vertex.get("y")
                if isinstance(x, bool) or isinstance(y, bool):
                    continue
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    import math

                    if math.isfinite(x) and math.isfinite(y):
                        points.append((float(x), float(y)))
            if not points:
                continue
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            centroid = (sum(xs) / len(xs), sum(ys) / len(ys))
            hull = _convex_hull(points)
            if len(hull) > 24:
                step = len(hull) / 24
                hull = [hull[int(i * step)] for i in range(24)]
            outline = (
                "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in hull) + " Z"
                if hull
                else "M (empty) Z"
            )
            parts.append(
                f"{label} [{key}] shape '{qualified}': {len(points)}v "
                f"bounds ({min_x:.1f},{min_y:.1f} {max_x - min_x:.1f}x{max_y - min_y:.1f}) "
                f"centroid ({centroid[0]:.1f},{centroid[1]:.1f}) outline {outline}"
            )
    if not parts:
        return ""
    text = "shape outlines (mesh-local x/y, exterior hull only): " + "; ".join(parts)
    if animation.get("shapeGeometryTruncated") is True:
        text += " (note: geometry truncated to the bounded set)"
    return text


def _animation_to_text(animation: dict[str, Any]) -> str:
    """Bounded rendering of the animation-assistant snapshot (issue #438).

    Caps mirror the frontend ANIMATION_SNAPSHOT_LIMITS so the prompt keeps
    every summary the snapshot contract promises.
    """
    lines: list[str] = []
    summaries: list[str] = []
    for entry in _dict_entries(animation.get("nodes"), 150):
        summary = f"{entry.get('name', '?')} [{entry.get('id', '?')}]"
        semantic = entry.get("semanticName")
        if isinstance(semantic, str) and semantic.strip():
            summary += f" (semantic: {semantic.strip()})"
        components = entry.get("components")
        if isinstance(components, list) and components:
            summary += f" <{', '.join(str(c) for c in components[:8])}>"
        asset_definition = entry.get("assetDefinitionId")
        if isinstance(asset_definition, str) and asset_definition.strip():
            summary += f" [asset {asset_definition.strip()}]"
        parent = entry.get("parentId")
        if isinstance(parent, str) and parent:
            summary += f" child of {parent}"
        depth = entry.get("depth")
        if isinstance(depth, int):
            summary += f" depth {depth}"
        child_count = entry.get("childCount")
        if isinstance(child_count, int) and child_count > 0:
            summary += f" [{child_count} children]"
        transform = entry.get("transform")
        if isinstance(transform, dict):
            summary += (
                f" at ({transform.get('x', 0)}, {transform.get('y', 0)},"
                f" rot {transform.get('rotation', 0)})"
            )
        if entry.get("visible") is False:
            summary += " [hidden]"
        summaries.append(summary)
    if summaries:
        lines.append("animation nodes: " + "; ".join(summaries))
    rig = animation.get("rig")
    if isinstance(rig, dict):
        rig_parts: list[str] = []
        bones = _dict_entries(rig.get("bones"), 100)
        if bones:
            rig_parts.append(
                "bones: " + ", ".join(str(b.get("name", b.get("id", "?"))) for b in bones)
            )
        shape_parts = []
        for entry in _dict_entries(rig.get("shapeInventory"), 150):
            # Prefer category-qualified names (Category/Sub/name, unique per
            # node) so duplicate shape names across categories stay distinct.
            qualified = entry.get("qualifiedShapeNames")
            if isinstance(qualified, list) and qualified:
                label = ", ".join(str(n) for n in qualified[:10])
            else:
                names = entry.get("shapeNames")
                label = (
                    ", ".join(str(n) for n in names[:10])
                    if isinstance(names, list) and names
                    else f"{entry.get('shapeCount', 0)} shapes"
                )
            shape_parts.append(f"{entry.get('nodeId', '?')}: {label}")
        if shape_parts:
            rig_parts.append("shapes: " + "; ".join(shape_parts))
        morph_parts = []
        for entry in _dict_entries(rig.get("morphBindings"), 150):
            morph_parts.append(
                f"{entry.get('nodeId', '?')}"
                f" [{entry.get('fromShapeId', '?')} -> {entry.get('toShapeId', '?')}]"
            )
        if morph_parts:
            rig_parts.append("morphs: " + "; ".join(morph_parts))
        control_parts = []
        for entry in _dict_entries(rig.get("controls"), 150):
            keys = entry.get("keys")
            keys_text = ", ".join(str(k) for k in keys[:10]) if isinstance(keys, list) else "?"
            control_parts.append(f"{entry.get('hostNodeId', '?')} [{keys_text}]")
        if control_parts:
            rig_parts.append("controls: " + "; ".join(control_parts))
        if rig_parts:
            lines.append("rig: " + " | ".join(rig_parts))
    geometry_text = _shape_geometry_to_text(animation)
    if geometry_text:
        lines.append(geometry_text)
    clip_parts = []
    for entry in _dict_entries(animation.get("clips"), 100):
        label = str(entry.get("name", "?"))
        if entry.get("duration") is not None:
            label += f" ({entry.get('duration')}s"
            if entry.get("channelCount") is not None:
                label += f", {entry.get('channelCount')} channels"
            label += ")"
        clip_parts.append(label)
    if clip_parts:
        lines.append("animation clips: " + "; ".join(clip_parts))
    collection_parts = []
    for entry in _dict_entries(animation.get("collections"), 100):
        label = str(entry.get("name", "?"))
        if entry.get("bindingCount") is not None:
            label += f" ({entry.get('bindingCount')} bindings)"
        bindings = entry.get("bindings")
        if isinstance(bindings, dict) and bindings:
            label += " [" + ", ".join(f"{k}->{v}" for k, v in list(bindings.items())[:50]) + "]"
        collection_parts.append(label)
    if collection_parts:
        lines.append("clip collections: " + "; ".join(collection_parts))
    timeline = animation.get("timeline")
    if isinstance(timeline, dict):
        timeline_parts = []
        if timeline.get("duration") is not None:
            timeline_parts.append(f"duration {timeline.get('duration')}s")
        if timeline.get("animatedNodeCount") is not None:
            timeline_parts.append(f"{timeline.get('animatedNodeCount')} animated nodes")
        if timeline.get("totalKeyframes") is not None:
            timeline_parts.append(f"{timeline.get('totalKeyframes')} keyframes")
        if timeline.get("clipInstanceCount") is not None:
            timeline_parts.append(f"{timeline.get('clipInstanceCount')} clip instances")
        if timeline.get("placementCount") is not None:
            timeline_parts.append(f"{timeline.get('placementCount')} placements")
        hosts = _dict_entries(timeline.get("controlHosts"), 150)
        if hosts:
            timeline_parts.append(
                "control hosts: " + ", ".join(str(h.get("nodeId", "?")) for h in hosts)
            )
        if timeline.get("hasAnimationScript") is True:
            timeline_parts.append("animation script present")
        if timeline_parts:
            lines.append("timeline: " + ", ".join(timeline_parts))
    truncated = animation.get("truncated")
    if isinstance(truncated, dict) and any(truncated.values()):
        flagged = sorted(k for k, v in truncated.items() if v)
        lines.append(f"note: truncated snapshot sections: {', '.join(flagged)}")
    if lines:
        # Authority reminder travels with animation evidence (issue #441):
        # labelled rendered views complement the structured snapshot above and
        # never replace stable Scene Node identity or relationships.
        lines.append(f"note: {RENDERED_VIEW_NOTE}")
    return "\n".join(lines)
