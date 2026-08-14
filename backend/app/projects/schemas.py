from datetime import UTC, datetime

from pydantic import BaseModel

from app.projects.model import ProjectRow


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


class ProjectSummary(BaseModel):
    """The list view of a stored project."""

    id: str
    name: str
    lastModified: datetime


class ProjectMetadataOut(BaseModel):
    """The full metadata view of a stored project."""

    id: str
    name: str
    description: str
    author: str
    created: datetime
    lastModified: datetime
    version: int


def row_to_summary(row: ProjectRow) -> ProjectSummary:
    return ProjectSummary(id=row.id, name=row.name, lastModified=_aware_utc(row.last_modified))


def row_to_metadata(row: ProjectRow) -> ProjectMetadataOut:
    return ProjectMetadataOut(
        id=row.id,
        name=row.name,
        description=row.description,
        author=row.author,
        created=_aware_utc(row.created),
        lastModified=_aware_utc(row.last_modified),
        version=row.version,
    )
