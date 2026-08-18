from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import desc, select

from app.clips.model import ClipDefinition
from app.clips.schemas import ClipChannelDef, ClipParam
from app.database import Database


class ClipNotFoundError(KeyError):
    """Raised when a clip id does not exist in the library."""


class ClipValidationError(ValueError):
    """Raised when a clip payload is semantically invalid."""


class ClipDuplicateIDError(ValueError):
    """Raised when a clip with the given id already exists."""


class ClipLibrary:
    """I own the persistent library of clip definitions."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def list_all(self) -> list[ClipDefinition]:
        statement = select(ClipDefinition).order_by(
            desc(ClipDefinition.created_at), ClipDefinition.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, clip_id: str) -> ClipDefinition:
        with self._database.session() as session:
            definition = session.get(ClipDefinition, clip_id)
        if definition is None:
            raise ClipNotFoundError(clip_id)
        return definition

    def create(
        self,
        clip_id: str,
        name: str,
        duration: float,
        category: str | None,
        params: list[ClipParam],
        channels: list[ClipChannelDef],
        channel_animations: dict[str, dict[str, object]] | None,
        now: datetime,
    ) -> ClipDefinition:
        _require_non_empty(name, "name must not be empty")
        if duration <= 0:
            raise ClipValidationError("duration must be positive")
        with self._database.session() as session:
            if session.get(ClipDefinition, clip_id) is not None:
                raise ClipDuplicateIDError(f"clip with id {clip_id!r} already exists")
            definition = ClipDefinition(
                id=clip_id,
                name=name,
                duration=duration,
                category=category,
                params=[_param_to_dict(p) for p in params],
                channels=[_channel_to_dict(c) for c in channels],
                channel_animations=channel_animations,
                created_at=now,
                updated_at=now,
            )
            session.add(definition)
            session.commit()
        return definition

    def update(
        self,
        clip_id: str,
        name: str | None,
        duration: float | None,
        category: str | None,
        params: list[ClipParam] | None,
        channels: list[ClipChannelDef] | None,
        channel_animations: dict[str, dict[str, object]] | None,
        now: datetime,
    ) -> ClipDefinition:
        if all(
            value is None
            for value in (name, duration, category, params, channels, channel_animations)
        ):
            raise ClipValidationError(
                "at least one of name, duration, category, params, channels, or channel_animations is required"
            )
        if name is not None:
            _require_non_empty(name, "name must not be empty")
        if duration is not None and duration <= 0:
            raise ClipValidationError("duration must be positive")
        with self._database.session() as session:
            definition = session.get(ClipDefinition, clip_id)
            if definition is None:
                raise ClipNotFoundError(clip_id)
            if name is not None:
                definition.name = name
            if duration is not None:
                definition.duration = duration
            if category is not None:
                definition.category = category
            if params is not None:
                definition.params = [_param_to_dict(p) for p in params]
            if channels is not None:
                definition.channels = [_channel_to_dict(c) for c in channels]
            if channel_animations is not None:
                definition.channel_animations = channel_animations
            definition.updated_at = now
            session.commit()
        return definition

    def delete(self, clip_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(ClipDefinition, clip_id)
            if definition is None:
                raise ClipNotFoundError(clip_id)
            session.delete(definition)
            session.commit()


def _require_non_empty(value: str, message: str) -> None:
    if not value.strip():
        raise ClipValidationError(message)


def _param_to_dict(param: ClipParam) -> dict[str, object]:
    return {"key": param.key, "label": param.label, "kind": param.kind, "default": param.default}


def _channel_to_dict(channel: ClipChannelDef) -> dict[str, object]:
    result: dict[str, object] = {"property": channel.property}
    if channel.param_key is not None:
        result["paramKey"] = channel.param_key
    if channel.link_mode is not None:
        result["linkMode"] = channel.link_mode
    return result


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
