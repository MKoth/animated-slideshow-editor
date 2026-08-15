from datetime import datetime

from pydantic import BaseModel

from app.shaders.model import ShaderDefinition


class ShaderDefinitionOut(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    source: str
    default_uniforms: list[dict[str, object]]
    is_builtin: bool


class ShaderRenameIn(BaseModel):
    name: str


class ShaderDuplicateIn(BaseModel):
    name: str
    source_id: str


def definition_to_schema(definition: ShaderDefinition) -> ShaderDefinitionOut:
    return ShaderDefinitionOut(
        id=definition.id,
        name=definition.name,
        description=definition.description,
        tags=definition.tags,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
        source=definition.source,
        default_uniforms=[dict(uniform) for uniform in definition.default_uniforms],
        is_builtin=definition.is_builtin,
    )
