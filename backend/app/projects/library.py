from __future__ import annotations

import builtins
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import asc, func, select
from sqlalchemy.orm import Session

from app.database import Database
from app.projects.model import ProjectFolder, ProjectRow
from app.projects.validation import LessonSummary


class ProjectNotFoundError(KeyError):
    """Raised when a project id does not exist in the database."""


class ProjectFolderNotFoundError(KeyError):
    """Raised when a project folder id does not exist."""


class ProjectFolderValidationError(ValueError):
    """Raised when a project folder name is invalid."""


class ProjectFolderConflictError(ValueError):
    """Raised when a project folder name already exists."""


#: Sentinel distinguishing "no folder argument" (preserve) from explicit root (None).
UNSET: object = object()


class ProjectLibrary:
    """I list, fetch, upsert, and delete stored projects."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def list(self) -> builtins.list[ProjectRow]:
        statement = select(ProjectRow).order_by(ProjectRow.last_modified.desc(), asc(ProjectRow.id))
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, project_id: str) -> ProjectRow:
        with self._database.session() as session:
            row = session.get(ProjectRow, project_id)
        if row is None:
            raise ProjectNotFoundError(project_id)
        return row

    def upsert(
        self,
        summary: LessonSummary,
        blob: str,
        now: datetime,
        folder_id: str | None | object = UNSET,
    ) -> ProjectRow:
        with self._database.session() as session:
            if folder_id is not UNSET and folder_id is not None:
                assert isinstance(folder_id, str)
                if session.get(ProjectFolder, folder_id) is None:
                    raise ProjectFolderNotFoundError(folder_id)
            row = session.get(ProjectRow, summary.id)
            if row is None:
                row = ProjectRow(
                    id=summary.id,
                    name=summary.name,
                    description=summary.description,
                    author=summary.author,
                    created=now,
                    last_modified=now,
                    version=summary.version,
                    blob=blob,
                    folder_id=folder_id if isinstance(folder_id, str) else None,
                )
                session.add(row)
            else:
                row.name = summary.name
                row.description = summary.description
                row.author = summary.author
                row.version = summary.version
                row.last_modified = now
                row.blob = blob
                if folder_id is not UNSET:
                    row.folder_id = folder_id if isinstance(folder_id, str) else None
            session.commit()
        return self.get(summary.id)

    def delete(self, project_id: str) -> None:
        with self._database.session() as session:
            row = session.get(ProjectRow, project_id)
            if row is None:
                raise ProjectNotFoundError(project_id)
            session.delete(row)
            session.commit()

    def move_project(self, project_id: str, folder_id: str | None) -> ProjectRow:
        with self._database.session() as session:
            row = session.get(ProjectRow, project_id)
            if row is None:
                raise ProjectNotFoundError(project_id)
            if folder_id is not None and session.get(ProjectFolder, folder_id) is None:
                raise ProjectFolderNotFoundError(folder_id)
            row.folder_id = folder_id
            session.commit()
        return self.get(project_id)

    # -- folders (flat, no nesting) -------------------------------------

    @staticmethod
    def _clean_folder_name(name: str) -> str:
        cleaned = name.strip()
        if not cleaned:
            raise ProjectFolderValidationError("folder name must not be blank")
        if len(cleaned) > 255:
            raise ProjectFolderValidationError("folder name must be at most 255 characters")
        if "/" in cleaned or "\\" in cleaned:
            raise ProjectFolderValidationError("folder name must not contain slashes")
        return cleaned

    def _ensure_no_duplicate(
        self, session: Session, name: str, exclude_id: str | None = None
    ) -> None:
        statement = select(ProjectFolder).where(func.lower(ProjectFolder.name) == name.lower())
        if exclude_id is not None:
            statement = statement.where(ProjectFolder.id != exclude_id)
        if session.scalars(statement).first() is not None:
            raise ProjectFolderConflictError(f"a folder named '{name}' already exists")

    def list_folders(self) -> builtins.list[ProjectFolder]:
        with self._database.session() as session:
            statement = select(ProjectFolder).order_by(
                func.lower(ProjectFolder.name), ProjectFolder.id
            )
            return list(session.scalars(statement))

    def create_folder(self, name: str) -> ProjectFolder:
        cleaned = self._clean_folder_name(name)
        now = datetime.now(UTC).replace(tzinfo=None)
        with self._database.session() as session:
            self._ensure_no_duplicate(session, cleaned)
            folder = ProjectFolder(
                id=str(uuid4()),
                name=cleaned,
                created_at=now,
                updated_at=now,
            )
            session.add(folder)
            session.commit()
            session.refresh(folder)
            return folder

    def rename_folder(self, folder_id: str, name: str) -> ProjectFolder:
        cleaned = self._clean_folder_name(name)
        with self._database.session() as session:
            folder = session.get(ProjectFolder, folder_id)
            if folder is None:
                raise ProjectFolderNotFoundError(folder_id)
            self._ensure_no_duplicate(session, cleaned, exclude_id=folder_id)
            folder.name = cleaned
            folder.updated_at = datetime.now(UTC).replace(tzinfo=None)
            session.commit()
            session.refresh(folder)
            return folder

    def delete_folder(self, folder_id: str, *, delete_projects: bool = False) -> builtins.list[str]:
        """Delete a folder. Returns ids of deleted projects when delete_projects=True.

        move (default): projects in the folder move to root (folder_id NULL).
        delete_projects: projects in the folder are deleted as well.
        """
        with self._database.session() as session:
            folder = session.get(ProjectFolder, folder_id)
            if folder is None:
                raise ProjectFolderNotFoundError(folder_id)
            doomed: list[str] = []
            if delete_projects:
                for row in list(
                    session.scalars(select(ProjectRow).where(ProjectRow.folder_id == folder_id))
                ):
                    doomed.append(row.id)
                    session.delete(row)
            else:
                for row in list(
                    session.scalars(select(ProjectRow).where(ProjectRow.folder_id == folder_id))
                ):
                    row.folder_id = None
            session.delete(folder)
            session.commit()
            return doomed
