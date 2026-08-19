from datetime import UTC, datetime
from typing import Any, cast

from app.app_factory import AppFactory
from app.clips.library import ClipLibrary, ClipProtectedError
from app.clips.model import (
    BUILTIN_CLIP_NAMES,
    BUILTIN_CLIPS,
    ClipDefinition,
)
from app.config import Settings
from app.database import Database


def naive_utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=UTC).replace(tzinfo=None)


def create_library(settings: Settings) -> ClipLibrary:
    app = AppFactory(settings).create()
    return cast(ClipLibrary, app.state.clip_library)


def test_builtins_are_seeded_on_startup(settings: Settings) -> None:
    library = create_library(settings)

    names = {definition.name for definition in library.list_all()}

    assert names == set(BUILTIN_CLIP_NAMES)


def test_seeding_is_idempotent(settings: Settings) -> None:
    create_library(settings)

    library = create_library(settings)

    assert {definition.name for definition in library.list_all()} == set(BUILTIN_CLIP_NAMES)
    assert len(library.list_all()) == len(BUILTIN_CLIP_NAMES)


def test_all_21_builtins_are_seeded(settings: Settings) -> None:
    library = create_library(settings)

    assert len(library.list_all()) == 21
    assert len(BUILTIN_CLIP_NAMES) == 21


def test_seeded_builtins_have_correct_metadata(settings: Settings) -> None:
    library = create_library(settings)

    for builtin in BUILTIN_CLIPS:
        definition = library.get(str(builtin["id"]))
        assert definition.name == str(builtin["name"])
        assert definition.duration == float(cast(float, builtin["duration"]))
        assert definition.category == str(builtin["category"])
        assert definition.is_builtin is True
        assert definition.seed_version == 1


def test_seeded_builtins_have_channel_animations(settings: Settings) -> None:
    library = create_library(settings)

    for builtin in BUILTIN_CLIPS:
        definition = library.get(str(builtin["id"]))
        assert definition.channel_animations is not None
        assert len(definition.channel_animations) > 0
        for channel_data in definition.channel_animations.values():
            assert "keyframes" in channel_data
            keyframes = cast(Any, channel_data["keyframes"])
            assert len(keyframes) > 0
            for kf in keyframes:
                assert "id" in kf
                assert "time" in kf
                assert "value" in kf
                assert "interpolation" in kf


def test_seeded_builtins_have_correct_channels(settings: Settings) -> None:
    library = create_library(settings)

    for builtin in BUILTIN_CLIPS:
        definition = library.get(str(builtin["id"]))
        expected_channels = [
            ch["property"] for ch in cast(list[dict[str, object]], builtin["channels"])
        ]
        actual_channels = [ch["property"] for ch in definition.channels]
        assert actual_channels == expected_channels


def test_delete_of_a_builtin_is_protected(settings: Settings) -> None:
    library = create_library(settings)
    fade_in = next(definition for definition in library.list_all() if definition.name == "Fade In")

    try:
        library.delete(fade_in.id)
    except ClipProtectedError as exc:
        assert "built-in" in str(exc).lower()
    else:
        raise AssertionError("expected ClipProtectedError")
    assert library.get(fade_in.id).name == "Fade In"


def test_user_clips_can_be_deleted(settings: Settings) -> None:
    library = create_library(settings)
    now = naive_utc(2026, 1, 1)

    created = library.create(
        clip_id="user-clip",
        name="My Clip",
        duration=1.0,
        category="custom",
        params=[],
        channels=[],
        channel_animations=None,
        now=now,
    )

    library.delete(created.id)

    from app.clips.library import ClipNotFoundError

    try:
        library.get(created.id)
    except ClipNotFoundError:
        pass
    else:
        raise AssertionError("expected ClipNotFoundError after delete")


def test_builtins_survive_restart(settings: Settings) -> None:
    library = create_library(settings)
    initial_names = {definition.name for definition in library.list_all()}

    restarted = create_library(settings)

    restarted_names = {definition.name for definition in restarted.list_all()}
    assert restarted_names == initial_names
    assert len(restarted.list_all()) == 21


def test_seed_upgrades_a_stale_builtin_in_place(settings: Settings) -> None:
    fade_in_id = next(
        str(builtin["id"]) for builtin in BUILTIN_CLIPS if builtin["name"] == "Fade In"
    )
    database = Database(settings.database_url)
    create_library(settings)
    with database.session() as session:
        definition = session.get(ClipDefinition, fade_in_id)
        assert definition is not None
        definition.name = "Legacy Fade In"
        definition.seed_version = None
        session.commit()

    library = create_library(settings)

    definition = library.get(fade_in_id)
    assert definition.name == "Fade In"
    assert definition.seed_version == 1


def test_seeded_clip_ids_are_deterministic(settings: Settings) -> None:
    library = create_library(settings)

    first_ids = {definition.id for definition in library.list_all()}

    restarted = create_library(settings)

    second_ids = {definition.id for definition in restarted.list_all()}
    assert first_ids == second_ids
