from __future__ import annotations

import builtins
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import asc, desc, func, select
from sqlalchemy.orm import Session

from app.assets.model import AssetDefinition, AssetFolder
from app.assets.storage import AssetStorage
from app.database import Database


class AssetNotFoundError(KeyError):
    """Raised when an asset id does not exist in the library."""


class FolderNotFoundError(KeyError):
    """Raised when a folder id does not exist in the library."""


class FolderValidationError(ValueError):
    """Raised when a folder name or parent is invalid."""


class FolderConflictError(ValueError):
    """Raised when a folder name already exists under the same parent."""


#: Sentinel distinguishing "no folder filter" from "root (NULL) filter".
UNSET: object = object()


SORT_COLUMNS = {
    "name": AssetDefinition.name,
    "import_date": AssetDefinition.import_date,
}
ORDER_DIRECTIONS = {"asc": asc, "desc": desc}


class AssetLibrary:
    """I list, fetch, and delete asset definitions."""

    def __init__(self, database: Database, storage: AssetStorage) -> None:
        self._database = database
        self._storage = storage

    @staticmethod
    def _escape_like(pattern: str) -> str:
        return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def list(
        self,
        search: str | None = None,
        sort: str = "import_date",
        order: str = "desc",
        folder_id: str | None | object = UNSET,
    ) -> list[AssetDefinition]:
        statement = select(AssetDefinition)
        if search:
            statement = statement.where(
                AssetDefinition.name.ilike(f"%{self._escape_like(search)}%", escape="\\")
            )
        if folder_id is not UNSET:
            if folder_id is None:
                statement = statement.where(AssetDefinition.folder_id.is_(None))
            else:
                statement = statement.where(AssetDefinition.folder_id == folder_id)
        statement = statement.order_by(
            ORDER_DIRECTIONS[order](SORT_COLUMNS[sort]), AssetDefinition.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, asset_id: str) -> AssetDefinition:
        with self._database.session() as session:
            definition = session.get(AssetDefinition, asset_id)
        if definition is None:
            raise AssetNotFoundError(asset_id)
        return definition

    def delete(self, asset_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(AssetDefinition, asset_id)
            if definition is None:
                raise AssetNotFoundError(asset_id)
            stored_paths = [definition.original_path, definition.thumbnail_path]
            session.delete(definition)
            session.commit()
        for relative_path in stored_paths:
            self._storage.remove(relative_path)

    def move_asset(self, asset_id: str, folder_id: str | None) -> AssetDefinition:
        with self._database.session() as session:
            definition = session.get(AssetDefinition, asset_id)
            if definition is None:
                raise AssetNotFoundError(asset_id)
            if folder_id is not None and session.get(AssetFolder, folder_id) is None:
                raise FolderNotFoundError(folder_id)
            definition.folder_id = folder_id
            session.commit()
            session.refresh(definition)
            return definition

    # -- folders ---------------------------------------------------------

    @staticmethod
    def _clean_folder_name(name: str) -> str:
        cleaned = name.strip()
        if not cleaned:
            raise FolderValidationError("folder name must not be blank")
        if len(cleaned) > 255:
            raise FolderValidationError("folder name must be at most 255 characters")
        if "/" in cleaned or "\\" in cleaned:
            raise FolderValidationError("folder name must not contain slashes")
        return cleaned

    def _ensure_no_duplicate(
        self, session: Session, name: str, parent_id: str | None, exclude_id: str | None = None
    ) -> None:
        statement = select(AssetFolder).where(func.lower(AssetFolder.name) == name.lower())
        if parent_id is None:
            statement = statement.where(AssetFolder.parent_id.is_(None))
        else:
            statement = statement.where(AssetFolder.parent_id == parent_id)
        if exclude_id is not None:
            statement = statement.where(AssetFolder.id != exclude_id)
        if session.scalars(statement).first() is not None:
            raise FolderConflictError(f"a folder named '{name}' already exists here")

    def list_folders(self) -> builtins.list[AssetFolder]:
        with self._database.session() as session:
            statement = select(AssetFolder).order_by(func.lower(AssetFolder.name), AssetFolder.id)
            return list(session.scalars(statement))

    def get_folder(self, folder_id: str) -> AssetFolder:
        with self._database.session() as session:
            folder = session.get(AssetFolder, folder_id)
        if folder is None:
            raise FolderNotFoundError(folder_id)
        return folder

    def create_folder(self, name: str, parent_id: str | None = None) -> AssetFolder:
        cleaned = self._clean_folder_name(name)
        now = datetime.now(UTC).replace(tzinfo=None)
        with self._database.session() as session:
            if parent_id is not None and session.get(AssetFolder, parent_id) is None:
                raise FolderNotFoundError(parent_id)
            self._ensure_no_duplicate(session, cleaned, parent_id)
            folder = AssetFolder(
                id=str(uuid4()),
                name=cleaned,
                parent_id=parent_id,
                created_at=now,
                updated_at=now,
            )
            session.add(folder)
            session.commit()
            session.refresh(folder)
            return folder

    def _is_descendant(self, session: Session, candidate_id: str, ancestor_id: str) -> bool:
        """True when candidate is ancestor itself or nested below it."""
        current: str | None = candidate_id
        seen: set[str] = set()
        while current is not None and current not in seen:
            if current == ancestor_id:
                return True
            seen.add(current)
            parent = session.get(AssetFolder, current)
            current = parent.parent_id if parent is not None else None
        return False

    def update_folder(
        self,
        folder_id: str,
        name: str | None = None,
        parent_id: str | None | object = UNSET,
    ) -> AssetFolder:
        with self._database.session() as session:
            folder = session.get(AssetFolder, folder_id)
            if folder is None:
                raise FolderNotFoundError(folder_id)
            new_name = folder.name
            if name is not None:
                new_name = self._clean_folder_name(name)
            new_parent = folder.parent_id
            if parent_id is not UNSET:
                new_parent = parent_id  # type: ignore[assignment]
                if new_parent == folder_id:
                    raise FolderValidationError("a folder cannot be its own parent")
                if new_parent is not None:
                    if session.get(AssetFolder, new_parent) is None:
                        raise FolderNotFoundError(new_parent)
                    if self._is_descendant(session, new_parent, folder_id):
                        raise FolderValidationError("a folder cannot move into its own subfolder")
            self._ensure_no_duplicate(session, new_name, new_parent, exclude_id=folder_id)
            folder.name = new_name
            folder.parent_id = new_parent
            folder.updated_at = datetime.now(UTC).replace(tzinfo=None)
            session.commit()
            session.refresh(folder)
            return folder

    def delete_folder(self, folder_id: str) -> str | None:
        """Delete a folder, moving its contents to its parent (or root).

        Returns the parent id (None for root) so callers can navigate there.
        """
        with self._database.session() as session:
            folder = session.get(AssetFolder, folder_id)
            if folder is None:
                raise FolderNotFoundError(folder_id)
            new_parent = folder.parent_id
            for child in list(
                session.scalars(select(AssetFolder).where(AssetFolder.parent_id == folder_id))
            ):
                # A child with the same name as a sibling of the deleted folder
                # would collide after reparenting — suffix it instead of failing.
                try:
                    self._ensure_no_duplicate(session, child.name, new_parent)
                except FolderConflictError:
                    child.name = f"{child.name} (moved)"
                child.parent_id = new_parent
                child.updated_at = datetime.now(UTC).replace(tzinfo=None)
            for asset in list(
                session.scalars(
                    select(AssetDefinition).where(AssetDefinition.folder_id == folder_id)
                )
            ):
                asset.folder_id = new_parent
            session.delete(folder)
            session.commit()
            return new_parent
