from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import desc, select

from app.database import Database
from app.materials.model import BUILTINS, MaterialDefinition
from app.materials.schemas import MaterialParameter, parameter_from_stored

_COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$", flags=re.IGNORECASE)
_MAX_PARAMETER_KEY_LENGTH = 64


class MaterialNotFoundError(KeyError):
    """Raised when a material id does not exist in the library."""


class MaterialValidationError(ValueError):
    """Raised when a material payload is semantically invalid."""


class MaterialLibrary:
    """I own the persistent library of material definitions."""

    def __init__(self, database: Database) -> None:
        self._database = database

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

    def delete(self, material_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(MaterialDefinition, material_id)
            if definition is None:
                raise MaterialNotFoundError(material_id)
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


def _validate_parameter(parameter: MaterialParameter) -> dict[str, object]:
    key = parameter.key
    default: str | float = parameter.default
    if parameter.kind == "color":
        if not isinstance(default, str) or not _COLOR_PATTERN.match(default):
            raise MaterialValidationError(
                f"parameter {key}: color default must be a hex color like #ff0000"
            )
        default = default.lower()
    else:
        if not isinstance(default, (int, float)) or not math.isfinite(float(default)):
            raise MaterialValidationError(
                f"parameter {key}: number default must be a finite number"
            )
        default = float(default)
        if key == "opacityMultiplier" and not 0.0 <= default <= 1.0:
            raise MaterialValidationError("opacityMultiplier default must be between 0 and 1")
    return {"key": key, "kind": parameter.kind, "default": default}


def _require_non_empty(value: str, message: str) -> None:
    if not value.strip():
        raise MaterialValidationError(message)


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
