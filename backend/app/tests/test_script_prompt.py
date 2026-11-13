from fastapi.testclient import TestClient

from app.ai.library import AiLibrary
from app.ai.prompting import context_to_text
from app.api.ai import _effective_assistant_mode, _system_prompt_for_mode
from app.config import DEFAULT_SCRIPT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT


def test_script_mode_normalization() -> None:
    assert AiLibrary.normalize_conversation_mode("script") == "script"
    # Unknown modes still read as scenario.
    assert AiLibrary.normalize_conversation_mode("bogus") == "scenario"


def test_effective_mode_prefers_explicit_or_stored_script() -> None:
    assert _effective_assistant_mode("script", "scenario") == "script"
    assert _effective_assistant_mode(None, "script") == "script"


def test_script_prompt_is_its_own_default() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    assert prompt == DEFAULT_SCRIPT_SYSTEM_PROMPT
    assert _system_prompt_for_mode("Custom script guidance", "script") == "Custom script guidance"


def test_script_prompt_teaches_ask_blocks() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    assert "```ask" in prompt
    assert "kind: single|multi|text" in prompt
    assert "allowCustom" in prompt
    assert "one block per question" in prompt


def test_script_prompt_knows_slide_scope_and_syntax() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    # One slide only.
    assert "one slide" in lowered
    assert "other slides stay untouched" in lowered
    # Ask-first policy: never script + questions in the same turn.
    assert "never send a full revised script plus clarifying questions" in lowered
    # Proposal flow, not direct edits.
    assert "never claim a mutation happened before approval" in lowered
    assert "draft this script" in lowered
    assert "```engine-command" in prompt
    # Narration-fit editing rules.
    assert "never appears before its mention" in lowered or "only once spoken about" in lowered
    assert "mark(" in lowered
    # Repair mode: quoted failed source is the specification.
    assert "failed source quoted in that message is the specification" in lowered
    # Conversation history is retained but old script bodies are compacted.
    assert "conversation history" in lowered
    assert "line counts" in lowered
    assert "latest prior assistant script stays intact" in lowered
    assert "script focus wins" in lowered


def test_script_prompt_teaches_cursor_setup_and_reveal_pairing() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    # Setup/styling calls after marks land at end-of-slide.
    assert "before the first `mark(...)" in prompt
    assert "numeric segment start" in prompt
    assert "never use `at(0)` when `from` is later" in prompt
    # fadeIn/fadeOut/pulse accept effect-verb named timing; other calls must not.
    assert "fadeout(at:" in lowered
    assert "never write other member calls that way" in lowered
    # Every created node needs a reveal; wipes pair with reveals.
    assert "never emit creates without pairing reveals" in lowered
    assert "never wipe a node that has no reveal" in lowered
    # Full-block-or-continue policy against truncation.
    assert "never a prefix cut off by length" in lowered
    # Target marks need a measurable target; visual is optional (built-in marker by default).
    assert "`mark(target" in lowered or "mark(target, ...)" in lowered
    assert "explicit `visual`" in prompt
    assert "visual` is optional" in lowered
    assert "never carried pictures" in lowered
    # mark() takes no wobble/direction — writing them is a compile error.
    assert "no wobble or direction" in lowered
    assert "unknown mark option" in lowered
    # Table teardown is one subtree wipe, never cell-by-cell plus table.
    assert "wipe(subtree(" in lowered
    assert "never cell by cell" in lowered
    assert "nodeonly(table)" in lowered
    assert "reveal(table)" in lowered and "descendant cell text" in lowered
    assert "do not add mask-setup wipes" in lowered
    # Opacity gestures are not scene effects and cannot take their visual or wobble options.
    assert "they are opacity-only gestures" in lowered
    assert "never ask the user to choose visual or wobble options" in lowered


def test_script_prompt_defines_prompter_markers_and_uses_tested_effect_recipes() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    assert "for each prompter block whose start is at or after the script segment start" in lowered
    assert '`at(<block-start>) mark("part-n")`' in lowered
    assert "do not define or reference a marker for that earlier block" in lowered
    assert "preserve the existing `from` value when editing a script" in lowered
    assert 'before any `marktime("part-n")` reference' in lowered
    assert "visualscale: 4" in lowered and 'visualanchor: "top-center"' in lowered
    assert "wobblex: { from: 12, to: 24 }" in lowered
    assert "wobbley: { from: 8, to: 18 }" in lowered
    assert "wobblespeed: 7" in lowered
    assert "visual: emptyhand" in lowered


def test_script_prompt_respects_nonzero_segment_lower_bound() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script").lower()
    assert "the script header's `from` is the lower time bound" in prompt
    assert "preserve the existing `from` value when editing a script" in prompt
    assert "whose start is at or after the script segment start" in prompt
    assert "do not define or reference a marker for that earlier block" in prompt
    assert "never place an `at` or marker before `from`" in prompt
    assert "verify the result remains in [from, slide duration]" in prompt


def test_script_prompt_shows_literal_carry_positions_and_bounds_waits() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    assert "carry destinations must be literal position records" in lowered
    assert "to: { x: 340, y: 365 }" in lowered
    assert "never a node, bounds, or position alias" in lowered
    assert "every `wait(d)` advances the cursor" in lowered
    assert "it must end at or before the slide duration" in lowered
    assert "do not add a final wait just to fill the slide" in lowered


def test_script_prompt_teaches_positional_tint_syntax() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    assert '`alias.tint("#f5e6c8")`' in lowered
    assert "never write `tint(color: ...)`" in lowered
    assert "takes a positional color string" in lowered


def test_script_prompt_requires_varied_text_colors_and_end_cleanup() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    assert "visibly different colors for text labels and table cells" in lowered
    assert "do not tint every label or cell the same color" in lowered
    assert "single-color board is a defect" in lowered
    assert "clear temporary content by the slide's final second" in lowered
    assert "always wipe a table once with `wipe(subtree(table))`" in lowered
    assert "carry a small number of images out" in lowered
    assert "if there are many images, fade them out" in lowered
    assert "wipe a small number of labels" in lowered
    assert "if there are many labels, fade them out" in lowered


def test_script_prompt_uses_live_chalk_material_and_camera_measurements() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    assert "script scene frame" in lowered
    assert "active camera visible-world area" in lowered
    assert "renderer-measured node sizes" in lowered
    assert "material→shader links" in lowered
    assert "apply it to the blackboard with `board.material(chalk)`" in lowered
    assert "never silently omit the available chalk shader" in lowered
    # Camera is authoritative by default — never ask camera-geometry questions.
    assert "trust the active camera visible-world area as authoritative by default" in lowered
    assert "never emit camera-geometry clarifying questions" in lowered


def test_script_prompt_teaches_table_row_heights() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    assert "rowheight" in lowered
    assert "rowheights" in lowered
    assert "30px" in lowered or "30 px" in lowered


def test_script_focus_renders_source_blocks_and_diagnostics() -> None:
    text = context_to_text(
        {
            "projectName": "Demo",
            "scriptFocus": {
                "slideId": "slide-1",
                "slideName": "Intro",
                "duration": 12,
                "source": 'script "Intro" from 0\nhero.tween({ x: 1 }, 1)',
                "promptBlocks": [
                    {"id": "part-0", "start": 0, "end": 6, "text": "Hello there"},
                    {"id": "part-1", "start": 6, "end": 12, "text": "Look at the table"},
                ],
                "diagnostics": [
                    {"severity": "error", "line": 2, "column": 6, "message": "needs a duration"}
                ],
            },
        }
    )
    assert "script focus slide: slide-1" in text
    assert '"Intro"' in text
    assert "(12s)" in text
    assert 'script "Intro" from 0' in text
    assert 'part-0 [0-6s] "Hello there"' in text
    assert 'part-1 [6-12s] "Look at the table"' in text
    assert "check diagnostics:" in text
    assert "needs a duration" in text


def test_script_focus_does_not_truncate_current_editor_source() -> None:
    source = "x" * 7000 + "CURRENT_DRAFT_END"
    text = context_to_text({"scriptFocus": {"slideId": "slide-1", "source": source}})
    assert "CURRENT_DRAFT_END" in text


def test_script_focus_sends_all_prompt_blocks_without_early_cutoff() -> None:
    count = 80
    duration = 107.0
    blocks = [
        {
            "id": f"part-{index}",
            "start": index * duration / count,
            "end": (index + 1) * duration / count,
            "text": f"narration {index}",
        }
        for index in range(count)
    ]
    text = context_to_text(
        {
            "scriptFocus": {
                "slideId": "slide-1",
                "slideName": "Long",
                "duration": duration,
                "source": 'script "Long" from 0',
                "promptBlocks": blocks,
                "diagnostics": [],
            }
        }
    )
    assert text.count("part-") == count
    assert "part-79" in text
    assert "narration 79" in text


def test_script_scene_renders_camera_frame_geometry_and_shader_links() -> None:
    text = context_to_text(
        {
            "scriptScene": {
                "frame": {"width": 1920, "height": 1080},
                "camera": {
                    "id": "camera-1",
                    "name": "Camera",
                    "x": 100,
                    "y": 50,
                    "scaleX": 2,
                    "scaleY": 2,
                    "visibleWorldRect": {"left": 100, "top": 50, "right": 1060, "bottom": 590},
                },
                "nodes": [
                    {
                        "id": "board-1",
                        "name": "Blackboard",
                        "kind": "asset instance",
                        "world": {"x": 580, "y": 320, "scaleX": 1, "scaleY": 1},
                        "measuredSize": {"width": 900, "height": 500},
                        "material": "Chalk",
                        "shader": "Chalk",
                    }
                ],
                "materials": [{"name": "Chalk", "shader": "Chalk"}],
            }
        }
    )
    assert "1920×1080 world units" in text
    assert "visible world area x=100..1060, y=50..590" in text
    assert "Blackboard [board-1] (asset instance)" in text
    assert "renderer-measured size 900×500" in text
    assert "material Chalk (shader Chalk)" in text


def test_script_conversations_scope_to_slide(client: TestClient) -> None:
    first = client.post(
        "/api/ai/conversations",
        json={"projectId": "p1", "mode": "script", "slideId": "slide-1"},
    )
    assert first.status_code == 201, first.text
    assert first.json()["mode"] == "script"
    assert first.json()["slideId"] == "slide-1"

    second = client.post(
        "/api/ai/conversations",
        json={"projectId": "p1", "mode": "script", "slideId": "slide-2"},
    )
    assert second.status_code == 201, second.text

    only_first = client.get(
        "/api/ai/conversations",
        params={"projectId": "p1", "mode": "script", "slideId": "slide-1"},
    )
    assert only_first.status_code == 200, only_first.text
    assert [row["id"] for row in only_first.json()] == [first.json()["id"]]

    # Without a slide filter both slide conversations list; project
    # conversations never carry a slide id.
    project = client.post("/api/ai/conversations", json={"projectId": "p1", "mode": "scenario"})
    assert project.status_code == 201, project.text
    assert project.json().get("slideId") is None

    unfiltered = client.get("/api/ai/conversations", params={"projectId": "p1"})
    assert unfiltered.status_code == 200, unfiltered.text
    assert len(unfiltered.json()) == 3


def test_slide_conversation_bulk_delete(client: TestClient) -> None:
    for slide in ("slide-1", "slide-1", "slide-2"):
        r = client.post(
            "/api/ai/conversations",
            json={"projectId": "p1", "mode": "script", "slideId": slide},
        )
        assert r.status_code == 201, r.text
    first = client.get("/api/ai/conversations", params={"projectId": "p1", "mode": "script"})
    assert len(first.json()) == 3

    # slideId is required — no silent whole-project wipe.
    missing = client.delete("/api/ai/conversations", params={"projectId": "p1"})
    assert missing.status_code == 422, missing.text

    cleared = client.delete(
        "/api/ai/conversations",
        params={"projectId": "p1", "mode": "script", "slideId": "slide-1"},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json() == {"deleted": 2}

    remaining = client.get("/api/ai/conversations", params={"projectId": "p1", "mode": "script"})
    assert [row["slideId"] for row in remaining.json()] == ["slide-2"]


def test_script_focus_tolerates_malformed_input() -> None:
    # Malformed focus renders empty, so the context falls back to the
    # project line (or the JSON dump when nothing else renders).
    assert context_to_text({"projectName": "Demo", "scriptFocus": None}) == "project: Demo"
    assert context_to_text({"projectName": "Demo", "scriptFocus": "nope"}) == "project: Demo"
    text = context_to_text({"scriptFocus": {"slideId": "s-1"}})
    assert "s-1" in text
