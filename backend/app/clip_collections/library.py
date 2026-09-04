from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import desc, select

from app.clip_collections.model import ClipCollectionDefinition
from app.clip_collections.schemas import ClipCollectionCreateIn
from app.database import Database


class ClipCollectionNotFoundError(KeyError):
    """Raised when a collection id does not exist."""


class ClipCollectionValidationError(ValueError):
    """Raised when a collection payload is invalid."""


class ClipCollectionDuplicateIDError(ValueError):
    """Raised when a collection with given id already exists."""


class ClipCollectionLibrary:
    """I own the persistent library of clip collections."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def list_all(self) -> list[ClipCollectionDefinition]:
        statement = select(ClipCollectionDefinition).order_by(
            desc(ClipCollectionDefinition.created_at), ClipCollectionDefinition.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, collection_id: str) -> ClipCollectionDefinition:
        with self._database.session() as session:
            definition = session.get(ClipCollectionDefinition, collection_id)
        if definition is None:
            raise ClipCollectionNotFoundError(collection_id)
        return definition

    def create(
        self,
        collection_id: str,
        name: str,
        bindings: dict[str, str],
        source_node_id: str | None,
        now: datetime,
        clips: list[dict] | None = None,
    ) -> ClipCollectionDefinition:
        _require_non_empty(name, "name must not be empty")
        _validate_bindings(bindings)
        with self._database.session() as session:
            if session.get(ClipCollectionDefinition, collection_id) is not None:
                raise ClipCollectionDuplicateIDError(f"collection with id {collection_id!r} already exists")
            definition = ClipCollectionDefinition(
                id=collection_id,
                name=name.strip(),
                bindings={k.strip(): v for k, v in bindings.items()},
                source_node_id=source_node_id,
                clips=clips,
                created_at=now,
                updated_at=now,
            )
            session.add(definition)
            session.commit()
        return definition

    def update(
        self,
        collection_id: str,
        name: str | None,
        bindings: dict[str, str] | None,
        source_node_id: str | None,
        now: datetime,
        clips: list[dict] | None = None,
    ) -> ClipCollectionDefinition:
        if all(v is None for v in (name, bindings, source_node_id, clips)):
            raise ClipCollectionValidationError(
                "at least one of name, bindings, source_node_id or clips is required"
            )
        if name is not None:
            _require_non_empty(name, "name must not be empty")
        if bindings is not None:
            _validate_bindings(bindings)
        with self._database.session() as session:
            definition = session.get(ClipCollectionDefinition, collection_id)
            if definition is None:
                raise ClipCollectionNotFoundError(collection_id)
            if name is not None:
                definition.name = name.strip()
            if bindings is not None:
                definition.bindings = {k.strip(): v for k, v in bindings.items()}
            if source_node_id is not None:
                definition.source_node_id = source_node_id
            if clips is not None:
                definition.clips = clips
            # allow clearing source_node_id by explicit None? update payload will omit it; not needed
            definition.updated_at = now
            session.commit()
        return definition

    def delete(self, collection_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(ClipCollectionDefinition, collection_id)
            if definition is None:
                raise ClipCollectionNotFoundError(collection_id)
            session.delete(definition)
            session.commit()


def _require_non_empty(value: str, message: str) -> None:
    if not value.strip():
        raise ClipCollectionValidationError(message)


def _validate_bindings(bindings: dict[str, str]) -> None:
    if not isinstance(bindings, dict) or len(bindings) == 0:
        raise ClipCollectionValidationError("bindings must be a non-empty object")
    for k, v in bindings.items():
        if not isinstance(k, str) or not k.strip():
            raise ClipCollectionValidationError("binding key must be non-empty string")
        if not isinstance(v, str) or not v.strip():
            raise ClipCollectionValidationError(f'binding "{k}" must be non-empty string clipId')


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
