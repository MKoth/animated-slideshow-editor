from datetime import datetime
from typing import cast

from pydantic import BaseModel

from app.materials.model import MaterialDefinition
from app.parameters import ParameterKind


class MaterialParameter(BaseModel):
    key: str
    kind: ParameterKind
    default: str | float | bool | list[float]


class MaterialDefinitionOut(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    parameters: list[MaterialParameter]
    shader_id: str | None


class MaterialCreateIn(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = []
    parameters: list[MaterialParameter] = []
    source_id: str | None = None


class MaterialUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    parameters: list[MaterialParameter] | None = None


class MaterialShaderUpdateIn(BaseModel):
    shader_id: str | None


def parameter_from_stored(parameter: dict[str, object]) -> MaterialParameter:
    return MaterialParameter(
        key=cast(str, parameter["key"]),
        kind=cast(ParameterKind, parameter["kind"]),
        default=cast(str | float | bool | list[float], parameter["default"]),
    )


def definition_to_schema(definition: MaterialDefinition) -> MaterialDefinitionOut:
    return MaterialDefinitionOut(
        id=definition.id,
        name=definition.name,
        description=definition.description,
        tags=definition.tags,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
        parameters=[parameter_from_stored(parameter) for parameter in definition.parameters],
        shader_id=definition.shader_id,
    )
