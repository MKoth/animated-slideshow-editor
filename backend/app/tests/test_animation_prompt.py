from app.ai.library import AiLibrary
from app.ai.prompting import ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS
from app.api.ai import (
    _ROOM_MODES,
    _effective_assistant_mode,
    _proposal_asset_instructions,
    _scenario_blackboard_context,
    _system_prompt_for_mode,
)
from app.config import (
    DEFAULT_ANIMATION_SYSTEM_PROMPT,
    DEFAULT_AUDIO_SYSTEM_PROMPT,
    DEFAULT_BLACKBOARD_SYSTEM_PROMPT,
    DEFAULT_COLLECTION_SYSTEM_PROMPT,
    DEFAULT_SCENARIO_SYSTEM_PROMPT,
    DEFAULT_SHAPE_SYSTEM_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
)


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


def test_animation_prompt_teaches_member_call_syntax() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "animation")

    # Exact bind forms for all three resource kinds, by exact name.
    assert 'bind cat = node("Cat")' in prompt
    assert "bind wave = clip(" in prompt
    assert "bind moves = collection(" in prompt
    # Member calls with a dot — the only legal action lines.
    assert "cat.play(wave)" in prompt
    assert "cat.apply(moves)" in prompt
    assert "cat.tween(" in prompt
    # Bare prose verbs are named only to forbid them.
    assert "`jump`" in prompt
    assert "compile errors, never methods" in prompt
    # Stages point at the split assistants, not the legacy Lesson tab.
    assert "Scenario, Audio, and Blackboard assistants" in prompt
    assert "Lesson assistant" not in prompt
    # Repair mode: a validation-failure turn carries its own specification.
    assert "failed source quoted in that message is the specification" in prompt
    assert "never re-ask for node, clip, or collection" in prompt


def test_animation_coverage_rules_also_apply_to_custom_prompts() -> None:
    prompt = _system_prompt_for_mode("Custom animation guidance", "animation")

    assert prompt.startswith("Custom animation guidance")
    assert ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS in prompt
    assert (
        _system_prompt_for_mode("Custom scenario guidance", "scenario")
        == "Custom scenario guidance"
    )


def test_shape_prompt_scopes_to_single_shape_step() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "shape").lower()

    assert "shape" in prompt
    assert "vertex count" in prompt
    assert "sourceshapeid" in prompt.replace(" ", "")
    assert "animation script" in prompt  # named only to forbid it
    assert ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS not in _system_prompt_for_mode(
        DEFAULT_SYSTEM_PROMPT, "shape"
    )


def test_collection_prompt_scopes_to_clips_and_collections() -> None:
    prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "collection").lower()

    assert "semantic name" in prompt
    assert "normalized keyframe" in prompt or "normalized clip" in prompt or "normalize" in prompt
    assert "shape" in prompt  # named only to forbid vertex edits
    # Exact track vocabulary — rotation is plain rotation, never rotationX/Y/Z.
    assert "positiony" in prompt.replace(" ", "")
    assert "rotation" in prompt
    assert "rotationx" in prompt.replace(" ", "")  # named only to forbid the spelling
    assert "clip-batch" in prompt


def test_custom_prompt_wins_for_shape_and_collection_modes() -> None:
    assert _system_prompt_for_mode("Custom shape guidance", "shape") == "Custom shape guidance"
    assert (
        _system_prompt_for_mode("Custom collection guidance", "collection")
        == "Custom collection guidance"
    )


def test_mode_normalization_passes_through_new_modes() -> None:
    assert AiLibrary.normalize_conversation_mode("shape") == "shape"
    assert AiLibrary.normalize_conversation_mode("collection") == "collection"
    assert AiLibrary.normalize_conversation_mode("animation") == "animation"
    assert AiLibrary.normalize_conversation_mode("scenario") == "scenario"
    assert AiLibrary.normalize_conversation_mode("audio") == "audio"
    assert AiLibrary.normalize_conversation_mode("blackboard") == "blackboard"
    # Legacy lesson plus unknown/missing modes read as scenario.
    assert AiLibrary.normalize_conversation_mode("lesson") == "scenario"
    assert AiLibrary.normalize_conversation_mode("bogus") == "scenario"
    assert AiLibrary.normalize_conversation_mode(None) == "scenario"


def test_effective_mode_prefers_explicit_shape_or_collection() -> None:
    assert _effective_assistant_mode("shape", "scenario") == "shape"
    assert _effective_assistant_mode("collection", "animation") == "collection"
    assert _effective_assistant_mode("scenario", "audio") == "scenario"
    assert _effective_assistant_mode("audio", "scenario") == "audio"
    assert _effective_assistant_mode("blackboard", "scenario") == "blackboard"
    assert _effective_assistant_mode(None, "shape") == "shape"
    assert _effective_assistant_mode(None, "audio") == "audio"
    assert _effective_assistant_mode(None, "bogus") == "scenario"
    assert _effective_assistant_mode(None, "lesson") == "scenario"


def test_shape_and_collection_defaults_differ_from_animation() -> None:
    assert DEFAULT_SHAPE_SYSTEM_PROMPT != DEFAULT_ANIMATION_SYSTEM_PROMPT
    assert DEFAULT_COLLECTION_SYSTEM_PROMPT != DEFAULT_ANIMATION_SYSTEM_PROMPT
    assert DEFAULT_SHAPE_SYSTEM_PROMPT != DEFAULT_COLLECTION_SYSTEM_PROMPT
    assert DEFAULT_SCENARIO_SYSTEM_PROMPT != DEFAULT_ANIMATION_SYSTEM_PROMPT
    assert DEFAULT_AUDIO_SYSTEM_PROMPT != DEFAULT_BLACKBOARD_SYSTEM_PROMPT
    assert DEFAULT_SCENARIO_SYSTEM_PROMPT != DEFAULT_AUDIO_SYSTEM_PROMPT


def test_scenario_audio_blackboard_prompts_scope_to_their_stages() -> None:
    scenario = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "scenario").lower()
    assert "scenario markdown doc" in scenario
    assert "high-level lesson plan" not in scenario
    # Blackboard-only: no legacy action-scenario block with staged directions.
    assert "action scenario" not in scenario
    assert "intro/middle/outro" not in scenario
    assert "blackboard" in scenario
    # Room constructs are named only to forbid them in this mode.
    assert "on-screen actions" in scenario
    assert "never claim a mutation happened before approval" in scenario
    assert ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS not in _system_prompt_for_mode(
        DEFAULT_SYSTEM_PROMPT, "scenario"
    )

    audio = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "audio").lower()
    assert "speech" in audio
    assert "prompter" in audio or "voice" in audio
    assert "per-part" in audio or "per part" in audio
    assert "never claim a mutation happened before approval" in audio
    assert ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS not in _system_prompt_for_mode(
        DEFAULT_SYSTEM_PROMPT, "audio"
    )

    board = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, "blackboard").lower()
    assert "blackboard" in board
    assert "never claim a mutation happened before approval" in board
    assert ANIMATION_REQUEST_COVERAGE_INSTRUCTIONS not in _system_prompt_for_mode(
        DEFAULT_SYSTEM_PROMPT, "blackboard"
    )

    assert _system_prompt_for_mode("Custom audio guidance", "audio") == "Custom audio guidance"
    assert (
        _system_prompt_for_mode("Custom blackboard guidance", "blackboard")
        == "Custom blackboard guidance"
    )


def test_shape_and_collection_prompts_describe_draft_button_flow() -> None:
    assert "Draft this shape button" in DEFAULT_SHAPE_SYSTEM_PROMPT
    assert "shape-step" in DEFAULT_SHAPE_SYSTEM_PROMPT
    assert "transform: rotate" in DEFAULT_SHAPE_SYSTEM_PROMPT
    assert "Draft collection proposal button" in DEFAULT_COLLECTION_SYSTEM_PROMPT
    assert "Never claim a mutation happened before approval" in DEFAULT_SHAPE_SYSTEM_PROMPT
    assert "Never claim a mutation happened before approval" in DEFAULT_COLLECTION_SYSTEM_PROMPT


def test_proposal_asset_instructions_are_mode_scoped() -> None:
    assert _proposal_asset_instructions("scenario") == ""
    assert _proposal_asset_instructions("audio") == ""
    assert _proposal_asset_instructions("blackboard") == ""
    assert _proposal_asset_instructions("lesson") == ""
    assert _proposal_asset_instructions("bogus") == ""

    animation = _proposal_asset_instructions("animation")
    assert "AiAnimationAssetBatch" in animation

    shape = _proposal_asset_instructions("shape")
    assert "AiAnimationAssetBatch" in shape
    assert "vertex count" in shape.lower()
    assert "Do not emit Clip" in shape
    assert "ClipCollectionJSON" not in shape
    assert '"operations"' in shape
    assert '"kind": "upsertShape"' in shape
    assert "shape.create" in shape  # named only to forbid the flat format

    collection = _proposal_asset_instructions("collection")
    assert "AiAnimationAssetBatch" in collection
    assert "Semantic Names" in collection
    assert "Do not emit Shape" in collection
    assert '"operations"' in collection
    assert '"kind": "upsertClip"' in collection
    assert '"kind": "upsertCollection"' in collection


def test_every_mode_prompt_teaches_ask_blocks() -> None:
    for mode in ("scenario", "audio", "blackboard", "animation", "shape", "collection"):
        prompt = _system_prompt_for_mode(DEFAULT_SYSTEM_PROMPT, mode)
        assert "```ask" in prompt, mode
        assert "kind: single|multi|text" in prompt, mode
        assert "allowCustom" in prompt, mode
        assert "one block per question" in prompt, mode
        assert "example" in prompt, mode
        assert "detail:" in prompt, mode


def test_animation_ask_blocks_keep_two_phase_policy() -> None:
    assert "## Open questions" in DEFAULT_ANIMATION_SYSTEM_PROMPT
    assert "instead of prose bullets" in DEFAULT_ANIMATION_SYSTEM_PROMPT


def test_scenario_blackboard_context_drops_room_keys() -> None:
    """Blackboard-only scenario view: room keys go, lesson + doc stay."""
    assert _ROOM_MODES == frozenset({"animation", "shape", "collection"})
    context = _scenario_blackboard_context(
        {
            "projectName": "Lesson",
            "slides": [{"name": "Intro"}],
            "activeSlideName": "Intro",
            "activeSlideDuration": 10,
            "sceneNodes": ["living-room [n-1]"],
            "selection": ["n-1"],
            "materials": ["chalk"],
            "shaders": ["grain"],
            "clips": ["Pop"],
            "assets": ["living-room"],
            "clipCollections": ["Walking"],
            "audio": ["take-1"],
            "embeddedAudio": ["take-1"],
            "animation": {"timeline": {"duration": 10}},
            "animationAssistantAssets": [],
            "scenarioMarkdown": "## Step 1 -- Hi",
            "scenarioActiveVersion": {"id": "v-1"},
        }
    )
    assert isinstance(context, dict)
    for dropped in (
        "sceneNodes",
        "selection",
        "materials",
        "shaders",
        "clips",
        "assets",
        "clipCollections",
        "audio",
        "embeddedAudio",
        "animation",
        "animationAssistantAssets",
        "activeSlideDuration",
    ):
        assert dropped not in context
    assert context["projectName"] == "Lesson"
    assert context["slides"] == [{"name": "Intro"}]
    assert context["scenarioMarkdown"] == "## Step 1 -- Hi"
    assert context["scenarioActiveVersion"] == {"id": "v-1"}


def test_scenario_blackboard_context_passes_through_non_dicts() -> None:
    assert _scenario_blackboard_context(None) is None
    assert _scenario_blackboard_context("raw") == "raw"
