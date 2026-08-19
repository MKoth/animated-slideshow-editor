from datetime import datetime
from typing import cast

from pydantic import BaseModel, ConfigDict, field_validator

from app.clips.model import ClipDefinition


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


class ClipParam(BaseModel):
    key: str
    label: str
    kind: str
    default: float

    @field_validator("kind")
    @classmethod
    def kind_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("kind must be a non-empty string")
        return v


class ClipChannelDef(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    property: str
    param_key: str | None = None
    link_mode: str | None = None


class ClipDefinitionOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    duration: float
    category: str | None
    params: list[ClipParam]
    channels: list[ClipChannelDef]
    channelAnimations: dict[str, dict[str, object]] | None = None
    created_at: datetime
    updated_at: datetime


class ClipCreateIn(BaseModel):
    id: str
    name: str
    duration: float
    category: str | None = None
    params: list[ClipParam] = []
    channels: list[ClipChannelDef] = []
    channel_animations: dict[str, dict[str, object]] | None = None


class ClipUpdateIn(BaseModel):
    name: str | None = None
    duration: float | None = None
    category: str | None = None
    params: list[ClipParam] | None = None
    channels: list[ClipChannelDef] | None = None
    channel_animations: dict[str, dict[str, object]] | None = None


def param_from_stored(param: dict[str, object]) -> ClipParam:
    return ClipParam(
        key=cast(str, param["key"]),
        label=cast(str, param["label"]),
        kind=cast(str, param["kind"]),
        default=cast(float, param["default"]),
    )


def channel_from_stored(channel: dict[str, object]) -> ClipChannelDef:
    return ClipChannelDef(
        property=cast(str, channel["property"]),
        param_key=cast(str | None, channel.get("paramKey")),
        link_mode=cast(str | None, channel.get("linkMode")),
    )


def definition_to_schema(definition: ClipDefinition) -> ClipDefinitionOut:
    return ClipDefinitionOut(
        id=definition.id,
        name=definition.name,
        duration=definition.duration,
        category=definition.category,
        params=[param_from_stored(p) for p in definition.params],
        channels=[channel_from_stored(c) for c in definition.channels],
        channelAnimations=definition.channel_animations,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )
