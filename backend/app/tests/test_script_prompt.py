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
    # Conversation story (own history) is ground truth.
    assert "conversation story" in lowered


def test_script_prompt_teaches_cursor_setup_and_reveal_pairing() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "script")
    lowered = prompt.lower()
    # Setup/styling calls after marks land at end-of-slide.
    assert "before the first `mark(...)" in prompt
    assert "at: 0" in prompt
    # Every created node needs a reveal; wipes pair with reveals.
    assert "never emit creates without pairing reveals" in lowered
    assert "never wipe a node that has no reveal" in lowered
    # Full-block-or-continue policy against truncation.
    assert "never a prefix cut off by length" in lowered
    # Target marks need an explicit visual and a measurable target.
    assert "`mark(target" in lowered or "mark(target, ...)" in lowered
    assert "explicit `visual`" in prompt
    assert "never carried pictures" in lowered
    # Table teardown is one subtree wipe, never cell-by-cell plus table.
    assert "wipe(subtree(" in lowered
    assert "never cell by cell" in lowered
    assert "nodeonly(table)" in lowered
    assert "reveal(table)" in lowered and "descendant cell text" in lowered
    assert "do not add mask-setup wipes" in lowered


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
