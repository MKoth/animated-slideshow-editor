from datetime import datetime
from typing import cast

from pydantic import BaseModel

from app.parameters import UniformKind
from app.shaders.model import ShaderDefinition


class ShaderUniform(BaseModel):
    key: str
    kind: UniformKind
    default: str | float | bool | list[float]


class ShaderDefinitionOut(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    source: str
    default_uniforms: list[ShaderUniform]
    is_builtin: bool


class ShaderRenameIn(BaseModel):
    name: str


class ShaderDuplicateIn(BaseModel):
    name: str
    source_id: str


class ShaderUniformsUpdateIn(BaseModel):
    default_uniforms: list[ShaderUniform]


def definition_to_schema(definition: ShaderDefinition) -> ShaderDefinitionOut:
    return ShaderDefinitionOut(
        id=definition.id,
        name=definition.name,
        description=definition.description,
        tags=definition.tags,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
        source=definition.source,
        default_uniforms=[
            ShaderUniform(
                key=str(uniform["key"]),
                kind=cast(UniformKind, str(uniform["kind"])),
                default=cast(str | float | bool | list[float], uniform["default"]),
            )
            for uniform in definition.default_uniforms
        ],
        is_builtin=definition.is_builtin,
    )
