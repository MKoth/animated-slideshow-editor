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
        parent = entry.get("parentId")
        if isinstance(parent, str) and parent:
            summary += f" child of {parent}"
        depth = entry.get("depth")
        if isinstance(depth, int):
            summary += f" depth {depth}"
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
    return "\n".join(lines)
