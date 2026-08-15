from __future__ import annotations

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import desc, select

from app.database import Database
from app.materials.model import (
    BUILTINS,
    DEFAULT_MATERIAL_DESCRIPTION,
    DEFAULT_MATERIAL_ID,
    DEFAULT_MATERIAL_NAME,
    DEFAULT_MATERIAL_TAGS,
    MaterialDefinition,
    _builtin_defaults,
)
from app.materials.schemas import MaterialParameter, parameter_from_stored
from app.parameters import (
    RESERVED_UNIFORM_KEYS,
    ParameterKind,
    ParameterValidationError,
    normalize_parameter_default,
)
from app.shaders.model import ShaderDefinition

_MAX_PARAMETER_KEY_LENGTH = 64


class MaterialNotFoundError(KeyError):
    """Raised when a material id does not exist in the library."""


class MaterialValidationError(ValueError):
    """Raised when a material payload is semantically invalid."""


class MaterialProtectedError(ValueError):
    """Raised when the protected default material cannot be deleted."""


class ShaderReferenceNotFoundError(KeyError):
    """Raised when a material references a shader id that does not exist."""


class MaterialLibrary:
    """I own the persistent library of material definitions."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def ensure_seeded(self, now: datetime) -> None:
        """Create the protected default material, only when it is still missing."""
        with self._database.session() as session:
            if session.get(MaterialDefinition, DEFAULT_MATERIAL_ID) is not None:
                return
            session.add(
                MaterialDefinition(
                    id=DEFAULT_MATERIAL_ID,
                    name=DEFAULT_MATERIAL_NAME,
                    description=DEFAULT_MATERIAL_DESCRIPTION,
                    tags=list(DEFAULT_MATERIAL_TAGS),
                    created_at=now,
                    updated_at=now,
                    parameters=_builtin_defaults(),
                )
            )
            session.commit()

    def list_all(self) -> list[MaterialDefinition]:
        statement = select(MaterialDefinition).order_by(
            desc(MaterialDefinition.created_at), MaterialDefinition.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, material_id: str) -> MaterialDefinition:
        with self._database.session() as session:
            definition = session.get(MaterialDefinition, material_id)
        if definition is None:
            raise MaterialNotFoundError(material_id)
        return definition

    def create(
        self,
        name: str,
        description: str,
        tags: list[str],
        parameters: list[MaterialParameter] | None,
        now: datetime,
    ) -> MaterialDefinition:
        _require_non_empty(name, "name must not be empty")
        material_id = str(uuid4())
        definition = MaterialDefinition(
            id=material_id,
            name=name,
            description=description,
            tags=tags,
            created_at=now,
            updated_at=now,
            parameters=self._normalize_parameters(parameters, existing=BUILTINS),
        )
        with self._database.session() as session:
            session.add(definition)
            session.commit()
        return definition

    def duplicate(self, name: str, source_id: str, now: datetime) -> MaterialDefinition:
        _require_non_empty(name, "name must not be empty")
        source = self.get(source_id)
        return self.create(
            name=name,
            description=source.description,
            tags=source.tags,
            parameters=[parameter_from_stored(parameter) for parameter in source.parameters],
            now=now,
        )

    def update(
        self,
        material_id: str,
        name: str | None,
        description: str | None,
        tags: list[str] | None,
        parameters: list[MaterialParameter] | None,
        now: datetime,
    ) -> MaterialDefinition:
        if all(value is None for value in (name, description, tags, parameters)):
            raise MaterialValidationError(
                "at least one of name, description, tags, or parameters is required"
            )
        if name is not None:
            _require_non_empty(name, "name must not be empty")
        with self._database.session() as session:
            definition = session.get(MaterialDefinition, material_id)
            if definition is None:
                raise MaterialNotFoundError(material_id)
            if name is not None:
                definition.name = name
            if description is not None:
                definition.description = description
            if tags is not None:
                definition.tags = tags
            if parameters is not None:
                definition.parameters = self._normalize_parameters(
                    parameters, existing=definition.parameters
                )
            definition.updated_at = now
            session.commit()
        return definition

    def assign_shader(
        self,
        material_id: str,
        shader_id: str | None,
        now: datetime,
    ) -> MaterialDefinition:
        """Assign or remove the shader reference on a material definition.

        Assigning appends the shader's reflected uniforms to the material's
        parameter list, seeded from the shader's default uniforms; assigning a
        different shader replaces both the reference and the uniform parameters;
        removing (shader_id=None) drops them again, keeping only the built-ins.
        """
        with self._database.session() as session:
            definition = session.get(MaterialDefinition, material_id)
            if definition is None:
                raise MaterialNotFoundError(material_id)
            if shader_id is None:
                definition.shader_id = None
                definition.parameters = self._normalize_parameters(None, definition.parameters)
            else:
                shader = session.get(ShaderDefinition, shader_id)
                if shader is None:
                    raise ShaderReferenceNotFoundError(shader_id)
                definition.shader_id = shader_id
                definition.parameters = self._parameters_with_uniforms(
                    definition.parameters, shader.default_uniforms
                )
            definition.updated_at = now
            session.commit()
        return definition

    def reseed_for_shader(
        self, shader_id: str, uniforms: list[dict[str, object]], now: datetime
    ) -> None:
        """Re-seed the uniform parameters of every material referencing a shader.

        Called after the shader's default uniforms change so the new defaults
        flow into all materials that reference the shader.
        """
        with self._database.session() as session:
            affected: list[MaterialDefinition] = list(
                session.scalars(
                    select(MaterialDefinition).where(MaterialDefinition.shader_id == shader_id)
                )
            )
            if not affected:
                return
            for definition in affected:
                definition.parameters = self._parameters_with_uniforms(
                    definition.parameters, uniforms
                )
                definition.updated_at = now
            session.commit()

    def delete(self, material_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(MaterialDefinition, material_id)
            if definition is None:
                raise MaterialNotFoundError(material_id)
            if material_id == DEFAULT_MATERIAL_ID:
                raise MaterialProtectedError(
                    f"material {definition.name!r} is the default material and cannot be deleted"
                )
            session.delete(definition)
            session.commit()

    @staticmethod
    def _normalize_parameters(
        incoming: list[MaterialParameter] | None,
        existing: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        by_key: dict[str, dict[str, object]] = {}
        for parameter in incoming or []:
            key = parameter.key
            _require_non_empty(key, "parameter key must not be empty")
            if len(key) > _MAX_PARAMETER_KEY_LENGTH:
                raise MaterialValidationError(
                    f"parameter key {key!r} is too long (max {_MAX_PARAMETER_KEY_LENGTH})"
                )
            if key in by_key:
                raise MaterialValidationError(f"duplicate parameter key: {key}")
            by_key[key] = _validate_parameter(parameter)

        normalized: list[dict[str, object]] = []
        existing_by_key = {str(parameter["key"]): parameter for parameter in existing}
        for builtin in BUILTINS:
            key = str(builtin["key"])
            provided = by_key.pop(key, None)
            if provided is not None:
                if provided["kind"] != builtin["kind"]:
                    raise MaterialValidationError(f"parameter {key} must be kind {builtin['kind']}")
                normalized.append(provided)
            elif key in existing_by_key:
                normalized.append(existing_by_key[key])
            else:
                normalized.append(dict(builtin))
        for parameter in incoming or []:
            if parameter.key in by_key:
                normalized.append(by_key.pop(parameter.key))
        return normalized

    def _parameters_with_uniforms(
        self,
        existing: list[dict[str, object]],
        uniforms: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        """Rebuild a parameter list as built-ins (defaults preserved) plus uniforms."""
        normalized = self._normalize_parameters(None, existing)
        for uniform in uniforms:
            key = str(uniform["key"])
            if key in RESERVED_UNIFORM_KEYS:
                raise MaterialValidationError(
                    f"uniform key {key!r} is reserved and cannot seed a material parameter"
                )
            parameter = MaterialParameter(
                key=key,
                kind=cast(ParameterKind, str(uniform["kind"])),
                default=cast(str | float | bool | list[float], uniform["default"]),
            )
            normalized.append(_validate_parameter(parameter))
        return normalized


def _validate_parameter(parameter: MaterialParameter) -> dict[str, object]:
    key = parameter.key
    kind = parameter.kind
    try:
        default = normalize_parameter_default(kind, parameter.default, key)
    except ParameterValidationError as exc:
        raise MaterialValidationError(str(exc)) from exc
    if (
        kind == "number"
        and key == "opacityMultiplier"
        and isinstance(default, (int, float))
        and not 0.0 <= float(default) <= 1.0
    ):
        raise MaterialValidationError("opacityMultiplier default must be between 0 and 1")
    return {"key": key, "kind": kind, "default": default}


def _require_non_empty(value: str, message: str) -> None:
    if not value.strip():
        raise MaterialValidationError(message)


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
