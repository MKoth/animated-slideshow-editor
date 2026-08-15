from datetime import UTC, datetime
from uuid import uuid4

from app.config import Settings
from app.database import Database
from app.shaders.library import (
    ShaderLibrary,
    ShaderNotFoundError,
    ShaderProtectedError,
    ShaderValidationError,
    now_utc,
)
from app.shaders.model import BUILTIN_SHADER_NAMES, ShaderDefinition

FRAGMENT_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = color;
}
"""


def naive_utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=UTC).replace(tzinfo=None)


def seed_shader(database: Database, name: str, created_at: datetime) -> str:
    shader_id = str(uuid4())
    with database.session() as session:
        session.add(
            ShaderDefinition(
                id=shader_id,
                name=name,
                created_at=created_at,
                updated_at=created_at,
                source=FRAGMENT_SOURCE,
            )
        )
        session.commit()
    return shader_id


def create_library(settings: Settings) -> ShaderLibrary:
    from typing import cast

    from app.app_factory import AppFactory

    app = AppFactory(settings).create()
    return cast(ShaderLibrary, app.state.shader_library)


def test_builtins_are_seeded_on_startup(settings: Settings) -> None:
    library = create_library(settings)

    names = {definition.name for definition in library.list_all()}

    assert names == set(BUILTIN_SHADER_NAMES)


def test_seeding_is_idempotent(settings: Settings) -> None:
    create_library(settings)

    library = create_library(settings)

    assert {definition.name for definition in library.list_all()} == set(BUILTIN_SHADER_NAMES)
    assert len(library.list_all()) == len(BUILTIN_SHADER_NAMES)


def test_seeded_builtins_are_fragment_shaders_sampling_u_texture(settings: Settings) -> None:
    library = create_library(settings)

    for definition in library.list_all():
        assert "out vec4" in definition.source
        assert definition.is_builtin is True
        assert definition.default_uniforms == []
        if definition.name != "Gradient":
            assert "uniform sampler2D uTexture;" in definition.source
        else:
            assert "uniform sampler2D uTexture;" not in definition.source


def test_get_returns_the_seeded_definition(settings: Settings) -> None:
    database = Database(settings.database_url)
    library = create_library(settings)
    shader_id = seed_shader(database, "Frost", naive_utc(2026, 1, 1))

    definition = library.get(shader_id)

    assert definition.name == "Frost"
    assert definition.source == FRAGMENT_SOURCE
    assert definition.description == ""
    assert definition.tags == []
    assert definition.is_builtin is False
    assert definition.default_uniforms == []


def test_get_unknown_id_raises_not_found(settings: Settings) -> None:
    library = create_library(settings)

    try:
        library.get("ghost")
    except ShaderNotFoundError as exc:
        assert exc.args[0] == "ghost"
    else:
        raise AssertionError("expected ShaderNotFoundError")


def test_import_accepts_a_fragment_source(settings: Settings) -> None:
    library = create_library(settings)

    definition = library.import_source(
        name="Ink Wash",
        description="Hand drawn look",
        tags=["art"],
        source=FRAGMENT_SOURCE,
        now=naive_utc(2026, 2, 1),
    )

    assert definition.name == "Ink Wash"
    assert definition.description == "Hand drawn look"
    assert definition.tags == ["art"]
    assert definition.source == FRAGMENT_SOURCE
    assert definition.is_builtin is False
    assert library.get(definition.id).name == "Ink Wash"


def test_import_rejects_vertex_shader_content(settings: Settings) -> None:
    library = create_library(settings)

    try:
        library.import_source(
            name="Bad",
            description="",
            tags=[],
            source=(
                "#version 300 es\nin vec2 aPosition;\n"
                "void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }\n"
            ),
            now=naive_utc(2026, 2, 1),
        )
    except ShaderValidationError as exc:
        assert "vertex" in str(exc).lower()
    else:
        raise AssertionError("expected ShaderValidationError")


def test_import_rejects_es1_style_vertex_shader(settings: Settings) -> None:
    library = create_library(settings)

    try:
        library.import_source(
            name="Old",
            description="",
            tags=[],
            source="attribute vec2 aPosition;\nvoid main() { gl_Position = vec4(0.0); }\n",
            now=naive_utc(2026, 2, 1),
        )
    except ShaderValidationError as exc:
        assert "vertex" in str(exc).lower()
    else:
        raise AssertionError("expected ShaderValidationError")


def test_reupload_replaces_the_source_and_preserves_the_id(settings: Settings) -> None:
    library = create_library(settings)
    created = library.import_source(
        name="Ink Wash",
        description="",
        tags=[],
        source=FRAGMENT_SOURCE,
        now=naive_utc(2026, 2, 1),
    )
    replacement = FRAGMENT_SOURCE.replace(
        "fragColor = color;", "fragColor = vec4(1.0 - color.rgb, color.a);"
    )

    updated = library.reupload(created.id, source=replacement, now=naive_utc(2026, 2, 2))

    assert updated.id == created.id
    assert updated.name == created.name
    assert updated.source == replacement
    assert updated.created_at == created.created_at
    assert updated.updated_at > created.updated_at
    assert library.get(created.id).source == replacement


def test_reupload_unknown_id_raises_not_found(settings: Settings) -> None:
    library = create_library(settings)

    try:
        library.reupload("ghost", source=FRAGMENT_SOURCE, now=naive_utc(2026, 2, 1))
    except ShaderNotFoundError as exc:
        assert exc.args[0] == "ghost"
    else:
        raise AssertionError("expected ShaderNotFoundError")


def test_duplicate_copies_definition_under_a_new_id(settings: Settings) -> None:
    library = create_library(settings)
    source = library.import_source(
        name="Ink Wash",
        description="Hand drawn look",
        tags=["art"],
        source=FRAGMENT_SOURCE,
        now=naive_utc(2026, 2, 1),
    )

    copy = library.duplicate("Ink Wash Copy", source.id, now=naive_utc(2026, 2, 2))

    assert copy.id != source.id
    assert copy.name == "Ink Wash Copy"
    assert copy.description == source.description
    assert copy.tags == source.tags
    assert copy.source == source.source
    assert copy.is_builtin is False
    assert library.get(source.id).source == source.source


def test_rename_updates_name_and_bumps_updated_at(settings: Settings) -> None:
    library = create_library(settings)
    created = library.import_source(
        name="Ink Wash",
        description="",
        tags=[],
        source=FRAGMENT_SOURCE,
        now=naive_utc(2026, 2, 1),
    )

    renamed = library.rename(created.id, "Wash", now=naive_utc(2026, 2, 3))

    assert renamed.id == created.id
    assert renamed.name == "Wash"
    assert renamed.source == FRAGMENT_SOURCE
    assert renamed.updated_at > created.updated_at


def test_delete_removes_only_the_target_shader(settings: Settings) -> None:
    database = Database(settings.database_url)
    library = create_library(settings)
    first = seed_shader(database, "First", naive_utc(2026, 1, 1))
    second = seed_shader(database, "Second", naive_utc(2026, 1, 2))

    library.delete(first)

    remaining = [definition.id for definition in library.list_all()]
    assert first not in remaining
    assert second in remaining


def test_delete_of_a_builtin_is_protected(settings: Settings) -> None:
    library = create_library(settings)
    grayscale = next(
        definition for definition in library.list_all() if definition.name == "Grayscale"
    )

    try:
        library.delete(grayscale.id)
    except ShaderProtectedError as exc:
        assert "built-in" in str(exc).lower()
    else:
        raise AssertionError("expected ShaderProtectedError")
    assert library.get(grayscale.id).name == "Grayscale"


def test_delete_unknown_id_raises_not_found(settings: Settings) -> None:
    library = create_library(settings)

    try:
        library.delete("ghost")
    except ShaderNotFoundError as exc:
        assert exc.args[0] == "ghost"
    else:
        raise AssertionError("expected ShaderNotFoundError")


def test_definitions_survive_restart(settings: Settings) -> None:
    library = create_library(settings)
    created = library.import_source(
        name="Ink Wash",
        description="Hand drawn look",
        tags=["art"],
        source=FRAGMENT_SOURCE,
        now=now_utc(),
    )

    restarted = create_library(settings)
    stored = restarted.get(created.id)

    assert stored.name == "Ink Wash"
    assert stored.description == "Hand drawn look"
    assert stored.tags == ["art"]
    assert stored.source == FRAGMENT_SOURCE
    assert stored.is_builtin is False
