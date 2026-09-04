from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ClipCollectionCreateIn(BaseModel):
    id: str = Field(..., description="Client-generated id, e.g. clipCollection-...")
    name: str = Field(..., min_length=1)
    bindings: dict[str, str] = Field(..., description="semanticName -> clipId")
    source_node_id: str | None = None
    clips: list[dict] | None = Field(default=None, description="Snapshot of referenced clips for self-contained import")

    @field_validator("name")
    def name_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("bindings")
    def bindings_must_be_valid(cls, v: dict[str, str]) -> dict[str, str]:
        if not isinstance(v, dict) or len(v) == 0:
            raise ValueError("bindings must be a non-empty object")
        for k, clip_id in v.items():
            if not isinstance(k, str) or not k.strip():
                raise ValueError("binding key must be non-empty string")
            if not isinstance(clip_id, str) or not clip_id.strip():
                raise ValueError(f'binding "{k}" must be non-empty string clipId')
        # trim keys
        return {k.strip(): clip_id for k, clip_id in v.items()}


class ClipCollectionUpdateIn(BaseModel):
    name: str | None = None
    bindings: dict[str, str] | None = None
    source_node_id: str | None = None
    clips: list[dict] | None = None

    @field_validator("name")
    def name_must_not_be_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name must not be empty")
        return v.strip() if isinstance(v, str) else v

    @field_validator("bindings")
    def bindings_must_be_valid(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        if v is None:
            return v
        if not isinstance(v, dict) or len(v) == 0:
            raise ValueError("bindings must be a non-empty object")
        for k, clip_id in v.items():
            if not isinstance(k, str) or not k.strip():
                raise ValueError("binding key must be non-empty string")
            if not isinstance(clip_id, str) or not clip_id.strip():
                raise ValueError(f'binding "{k}" must be non-empty string clipId')
        return {k.strip(): clip_id for k, clip_id in v.items()}


class ClipCollectionDefinitionOut(BaseModel):
    id: str
    name: str
    bindings: dict[str, str]
    source_node_id: str | None = None
    clips: list[dict] | None = None
    created_at: datetime
    updated_at: datetime


def definition_to_schema(definition) -> ClipCollectionDefinitionOut:
    return ClipCollectionDefinitionOut(
        id=definition.id,
        name=definition.name,
        bindings=dict(definition.bindings or {}),
        source_node_id=definition.source_node_id,
        clips=list(definition.clips) if definition.clips else None,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )
