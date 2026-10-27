from datetime import UTC, datetime

from pydantic import BaseModel

from app.projects.model import ProjectFolder, ProjectRow


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


class ProjectSummary(BaseModel):
    """The list view of a stored project."""

    id: str
    name: str
    lastModified: datetime
    folder_id: str | None = None


class ProjectMetadataOut(BaseModel):
    """The full metadata view of a stored project."""

    id: str
    name: str
    description: str
    author: str
    created: datetime
    lastModified: datetime
    version: int
    folder_id: str | None = None


class ProjectFolderOut(BaseModel):
    """A flat user-created folder organising the project library."""

    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class ProjectFolderCreate(BaseModel):
    name: str


class ProjectFolderUpdate(BaseModel):
    name: str


class ProjectMoveIn(BaseModel):
    folder_id: str | None = None


def row_to_summary(row: ProjectRow) -> ProjectSummary:
    return ProjectSummary(
        id=row.id,
        name=row.name,
        lastModified=_aware_utc(row.last_modified),
        folder_id=row.folder_id,
    )


def row_to_metadata(row: ProjectRow) -> ProjectMetadataOut:
    return ProjectMetadataOut(
        id=row.id,
        name=row.name,
        description=row.description,
        author=row.author,
        created=_aware_utc(row.created),
        lastModified=_aware_utc(row.last_modified),
        version=row.version,
        folder_id=row.folder_id,
    )


def folder_to_schema(folder: ProjectFolder) -> ProjectFolderOut:
    return ProjectFolderOut(
        id=folder.id,
        name=folder.name,
        created_at=_aware_utc(folder.created_at),
        updated_at=_aware_utc(folder.updated_at),
    )
