from datetime import datetime

from sqlalchemy import asc, select

from app.database import Database
from app.projects.model import ProjectRow
from app.projects.validation import LessonSummary


class ProjectNotFoundError(KeyError):
    """Raised when a project id does not exist in the database."""


class ProjectLibrary:
    """I list, fetch, upsert, and delete stored projects."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def list(self) -> list[ProjectRow]:
        statement = select(ProjectRow).order_by(ProjectRow.last_modified.desc(), asc(ProjectRow.id))
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, project_id: str) -> ProjectRow:
        with self._database.session() as session:
            row = session.get(ProjectRow, project_id)
        if row is None:
            raise ProjectNotFoundError(project_id)
        return row

    def upsert(self, summary: LessonSummary, blob: str, now: datetime) -> ProjectRow:
        with self._database.session() as session:
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
                )
                session.add(row)
            else:
                row.name = summary.name
                row.description = summary.description
                row.author = summary.author
                row.version = summary.version
                row.last_modified = now
                row.blob = blob
            session.commit()
        return self.get(summary.id)

    def delete(self, project_id: str) -> None:
        with self._database.session() as session:
            row = session.get(ProjectRow, project_id)
            if row is None:
                raise ProjectNotFoundError(project_id)
            session.delete(row)
            session.commit()
