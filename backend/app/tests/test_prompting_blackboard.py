"""Blackboard focus context rendering (issue #472)."""

from __future__ import annotations

from app.ai.prompting import context_to_text


def test_active_slide_id_and_length_render() -> None:
    text = context_to_text(
        {
            "projectName": "Lesson",
            "activeSlideName": "Step 1",
            "activeSlideId": "s-1",
            "activeSlideDuration": 4.5,
            "slides": [{"id": "s-1", "name": "Step 1"}],
        }
    )
    assert "Step 1" in text
    assert "s-1" in text
    assert "4.5s" in text


def test_blackboard_focus_renders_blocks_and_fractions() -> None:
    text = context_to_text(
        {
            "activeSlideName": "Intro",
            "activeSlideId": "s-1",
            "activeSlideDuration": 4,
            "blackboardFocus": {
                "slideId": "s-1",
                "slideName": "Intro",
                "duration": 4,
                "promptBlocks": [
                    {"id": "pp-1", "start": 0, "end": 4, "text": "Ser is for who you are."}
                ],
                "actions": [
                    {"action": "reveal(text1)", "block": "pp-1", "fraction": 0.3125},
                    {"action": "carry(oaktree)", "block": "pp-1", "fraction": 0.8125},
                ],
            },
        }
    )
    assert "blackboard focus slide: s-1" in text
    assert "pp-1" in text
    assert "Ser is for who you are" in text
    assert "reveal(text1) @ pp-1" in text
    assert "carry(oaktree) @ pp-1" in text


def test_malformed_focus_renders_no_crash() -> None:
    text = context_to_text({"blackboardFocus": {"unexpected": True}})
    assert isinstance(text, str)
