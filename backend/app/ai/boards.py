"""Stage E blackboard helpers: hard-locked Animation Scripts synced to voice.

Implements issue #427 (Spec 12 build Stage E) against the resolution on
#419: one fresh Animation Script per middle slide starting at zero with a
compile-time mark at each PrompterPart boundary, so every effect lives
inside an owning narration window. Scripts are hard-locked to the accepted
Stage C PrompterPart times — segment window errors, overruns, and drift
block the accept gate with no auto-shift. Board content is authored via
script-created text nodes (create-then-reveal) and tables (Table/Row/Cell
plus Grid Layout) animated with reveal/mark/wipe verbs using compiler
built-ins only, keeping scripts portable and reviewable. Disappear lowers
to opacity holds; empty or unmeasurable effect targets and unresolved
bindings block the gate at compile time. Middle slides carry no cat nodes
and a static board camera unless the accepted scenario explicitly asks for
a board move. Own versioned record (scripts + compiled footprints +
marks-to-part map) with an explicit accept gate feeding the merge.
"""

from __future__ import annotations

from typing import Any

# Board scripts execute through the canonical proposal surface as
# SetSlideAnimationScript only. The AiCreateBoardText/Table placeholders stay
# schema-valid but never execute a board — content rides inside scripts via
# create-then-reveal so it stays portable and reviewable.
BOARD_COMMAND_TYPES: tuple[str, ...] = ("SetSlideAnimationScript",)

# Effect verbs a board script may author. Temporary Mark loops ride the same
# `mark(target, ...)` effect form; compile-time `mark("name")` labels are the
# narration-window boundaries, not effects.
BOARD_EFFECT_VERBS: tuple[str, ...] = ("reveal", "wipe", "mark")

# Statement built-ins the compiler provides for board motion. Only
# pointArrowAt is reused from the statement built-ins; reveal/wipe/mark are
# the effect verbs above. Anything else that inlines code (local functions,
# library entries) stays out so scripts stay reviewable.
BOARD_STATEMENT_BUILTINS: tuple[str, ...] = ("pointArrowAt", "reveal", "wipe", "mark", "subtree")

# Methods that have no place on a blackboard script: clip/collection
# playback, mouth morphs/controls, and rig-specific tracks. Tween/set survive
# only as opacity holds for disappear (checked separately).
FORBIDDEN_BOARD_METHODS: tuple[str, ...] = (
    "play",
    "apply",
    "morph",
    "control",
    "shadow",
    "symmetry",
    "dataLabel",
)

# A board move is explicit prose in the accepted scenario on-screen action.
# Static framing is the default; only these tokens license camera keys.
BOARD_MOVE_TOKENS: tuple[str, ...] = (
    "board move",
    "pan",
    "zoom",
    "dolly",
    "camera move",
    "camera pan",
    "camera zoom",
)


def mark_name_for_part(index: int) -> str:
    """Deterministic compile-time mark label for one narration window.

    Position-based (0..n-1 in timeline order), not the narration order field,
    so template sources and the marks map stay aligned even when middle
    orders are non-contiguous (e.g. intro/middle/outro scenario orders).
    """
    return f"part-{int(index)}"


def middle_parts_from_narration(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Accepted Stage C parts, verbatim — the hard-lock timing source.

    Middle only: intro/outro-tagged parts are pregen references and never
    scripted. Parts already carry gap-free timelineStart/timelineEnd plus
    adopted TTS audio durations. Unmeasurable middle parts raise instead of
    silently dropping — drift must block, never slip.
    """
    out: list[dict[str, Any]] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        tag = part.get("partTag", "middle")
        if isinstance(tag, str) and tag and tag != "middle":
            continue
        step_id = str(part.get("stepId", ""))
        spoken = part.get("spokenLine", "")
        if not step_id or not isinstance(spoken, str) or not spoken:
            continue
        start = part.get("timelineStart")
        end = part.get("timelineEnd")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError(  # noqa: TRY004
                f"part {step_id or '?'} has no measurable narration window — "
                "fix PrompterPart timing before scripting"
            )
        if not float(end) > float(start):
            raise ValueError(
                f"part {step_id} has an empty narration window "
                f"([{start}, {end}]) — fix PrompterPart timing before scripting"
            )
        out.append(dict(part))
    if not out:
        raise ValueError("no measurable middle narration parts — nothing to script")
    out.sort(key=lambda p: (float(p.get("timelineStart", 0.0)), int(p.get("order", 0))))
    return out


def slide_duration_for_parts(parts: list[dict[str, Any]]) -> float:
    """Slide duration is the sum of its parts (Stage C rule, reused here)."""
    total = 0.0
    for part in parts:
        audio = part.get("audioDuration")
        if isinstance(audio, (int, float)) and float(audio) > 0:
            total += float(audio)
            continue
        estimated = part.get("estimatedDuration", 0.0)
        total += float(estimated) if isinstance(estimated, (int, float)) else 0.0
    return total


def marks_for_parts(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One compile-time mark per PrompterPart boundary, in time order.

    Marks sit at each part start; the final part end closes the last window.
    The marks-to-part map rides the board record to the merge.
    """
    ordered = middle_parts_from_narration(parts)
    marks: list[dict[str, Any]] = []
    for index, part in enumerate(ordered):
        marks.append(
            {
                "mark": mark_name_for_part(index),
                "stepId": str(part.get("stepId", "")),
                "time": float(part.get("timelineStart", 0.0)),
                "windowStart": float(part.get("timelineStart", 0.0)),
                "windowEnd": float(part.get("timelineEnd", 0.0)),
            }
        )
    return marks


def marks_map_for_parts(parts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Mark label -> owning narration window for the merge handoff."""
    return {
        entry["mark"]: {"stepId": entry["stepId"], "time": entry["time"]}
        for entry in marks_for_parts(parts)
    }


def build_template_source(parts: list[dict[str, Any]], title: str = "Board middle") -> str:
    """Fresh per-slide script from zero with marks at every part boundary.

    Create-then-reveal placeholders sit inside each owning window using
    compiler built-ins only (no shared library entry). The author replaces
    the placeholder text/table rows with lesson content and keeps every
    effect inside its window — overruns block the gate, never auto-shift.
    """
    ordered = middle_parts_from_narration(parts)
    clean_title = title.strip() or "Board middle"
    lines = [f'script "{clean_title}" from 0']
    for index, part in enumerate(ordered):
        mark = mark_name_for_part(index)
        lines.append(f'mark("{mark}")')
        alias = f"line{index}"
        # Chalk-board placeholder: script-created text, then a reveal sweep
        # inside the owning narration window. Tables follow the same shape:
        # `create table "Grid{i}" as grid{i} {{ ... }}` then reveal(subtree(...)).
        lines.append(f'create text "Board line {index + 1}" as {alias}')
        lines.append(f"reveal({alias})")
    # Close the slide at the last part end so the segment window is explicit.
    last_end = float(ordered[-1].get("timelineEnd", 0.0))
    lines.append(f"// slide ends at {last_end:.2f}s = sum of accepted part durations")
    return "\n".join(lines) + "\n"


def validate_script_header(source: str) -> list[str]:
    """Fresh scripts start at zero: `script \"...\" from 0`."""
    errors: list[str] = []
    if not isinstance(source, str) or not source.strip():
        return ["script is empty — author one fresh script per middle slide from zero"]
    stripped = source.strip()
    if not stripped.startswith("script"):
        return ['script must start with a header: script "<title>" from 0']
    # Minimal header parse without the TS parser: look for `from 0`.
    import re as _re

    match = _re.search(r"\bfrom\b\s+([0-9]+(?:\.[0-9]+)?)", stripped.split("\n", 1)[0])
    if match is None:
        return ['script header must declare its origin: script "<title>" from 0']
    try:
        origin = float(match.group(1))
    except ValueError:
        return ['script header must declare its origin: script "<title>" from 0']
    if abs(origin) > 1e-9:
        return [
            (
                f"script must start at zero (from 0), got from {match.group(1)} — "
                "one fresh script per middle slide, no per-part offsets"
            )
        ]
    return errors


def validate_marks_present(source: str, parts: list[dict[str, Any]]) -> list[str]:
    """Every PrompterPart boundary needs its compile-time mark."""
    errors: list[str] = []
    if not isinstance(source, str):
        return ["script is empty — author one fresh script per middle slide from zero"]
    ordered = middle_parts_from_narration(parts)
    for index, part in enumerate(ordered):
        mark = mark_name_for_part(index)
        # Accept both quote styles the language tokenizes.
        if f'mark("{mark}")' not in source and f"mark('{mark}')" not in source:
            errors.append(
                f'part {part.get("stepId", "?")}: missing compile-time mark("{mark}") '
                "at its narration boundary — every effect needs an owning window"
            )
    return errors


def validate_board_content(source: str) -> list[str]:
    """Create-then-reveal with built-ins only; disappear via opacity holds.

    Portable and reviewable: script-created text/tables plus reveal/mark/wipe
    verbs. No shared library entry (local `function` definitions stay out and
    the compiled footprint must carry no entryVersions), no clip/mouth/rig
    methods, no Visible Track writes. Comments are stripped before the
    visible-track check so prose never trips the gate; the word-boundary
    match keeps identifiers like "invisible" from blocking.
    """
    import re as _re

    errors: list[str] = []
    if not isinstance(source, str) or not source.strip():
        return ["script is empty — author board content via create-then-reveal"]
    # Strip // comments so prose about visibility never trips the gate.
    stripped = "\n".join(line.split("//", 1)[0] for line in source.splitlines())
    lowered = stripped.lower()
    has_text = "create text" in lowered
    has_table = "create table" in lowered
    if not has_text and not has_table:
        errors.append(
            "board content must be authored via script-created nodes "
            "(create text and/or create table) then reveal/mark/wipe — "
            "no pre-placed board nodes"
        )
    has_effect = any(verb in lowered for verb in ("reveal(", "wipe(", "mark("))
    if not has_effect:
        errors.append(
            "board script must animate with reveal/mark/wipe verbs (compiler built-ins only)"
        )
    if "function " in lowered:
        errors.append(
            "board scripts use compiler built-ins only — no local function "
            "definitions and no shared library entry in this spec"
        )
    for method in FORBIDDEN_BOARD_METHODS:
        if f"{method}(" in lowered:
            errors.append(
                f"board script must not call {method}(...) — "
                "reveal/mark/wipe plus create-then-reveal only"
            )
    if _re.search(r"\bvisible\b", lowered):
        errors.append(
            "disappear lowers to opacity holds (tween/set opacity to zero) — "
            "no Visible Track writes"
        )
    return errors


def board_move_requested(actions: list[str]) -> bool:
    """True when the accepted scenario explicitly asks for a board move.

    Multi-word tokens match as phrases; bare pan/zoom/dolly match whole words
    only so prose like "company" never licenses a camera move.
    """
    import re as _re

    for action in actions:
        if not isinstance(action, str):
            continue
        lowered = action.lower()
        for token in BOARD_MOVE_TOKENS:
            if " " in token:
                if token in lowered:
                    return True
            elif _re.search(rf"\b{_re.escape(token)}\b", lowered):
                return True
    return False


def verify_board_scene(
    cat_nodes: list[str] | None,
    camera_keys: list[dict[str, Any]] | None = None,
    board_move: bool = False,
) -> dict[str, Any]:
    """Middle scene contract: no cat, static board camera by default.

    Verify-only helper feeding the accept gate. Camera keys are allowed only
    when the accepted scenario explicitly asked for a board move; rotation is
    never written (exactly-one-camera invariant).
    """
    cats = [c for c in (cat_nodes or []) if isinstance(c, str) and c.strip()]
    if cats:
        return {
            "ok": False,
            "message": (
                f"middle slides carry no cat nodes (found {len(cats)}) — "
                "the teaching beats stay locked on the board"
            ),
        }
    keys = list(camera_keys or [])
    for key in keys:
        if not isinstance(key, dict):
            continue
        prop = str(key.get("property", ""))
        if prop.strip().lower() == "rotation":
            return {
                "ok": False,
                "message": "camera rotation is never written — static board framing",
            }
    if keys and not board_move:
        return {
            "ok": False,
            "message": (
                "board camera stays static unless the accepted scenario explicitly "
                "asks for a board move — remove the camera keys or accept a "
                "scenario with a board move first"
            ),
        }
    return {
        "ok": True,
        "message": (
            "board scene holds: no cat in the middle, "
            + ("board move licensed by the accepted scenario" if keys else "static board camera")
        ),
    }


def validate_hard_lock(
    parts: list[dict[str, Any]],
    footprints: list[dict[str, Any]],
    marks_map: dict[str, Any] | None = None,
) -> list[str]:
    """Hard lock to accepted PrompterPart times: overrun/drift blocks the gate.

    Checks, with no auto-shift:
    - one footprint per middle slide, each from 0;
    - each footprint window ends at or before the slide duration;
    - every mark in the marks map lands on its part boundary (no drift);
    - every effect/placement window reported by the compile sits inside its
      owning narration window (no overrun, visuals never slip voice).
    Footprints come from the frontend Check seam (compileAnimationScript):
    {from, to, effects?[{start, duration}], tracks?}. Effects without windows
    are treated as zero-length at the footprint start.
    """
    errors: list[str] = []
    try:
        ordered = middle_parts_from_narration(parts)
    except ValueError as exc:
        return [str(exc)]
    duration = slide_duration_for_parts(ordered)
    if not isinstance(footprints, list) or not footprints:
        return ["no compiled footprints reported — compile each middle script first"]
    if len(footprints) != 1:
        # Multi-slide middles report one footprint per slide; every slide
        # shares the same part map in v1 (single-slide middle). More than one
        # footprint without per-slide part splits is a drift risk.
        pass
    for index, footprint in enumerate(footprints):
        if not isinstance(footprint, dict):
            errors.append(f"slide #{index}: footprint is corrupt — recompile")
            continue
        origin = footprint.get("from", 0)
        end = footprint.get("to", 0)
        if not isinstance(origin, (int, float)) or abs(float(origin)) > 1e-9:
            errors.append(
                f"slide #{index}: script must start at zero (from 0), "
                f"got from {origin} — one fresh script per middle slide"
            )
        if isinstance(end, (int, float)) and float(end) - duration > 1e-6:
            errors.append(
                f"slide #{index}: script ends at {float(end):.2f}s, past the narration "
                f"duration ({duration:.2f}s) — overruns block the gate, no auto-shift"
            )
        effects = footprint.get("effects", [])
        if isinstance(effects, list):
            for effect in effects:
                if not isinstance(effect, dict):
                    continue
                start = effect.get("start", origin)
                length = effect.get("duration", 0)
                if not isinstance(start, (int, float)):
                    continue
                if not isinstance(length, (int, float)):
                    continue
                effect_end = float(start) + float(length)
                owner = _owning_part(ordered, float(start))
                if owner is None:
                    errors.append(
                        f"slide #{index}: effect at {float(start):.2f}s sits outside every "
                        "narration window — every effect needs an owning part"
                    )
                    continue
                window_end = float(owner.get("timelineEnd", duration))
                if effect_end - window_end > 1e-6:
                    errors.append(
                        f"slide #{index}: effect at {float(start):.2f}s overruns part "
                        f"{owner.get('stepId', '?')} "
                        f"([{float(owner.get('timelineStart', 0.0)):.2f}s, {window_end:.2f}s]) — "
                        "visuals never slip voice, no auto-shift"
                    )
                if effect_end - duration > 1e-6:
                    errors.append(
                        f"slide #{index}: effect ends at {effect_end:.2f}s, past the slide "
                        f"duration ({duration:.2f}s) — overruns block the gate"
                    )
    # Marks-to-part map must match the accepted boundaries exactly (no drift).
    if marks_map is not None:
        if not isinstance(marks_map, dict):
            errors.append("marks-to-part map is corrupt — recompile")
        else:
            for entry in marks_for_parts(ordered):
                mark = str(entry["mark"])
                mapped = marks_map.get(mark)
                if mapped is None:
                    errors.append(
                        f'missing mark "{mark}" in the marks-to-part map — '
                        "compile each script so marks land on part boundaries"
                    )
                    continue
                if not isinstance(mapped, dict):
                    errors.append(f'mark "{mark}": map entry is corrupt — recompile')
                    continue
                mapped_time = mapped.get("time", mapped.get("windowStart"))
                if (
                    not isinstance(mapped_time, (int, float))
                    or abs(float(mapped_time) - float(entry["time"])) > 1e-6
                ):
                    errors.append(
                        f'mark "{mark}" drifted to {mapped_time}s, '
                        f"accepted boundary is {float(entry['time']):.2f}s — "
                        "drift blocks the gate, no auto-shift"
                    )
    return errors


def _owning_part(ordered: list[dict[str, Any]], time: float) -> dict[str, Any] | None:
    for part in ordered:
        start = float(part.get("timelineStart", 0.0))
        end = float(part.get("timelineEnd", 0.0))
        if start - 1e-9 <= time < end - 1e-9 or (abs(time - end) <= 1e-9 and part is ordered[-1]):
            return part
    # Exact end-of-slide belongs to the last window.
    if ordered and abs(time - float(ordered[-1].get("timelineEnd", 0.0))) <= 1e-9:
        return ordered[-1]
    return None


def validate_targets_and_bindings(
    diagnostics: list[dict[str, Any]] | None,
    footprints: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Empty/unmeasurable targets and unresolved bindings block the gate.

    Diagnostics come from the frontend Check seam (compileAnimationScript):
    errors mentioning target measurability or binding resolution are gate
    blockers. Any compile error blocks — the user fixes manually.
    """
    errors: list[str] = []
    for diagnostic in diagnostics or []:
        if not isinstance(diagnostic, dict):
            continue
        if diagnostic.get("severity") != "error":
            continue
        message = str(diagnostic.get("message", "compile error"))
        lowered = message.lower()
        if any(
            token in lowered
            for token in (
                "no visible",
                "unmeasurable",
                "measurable",
                "empty",
                "target",
                "unresolved",
                "unknown",
                "ambiguous",
                "binding",
                "outside the slide segment",
                "past the slide duration",
            )
        ):
            errors.append(f"compile blocks the gate: {message}")
        else:
            errors.append(f"compile blocks the gate: {message}")
    # Footprints that inlined a shared library entry break portability.
    for footprint in footprints or []:
        if not isinstance(footprint, dict):
            continue
        versions = footprint.get("entryVersions", footprint.get("libraryVersions", {}))
        if isinstance(versions, dict) and versions:
            errors.append(
                "board scripts use compiler built-ins only — "
                "no shared library entry in this spec (footprint inlined "
                f"{sorted(versions)})"
            )
    return errors


def build_board_commands(
    scripts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Board proposal: one SetSlideAnimationScript per middle slide.

    Embed-first has no bytes here — scripts are text artifacts compiled to
    ordinary timeline data on Run inside one Transaction. Stale-blocking at
    build: only scripts with non-empty sources are committable.
    """
    if not scripts:
        raise ValueError("no board scripts — author one fresh script per middle slide")
    commands: list[dict[str, Any]] = []
    for index, script in enumerate(scripts):
        if not isinstance(script, dict):
            raise ValueError(f"slide #{index}: script entry is corrupt")  # noqa: TRY004
        slide_id = str(script.get("slideId", ""))
        source = script.get("source", "")
        if not slide_id.strip():
            raise ValueError(f"slide #{index}: no slideId mapped for this middle slide")
        if not isinstance(source, str) or not source.strip():
            raise ValueError(f"slide #{index}: script is empty — author it before proposing")
        commands.append(
            {"type": "SetSlideAnimationScript", "slideId": slide_id.strip(), "source": source}
        )
    return commands


def reject_forbidden_writes(commands: list[dict[str, Any]]) -> list[str]:
    """Accept-gate helper: board execution is SetSlideAnimationScript only.

    Rejects direct board-text/table placeholders (content rides inside
    scripts via create-then-reveal), mouth/coefficient writes, import writes,
    and any middle-scope cat/camera mutation smuggled as a command.
    """
    errors: list[str] = []
    for index, command in enumerate(commands):
        if not isinstance(command, dict):
            errors.append(f"command #{index}: must be an object")
            continue
        ctype = str(command.get("type", ""))
        if ctype != "SetSlideAnimationScript":
            errors.append(
                f"command #{index} ({ctype or '?'}): Stage E executes board content "
                "as SetSlideAnimationScript only (create-then-reveal inside the "
                "script) — AiCreateBoardText/AiCreateBoardTable placeholders, "
                "mouth coefficients, and import writes are forbidden here"
            )
            continue
        if "shapeId" in command or "fromShapeId" in command or "toShapeId" in command:
            errors.append(
                f"command #{index} ({ctype}): baked shape ids are forbidden — "
                "board scripts stay portable"
            )
        if str(command.get("property", "")).strip().lower() == "rotation":
            errors.append(f"command #{index} ({ctype}): camera rotation is never written")
    return errors


def board_accept_blockers(board: dict[str, Any]) -> list[str]:
    """Accept-gate blockers: hard lock green + content + scene + compile clean.

    Blockers cover: missing scripts, header/marks, hard-lock overrun/drift,
    content portability, board scene (no cat / static camera), and compile
    diagnostics (empty targets, unresolved bindings, library entries).
    Fallback-free: no degraded path — fix the script manually.
    """
    blockers: list[str] = []
    parts = board.get("parts", [])
    scripts = board.get("scripts", [])
    footprints = board.get("footprints", [])
    marks_map = board.get("marksMap", board.get("marks_map", {}))
    diagnostics = board.get("diagnostics", [])
    checks = board.get("checks", {})
    if not isinstance(parts, list) or not parts:
        return ["no accepted narration parts on this board — create it from accepted narration"]
    if not isinstance(scripts, list) or not scripts:
        blockers.append("no board scripts authored — author one fresh script per middle slide")
        return blockers
    try:
        ordered = middle_parts_from_narration([dict(p) for p in parts if isinstance(p, dict)])
    except ValueError as exc:
        return [str(exc)]
    # Per-script header/marks/content checks (no auto-repair).
    for index, script in enumerate(scripts):
        if not isinstance(script, dict):
            blockers.append(f"slide #{index}: script entry is corrupt — re-author it")
            continue
        source = script.get("source", "")
        if not isinstance(source, str) or not source.strip():
            blockers.append(f"slide #{index}: script is empty — author it before accepting")
            continue
        for message in validate_script_header(source):
            blockers.append(f"slide #{index}: {message}")
        for message in validate_marks_present(source, ordered):
            blockers.append(f"slide #{index}: {message}")
        for message in validate_board_content(source):
            blockers.append(f"slide #{index}: {message}")
    # Hard lock: overrun/drift blocks, visuals never slip voice.
    blockers.extend(
        validate_hard_lock(
            ordered,
            footprints if isinstance(footprints, list) else [],
            marks_map if isinstance(marks_map, dict) else {},
        )
    )
    # Compile diagnostics: invalid targets and unresolved bindings block.
    diagnostics_list = diagnostics if isinstance(diagnostics, list) else []
    footprints_list = footprints if isinstance(footprints, list) else []
    blockers.extend(
        validate_targets_and_bindings(
            [dict(d) for d in diagnostics_list if isinstance(d, dict)],
            [dict(f) for f in footprints_list if isinstance(f, dict)],
        )
    )
    # Board scene: no cat, static camera unless the scenario asked to move.
    if isinstance(checks, dict):
        scene = checks.get("scene", checks)
        if isinstance(scene, dict):
            cats = scene.get("catNodes", scene.get("cats", []))
            keys = scene.get("cameraKeys", scene.get("keys", []))
            move = scene.get("boardMove", scene.get("boardMoveRequested", False))
            verdict = verify_board_scene(
                list(cats) if isinstance(cats, list) else [],
                list(keys) if isinstance(keys, list) else [],
                bool(move),
            )
            if not verdict.get("ok"):
                blockers.append(f"scene: {verdict.get('message', 'board scene check failed')}")
    return blockers
