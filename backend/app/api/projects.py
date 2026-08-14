import re
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response

from app.projects.library import ProjectLibrary, ProjectNotFoundError
from app.projects.schemas import ProjectMetadataOut, ProjectSummary, row_to_metadata, row_to_summary
from app.projects.validation import ProjectValidationError, validate_lesson

router = APIRouter()

_FILENAME_UNSAFE = re.compile(r"[^\w.-]", flags=re.ASCII)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _project_not_found(project_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"project {project_id} not found")


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(request: Request) -> list[ProjectSummary]:
    library: ProjectLibrary = request.app.state.project_library
    return [row_to_summary(row) for row in library.list()]


@router.post("/projects", response_model=ProjectMetadataOut)
async def upsert_project(request: Request) -> ProjectMetadataOut:
    library: ProjectLibrary = request.app.state.project_library
    try:
        text = (await request.body()).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="the body must be valid UTF-8") from exc
    try:
        summary = validate_lesson(text)
    except ProjectValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = library.upsert(summary, blob=text, now=_now())
    return row_to_metadata(row)


@router.get("/projects/{project_id}", response_class=Response)
def get_project(request: Request, project_id: str) -> Response:
    library: ProjectLibrary = request.app.state.project_library
    try:
        row = library.get(project_id)
    except ProjectNotFoundError as exc:
        raise _project_not_found(project_id) from exc
    return Response(content=row.blob, media_type="application/json")


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(request: Request, project_id: str) -> None:
    library: ProjectLibrary = request.app.state.project_library
    try:
        library.delete(project_id)
    except ProjectNotFoundError as exc:
        raise _project_not_found(project_id) from exc


@router.get("/projects/{project_id}/download", response_class=Response)
def download_project(request: Request, project_id: str) -> Response:
    library: ProjectLibrary = request.app.state.project_library
    try:
        row = library.get(project_id)
    except ProjectNotFoundError as exc:
        raise _project_not_found(project_id) from exc
    filename = f"{_FILENAME_UNSAFE.sub('-', row.name)}.lesson"
    return Response(
        content=row.blob,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
