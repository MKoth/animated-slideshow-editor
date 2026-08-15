from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import desc, select

from app.database import Database
from app.parameters import (
    RESERVED_UNIFORM_KEYS,
    ParameterValidationError,
    is_uniform_kind,
    normalize_parameter_default,
)
from app.shaders.model import BUILTIN_SHADERS, ShaderDefinition
from app.shaders.schemas import ShaderUniform

_VERTEX_MARKERS = re.compile(r"\b(gl_Position|gl_VertexID|gl_InstanceID)\b")
_ES1_ATTRIBUTE = re.compile(r"^\s*attribute\b", flags=re.MULTILINE)

_VERTEX_SHADER_MESSAGE = (
    "vertex shaders are not supported: the renderer uses a built-in pass-through transform; "
    "upload a fragment shader instead"
)


class ShaderNotFoundError(KeyError):
    """Raised when a shader id does not exist in the library."""


class ShaderValidationError(ValueError):
    """Raised when a shader payload is semantically invalid."""


class ShaderProtectedError(ValueError):
    """Raised when a protected built-in shader cannot be deleted."""


def _builtin_row_fields(builtin: dict[str, object]) -> dict[str, object]:
    """The canonical field values a built-in definition is seeded with."""
    return {
        "name": str(builtin["name"]),
        "description": str(builtin["description"]),
        "tags": list(cast(list[str], builtin["tags"])),
        "source": str(builtin["source"]),
        "default_uniforms": list(
            cast(list[dict[str, object]], builtin.get("default_uniforms", []))
        ),
        "seed_version": int(cast(int, builtin.get("seed_version", 1))),
    }


class ShaderLibrary:
    """I own the persistent library of shader definitions."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def ensure_seeded(self, now: datetime) -> None:
        """Seed the five protected built-ins.

        Creates missing built-ins; a built-in whose recorded seed_version is
        behind the canonical version is upgraded in place (source and uniform
        defaults replaced). User re-uploads to a current built-in survive —
        the version is only bumped when the canonical definition changes.
        """
        with self._database.session() as session:
            for builtin in BUILTIN_SHADERS:
                shader_id = str(builtin["id"])
                seed_version = int(cast(int, builtin.get("seed_version", 1)))
                definition = session.get(ShaderDefinition, shader_id)
                if definition is None:
                    session.add(
                        ShaderDefinition(
                            id=shader_id,
                            created_at=now,
                            updated_at=now,
                            is_builtin=True,
                            **_builtin_row_fields(builtin),
                        )
                    )
                elif definition.seed_version != seed_version:
                    definition.name = str(builtin["name"])
                    definition.description = str(builtin["description"])
                    definition.tags = list(cast(list[str], builtin["tags"]))
                    definition.source = str(builtin["source"])
                    definition.default_uniforms = list(
                        cast(list[dict[str, object]], builtin.get("default_uniforms", []))
                    )
                    definition.seed_version = seed_version
                    definition.updated_at = now
            session.commit()

    def list_all(self) -> list[ShaderDefinition]:
        statement = select(ShaderDefinition).order_by(
            desc(ShaderDefinition.created_at), ShaderDefinition.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, shader_id: str) -> ShaderDefinition:
        with self._database.session() as session:
            definition = session.get(ShaderDefinition, shader_id)
        if definition is None:
            raise ShaderNotFoundError(shader_id)
        return definition

    def import_source(
        self,
        name: str,
        description: str,
        tags: list[str],
        source: str,
        now: datetime,
    ) -> ShaderDefinition:
        _require_fragment_source(source)
        _require_non_empty(name, "name must not be empty")
        definition = ShaderDefinition(
            id=str(uuid4()),
            name=name,
            description=description,
            tags=tags,
            created_at=now,
            updated_at=now,
            source=source,
        )
        with self._database.session() as session:
            session.add(definition)
            session.commit()
        return definition

    def reupload(self, shader_id: str, source: str, now: datetime) -> ShaderDefinition:
        _require_fragment_source(source)
        with self._database.session() as session:
            definition = session.get(ShaderDefinition, shader_id)
            if definition is None:
                raise ShaderNotFoundError(shader_id)
            definition.source = source
            definition.updated_at = now
            session.commit()
        return definition

    def duplicate(self, name: str, source_id: str, now: datetime) -> ShaderDefinition:
        _require_non_empty(name, "name must not be empty")
        source = self.get(source_id)
        return self.import_source(
            name=name,
            description=source.description,
            tags=source.tags,
            source=source.source,
            now=now,
        )

    def rename(self, shader_id: str, name: str, now: datetime) -> ShaderDefinition:
        _require_non_empty(name, "name must not be empty")
        with self._database.session() as session:
            definition = session.get(ShaderDefinition, shader_id)
            if definition is None:
                raise ShaderNotFoundError(shader_id)
            definition.name = name
            definition.updated_at = now
            session.commit()
        return definition

    def update_default_uniforms(
        self,
        shader_id: str,
        uniforms: list[ShaderUniform],
        now: datetime,
    ) -> ShaderDefinition:
        """Replace the shader's editable uniform defaults.

        Each uniform must carry a supported uniform kind and a default matching
        its kind; keys must be unique and must not collide with the reserved
        source sampler or the material built-in parameter keys.
        """
        validated = _validate_uniforms(uniforms)
        with self._database.session() as session:
            definition = session.get(ShaderDefinition, shader_id)
            if definition is None:
                raise ShaderNotFoundError(shader_id)
            definition.default_uniforms = validated
            definition.updated_at = now
            session.commit()
        return definition

    def delete(self, shader_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(ShaderDefinition, shader_id)
            if definition is None:
                raise ShaderNotFoundError(shader_id)
            if definition.is_builtin:
                raise ShaderProtectedError(
                    f"shader {definition.name!r} is a built-in and cannot be deleted"
                )
            session.delete(definition)
            session.commit()


def _require_fragment_source(source: str) -> None:
    if not source.strip():
        raise ShaderValidationError("shader source must not be empty")
    if _VERTEX_MARKERS.search(source) or _ES1_ATTRIBUTE.search(source):
        raise ShaderValidationError(_VERTEX_SHADER_MESSAGE)


def _validate_uniforms(uniforms: list[ShaderUniform]) -> list[dict[str, object]]:
    seen: set[str] = set()
    normalized: list[dict[str, object]] = []
    for uniform in uniforms:
        key = uniform.key
        if not key.strip():
            raise ShaderValidationError("uniform key must not be empty")
        if key in RESERVED_UNIFORM_KEYS:
            raise ShaderValidationError(
                f"uniform key {key!r} is reserved and cannot be a user uniform"
            )
        if key in seen:
            raise ShaderValidationError(f"duplicate uniform key: {key}")
        seen.add(key)
        if not is_uniform_kind(uniform.kind):
            raise ShaderValidationError(f"uniform {key}: kind {uniform.kind!r} is not supported")
        try:
            default = normalize_parameter_default(uniform.kind, uniform.default, key)
        except ParameterValidationError as exc:
            raise ShaderValidationError(str(exc)) from exc
        normalized.append({"key": key, "kind": uniform.kind, "default": default})
    return normalized


def _require_non_empty(value: str, message: str) -> None:
    if not value.strip():
        raise ShaderValidationError(message)


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
