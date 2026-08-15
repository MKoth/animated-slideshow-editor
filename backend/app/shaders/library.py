from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import desc, select

from app.database import Database
from app.shaders.model import BUILTIN_SHADERS, ShaderDefinition

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


class ShaderLibrary:
    """I own the persistent library of shader definitions."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def ensure_seeded(self, now: datetime) -> None:
        """Seed the five protected built-ins, creating only the ones still missing."""
        with self._database.session() as session:
            for builtin in BUILTIN_SHADERS:
                shader_id = str(builtin["id"])
                if session.get(ShaderDefinition, shader_id) is not None:
                    continue
                session.add(
                    ShaderDefinition(
                        id=shader_id,
                        name=str(builtin["name"]),
                        description=str(builtin["description"]),
                        tags=list(cast(list[str], builtin["tags"])),
                        created_at=now,
                        updated_at=now,
                        source=str(builtin["source"]),
                        is_builtin=True,
                    )
                )
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


def _require_non_empty(value: str, message: str) -> None:
    if not value.strip():
        raise ShaderValidationError(message)


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
