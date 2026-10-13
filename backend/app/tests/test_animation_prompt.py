from app.ai.prompting import ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS
from app.api.ai import _system_prompt_for_mode
from app.config import DEFAULT_ANIMATION_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT


def test_animation_prompt_preserves_full_conversation_requirements() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "animation").lower()

    assert "every user message in the conversation as an active requirement" in prompt
    assert "it does not replace earlier requested actions" in prompt
    assert "every requirement must appear in both the proposed beats and the script" in prompt
    assert "one part of the sequence, not a substitute for the rest" in prompt
    assert "do not present an incomplete sequence as if it satisfies the request" in prompt
    assert (
        "cross-check the script timeline against every proposed beat and the full conversation"
        in prompt
    )
    assert prompt.startswith(DEFAULT_ANIMATION_SYSTEM_PROMPT.lower())


def test_animation_coverage_rules_also_apply_to_custom_prompts() -> None:
    prompt = _system_prompt_for_mode("Custom animation guidance", "animation")

    assert prompt.startswith("Custom animation guidance")
    assert ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS in prompt
    assert _system_prompt_for_mode("Custom lesson guidance", "lesson") == "Custom lesson guidance"
