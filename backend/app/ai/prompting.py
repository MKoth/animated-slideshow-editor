"""Server-side prompt composition + token-budget trimming.

Budget uses a documented character approximation (4 chars ≈ 1 token) when the
provider tokenizer is unavailable — which is always in this spec (no tokenizer
dep). Trimming drops the oldest history first, never splits a message, and
never drops the context block.
"""

# ruff: noqa: BLE001
from __future__ import annotations

import re
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


def _as_float(value: object) -> float | None:
    """Finite float from a JSON number, else None (bools never count)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        as_float = float(value)
        import math

        return as_float if math.isfinite(as_float) else None
    return None


def _blackboard_focus_to_text(focus: object) -> str:
    """Active-slide Blackboard focus (issue #472): id plus length with prompt
    block ids/windows/text and per-action fractions, without whole scripts.
    Pure and read-only; malformed focus renders as empty.
    """
    if not isinstance(focus, dict):
        return ""
    slide_id = focus.get("slideId")
    slide_name = focus.get("slideName")
    duration = _as_float(focus.get("duration"))
    header = ""
    if isinstance(slide_id, str) and slide_id.strip():
        header = f"blackboard focus slide: {slide_id.strip()}"
        if isinstance(slide_name, str) and slide_name.strip():
            header += f' "{slide_name.strip()}"'
        if duration is not None:
            header += f" ({duration:g}s)"
    elif isinstance(slide_name, str) and slide_name.strip():
        header = f"blackboard focus slide: {slide_name.strip()}"
        if duration is not None:
            header += f" ({duration:g}s)"
    lines: list[str] = []
    if header:
        lines.append(header)
    blocks = focus.get("promptBlocks")
    if isinstance(blocks, list) and blocks:
        rendered: list[str] = []
        for entry in blocks:
            if not isinstance(entry, dict):
                continue
            block_id = entry.get("id")
            if not isinstance(block_id, str) or not block_id.strip():
                continue
            start = _as_float(entry.get("start"))
            end = _as_float(entry.get("end"))
            window = f" [{start:g}-{end:g}s]" if start is not None and end is not None else ""
            text = entry.get("text")
            snippet = (
                str(text).strip().replace("\n", " ")
                if isinstance(text, str) and str(text).strip()
                else ""
            )
            rendered.append(
                f'{block_id.strip()}{window} "{snippet}"'
                if snippet
                else f"{block_id.strip()}{window}"
            )
        if rendered:
            lines.append("prompt blocks: " + "; ".join(rendered))
    actions = focus.get("actions")
    if isinstance(actions, list) and actions:
        rendered_actions: list[str] = []
        for entry in actions:
            if not isinstance(entry, dict):
                continue
            action = entry.get("action")
            block = entry.get("block")
            fraction = _as_float(entry.get("fraction"))
            if not isinstance(action, str) or not action.strip():
                continue
            piece = action.strip()
            if isinstance(block, str) and block.strip():
                piece += f" @ {block.strip()}"
            if fraction is not None:
                piece += f" {fraction:.3f}"
            rendered_actions.append(piece)
        if rendered_actions:
            lines.append("board actions: " + "; ".join(rendered_actions))
    return "\n".join(lines)


def _script_focus_to_text(focus: object) -> str:
    """Slide script focus: slide id/name/duration, full script source, prompt
    block ids/windows/text, and latest check diagnostics. Pure and read-only;
    malformed focus renders as empty.
    """
    if not isinstance(focus, dict):
        return ""
    slide_id = focus.get("slideId")
    slide_name = focus.get("slideName")
    duration = _as_float(focus.get("duration"))
    header = ""
    if isinstance(slide_id, str) and slide_id.strip():
        header = f"script focus slide: {slide_id.strip()}"
        if isinstance(slide_name, str) and slide_name.strip():
            header += f' "{slide_name.strip()}"'
        if duration is not None:
            header += f" ({duration:g}s)"
    elif isinstance(slide_name, str) and slide_name.strip():
        header = f"script focus slide: {slide_name.strip()}"
        if duration is not None:
            header += f" ({duration:g}s)"
    lines: list[str] = []
    if header:
        lines.append(header)
    source = focus.get("source")
    if isinstance(source, str) and source.strip():
        # The current editor draft is authoritative; never silently substitute
        # an older conversation turn or truncate the script being improved.
        lines.append("script source:\n" + source.strip())
    blocks = focus.get("promptBlocks")
    if isinstance(blocks, list) and blocks:
        rendered: list[str] = []
        for entry in blocks:
            if not isinstance(entry, dict):
                continue
            block_id = entry.get("id")
            if not isinstance(block_id, str) or not block_id.strip():
                continue
            start = _as_float(entry.get("start"))
            end = _as_float(entry.get("end"))
            window = f" [{start:g}-{end:g}s]" if start is not None and end is not None else ""
            text = entry.get("text")
            snippet = (
                str(text).strip().replace("\n", " ")
                if isinstance(text, str) and str(text).strip()
                else ""
            )
            rendered.append(
                f'{block_id.strip()}{window} "{snippet}"'
                if snippet
                else f"{block_id.strip()}{window}"
            )
        if rendered:
            lines.append("prompt blocks: " + "; ".join(rendered))
    diagnostics = focus.get("diagnostics")
    if isinstance(diagnostics, list) and diagnostics:
        rendered_diags: list[str] = []
        for entry in diagnostics:
            if not isinstance(entry, dict):
                continue
            message = entry.get("message")
            if not isinstance(message, str) or not message.strip():
                continue
            severity = entry.get("severity")
            line = entry.get("line")
            column = entry.get("column")
            where = ""
            if isinstance(line, int) and isinstance(column, int):
                where = f"line {line}, col {column}: "
            elif isinstance(line, int):
                where = f"line {line}: "
            prefix = f"{severity}: " if isinstance(severity, str) and severity.strip() else ""
            rendered_diags.append(f"{prefix}{where}{message.strip()}")
        if rendered_diags:
            lines.append("check diagnostics: " + " | ".join(rendered_diags))
    return "\n".join(lines)


def _script_scene_to_text(scene: object) -> str:
    """Compact live scene geometry, camera frame, and material/shader links."""
    if not isinstance(scene, dict):
        return ""
    frame = scene.get("frame")
    lines: list[str] = []
    if isinstance(frame, dict):
        width, height = _as_float(frame.get("width")), _as_float(frame.get("height"))
        if width is not None and height is not None:
            lines.append(f"script scene frame: {width:g}×{height:g} world units")
    camera = scene.get("camera")
    if isinstance(camera, dict):
        camera_name = str(camera.get("name", "camera"))
        camera_id = str(camera.get("id", ""))
        scale_x, scale_y = _as_float(camera.get("scaleX")), _as_float(camera.get("scaleY"))
        x, y = _as_float(camera.get("x")), _as_float(camera.get("y"))
        camera_line = f"active camera: {camera_name}"
        if camera_id:
            camera_line += f" [{camera_id}]"
        if x is not None and y is not None:
            camera_line += f" top-left ({x:g}, {y:g})"
        if scale_x is not None and scale_y is not None:
            camera_line += f" zoom ({scale_x:g}, {scale_y:g})"
        rect = camera.get("visibleWorldRect")
        if isinstance(rect, dict):
            edges = [_as_float(rect.get(key)) for key in ("left", "top", "right", "bottom")]
            if all(edge is not None for edge in edges):
                left, top, right, bottom = edges
                camera_line += f"; visible world area x={left:g}..{right:g}, y={top:g}..{bottom:g}"
        lines.append(camera_line)
    nodes = scene.get("nodes")
    rendered_nodes: list[str] = []
    if isinstance(nodes, list):
        for node in nodes[:100]:
            if not isinstance(node, dict):
                continue
            name = str(node.get("name", "?"))
            node_id = str(node.get("id", "?"))
            details = [f"{name} [{node_id}] ({node.get('kind', 'node')})"]
            world = node.get("world")
            if isinstance(world, dict):
                values = [_as_float(world.get(key)) for key in ("x", "y", "scaleX", "scaleY")]
                if all(value is not None for value in values):
                    wx, wy, sx, sy = values
                    details.append(f"world pos ({wx:g}, {wy:g}), scale ({sx:g}, {sy:g})")
            size = node.get("measuredSize")
            if isinstance(size, dict):
                width, height = _as_float(size.get("width")), _as_float(size.get("height"))
                if width is not None and height is not None:
                    details.append(f"renderer-measured size {width:g}×{height:g}")
            else:
                details.append("size not yet renderer-measured")
            material = node.get("material")
            shader = node.get("shader")
            if isinstance(material, str) and material:
                details.append(f"material {material}" + (f" (shader {shader})" if shader else ""))
            rendered_nodes.append("; ".join(details))
    if rendered_nodes:
        lines.append("scene nodes with geometry/materials: " + " | ".join(rendered_nodes))
    materials = scene.get("materials")
    if isinstance(materials, list):
        links = [
            f"{entry.get('name', '?')} → shader {entry['shader']}"
            if isinstance(entry, dict) and entry.get("shader")
            else str(entry.get("name", "?"))
            for entry in materials[:100]
            if isinstance(entry, dict)
        ]
        if links:
            lines.append("material definitions and shader links: " + "; ".join(links))
    return "\n".join(lines)


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


def script_history_window(
    history: list[ChatMessage], current_message: str = ""
) -> list[ChatMessage]:
    """Keep script-chat continuity while compacting obsolete source dumps.

    The editor's current source rides in context, and the newest prior assistant
    script remains intact. Earlier proposed/failed scripts are replaced by line
    counts, while surrounding conversation and validation-error text survive.
    Regenerate mode may repeat the last user message as current, so omit that
    duplicate. Pure and read-only.
    """
    current = (current_message or "").strip()
    kept = list(history)
    if kept and kept[-1].role == "user" and current and kept[-1].content.strip() == current:
        kept.pop()

    latest_script_message = next(
        (
            index
            for index in range(len(kept) - 1, -1, -1)
            if kept[index].role == "assistant" and _has_script_block(kept[index].content)
        ),
        -1,
    )
    return [
        message
        if index == latest_script_message
        else ChatMessage(
            role=message.role,
            content=_compact_historical_scripts(message.content),
        )
        for index, message in enumerate(kept)
    ]


_SCRIPT_FENCE_RE = re.compile(r"```(\w[\w-]*)\s*\n([\s\S]*?)```", re.IGNORECASE)
_FAILED_SCRIPT_RE = re.compile(r"<failed-script>\s*([\s\S]*?)\s*</failed-script>", re.IGNORECASE)


def _script_line_count(source: str) -> int:
    lines = source.strip().splitlines()
    if lines and lines[0].strip().lower().startswith("slide:"):
        lines = lines[1:]
    return len(lines)


def _is_animation_script(source: str) -> bool:
    return (
        re.search(
            r'^\s*(?:slide\s*:\s*[^\n]+\n\s*)?script\s+"[^\"]+"\s+from\s+[\d.]+',
            source,
            re.MULTILINE,
        )
        is not None
    )


def _has_script_block(content: str) -> bool:
    return any(
        (match.group(1) or "").lower() in {"engine-command", "engine-commands"}
        and _is_animation_script(match.group(2) or "")
        for match in _SCRIPT_FENCE_RE.finditer(content or "")
    )


def _compact_historical_scripts(content: str) -> str:
    def compact_failed(match: re.Match[str]) -> str:
        source = match.group(1) or ""
        return f"<failed-script>[Earlier failed script omitted ({_script_line_count(source)} lines).]</failed-script>"

    content = _FAILED_SCRIPT_RE.sub(compact_failed, content or "")

    def compact_fence(match: re.Match[str]) -> str:
        language, source = match.group(1) or "", match.group(2) or ""
        if language.lower() not in {
            "engine-command",
            "engine-commands",
        } or not _is_animation_script(source):
            return match.group(0)
        return f"[Earlier proposed script omitted ({_script_line_count(source)} lines).]"

    return _SCRIPT_FENCE_RE.sub(compact_fence, content)


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
        # Active-slide awareness (issue #472): chat context carries the active
        # slide id plus length so polish defaults to the active slide with an
        # explicit override. Rendered as one line to keep the prompt compact.
        active_name = context.get("activeSlideName")
        active_id = context.get("activeSlideId")
        active_duration = _as_float(context.get("activeSlideDuration"))
        if isinstance(active_name, str) and active_name.strip():
            line = f"active slide: {active_name.strip()}"
            if isinstance(active_id, str) and active_id.strip():
                line += f" [{active_id.strip()}]"
            if active_duration is not None:
                line += f" ({active_duration:g}s)"
            parts.append(line)
        elif isinstance(active_id, str) and active_id.strip():
            line = f"active slide id: {active_id.strip()}"
            if active_duration is not None:
                line += f" ({active_duration:g}s)"
            parts.append(line)
        elif active_duration is not None:
            parts.append(f"active slide duration: {active_duration:g}s")
        focus_text = _blackboard_focus_to_text(context.get("blackboardFocus"))
        if focus_text:
            parts.append(focus_text)
        script_focus_text = _script_focus_to_text(context.get("scriptFocus"))
        if script_focus_text:
            parts.append(script_focus_text)
        script_scene_text = _script_scene_to_text(context.get("scriptScene"))
        if script_scene_text:
            parts.append(script_scene_text)
        audio_focus = context.get("audioPrompterFocus")
        if isinstance(audio_focus, dict):
            audio_slide_id = audio_focus.get("slideId")
            audio_slide_name = audio_focus.get("slideName")
            audio_header = "audio prompter focus"
            if isinstance(audio_slide_name, str) and audio_slide_name.strip():
                audio_header += f": {audio_slide_name.strip()}"
            if isinstance(audio_slide_id, str) and audio_slide_id.strip():
                audio_header += f" [{audio_slide_id.strip()}]"
            audio_parts = audio_focus.get("parts")
            if isinstance(audio_parts, list):
                rendered_audio_parts: list[str] = []
                for index, entry in enumerate(audio_parts):
                    if not isinstance(entry, dict):
                        continue
                    text = entry.get("text")
                    if not isinstance(text, str):
                        continue
                    block_id = entry.get("id")
                    id_tag = f" [{block_id}]" if isinstance(block_id, str) and block_id else ""
                    language = entry.get("language")
                    language_tag = (
                        f" ({language})" if isinstance(language, str) and language else ""
                    )
                    rendered_audio_parts.append(
                        f"{index + 1}{id_tag}.{language_tag} {text.strip()}"
                    )
                if rendered_audio_parts:
                    parts.append(audio_header + ":\n" + "\n".join(rendered_audio_parts))
        slides = context.get("slides")
        if isinstance(slides, list) and slides:
            # Slide ids ride alongside names so polish can target the active
            # slide by default with an explicit override naming another slide.
            rendered_slides: list[str] = []
            for entry in slides[:50]:
                if isinstance(entry, dict):
                    name = entry.get("name")
                    slide_id = entry.get("id")
                    if isinstance(name, str) and name.strip():
                        if isinstance(slide_id, str) and slide_id.strip():
                            rendered_slides.append(f"{name.strip()} [{slide_id.strip()}]")
                        else:
                            rendered_slides.append(name.strip())
                    elif isinstance(slide_id, str) and slide_id.strip():
                        rendered_slides.append(f"[{slide_id.strip()}]")
                else:
                    rendered_slides.append(str(entry))
            if rendered_slides:
                parts.append("slides: " + ", ".join(rendered_slides))
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
        # Scenario markdown doc (issues #462, #466): the model never sees the
        # doc unless it rides the context. Injected here (parallel props
        # accepted) with a budget re-tune handled by the caller trimming
        # history first — the context block (including the scenario working
        # view) is never dropped, only history is. The working view is the
        # accepted downstream snapshot when set (stable), else the active
        # draft: downstream reconciliation must read the accepted snapshot
        # (canonical endpoint / engine project state when embedded), never
        # chase every draft keystroke nor freeze on stale content.
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
        # Accepted snapshot (issue #466): the stable downstream read. When
        # present, later assistants reconcile against this version; when
        # absent, they must block (canonical 409) rather than consuming
        # the active draft unreviewed.
        accepted_version = context.get("scenarioAcceptedVersion")
        if isinstance(accepted_version, dict):
            summary = accepted_version.get("summary")
            touched = accepted_version.get("touchedSteps")
            version_id = accepted_version.get("id")
            bits = []
            if isinstance(version_id, str) and version_id:
                bits.append(f"version {version_id}")
            if isinstance(summary, str) and summary.strip():
                bits.append(f'summary "{summary.strip()}"')
            if isinstance(touched, list) and touched:
                bits.append("touched steps " + ", ".join(str(n) for n in touched[:20]))
            if bits:
                parts.append("accepted scenario version (downstream snapshot): " + "; ".join(bits))
            elif isinstance(version_id, str) and version_id:
                parts.append(
                    "accepted scenario version (downstream snapshot): version " + version_id
                )
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
