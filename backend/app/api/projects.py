import logging
import re
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.projects.library import (
    UNSET,
    ProjectFolderConflictError,
    ProjectFolderNotFoundError,
    ProjectFolderValidationError,
    ProjectLibrary,
    ProjectNotFoundError,
)
from app.projects.schemas import (
    ProjectFolderCreate,
    ProjectFolderOut,
    ProjectFolderUpdate,
    ProjectMetadataOut,
    ProjectMoveIn,
    ProjectSummary,
    folder_to_schema,
    row_to_metadata,
    row_to_summary,
)
from app.projects.validation import ProjectValidationError, validate_lesson

router = APIRouter()

_FILENAME_UNSAFE = re.compile(r"[^\w.-]", flags=re.ASCII)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _project_not_found(project_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"project {project_id} not found")


def _folder_not_found(folder_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"project folder {folder_id} not found")


def _parse_folder_query(folder_id: str | None) -> str | None | object:
    """Map ?folder_id to UNSET (preserve) / None (root) / id."""
    if folder_id is None:
        return UNSET
    if folder_id in ("", "root", "null"):
        return None
    return folder_id


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(request: Request) -> list[ProjectSummary]:
    library: ProjectLibrary = request.app.state.project_library
    return [row_to_summary(row) for row in library.list()]


@router.post("/projects", response_model=ProjectMetadataOut)
async def upsert_project(
    request: Request, folder_id: str | None = Query(default=None)
) -> ProjectMetadataOut:
    library: ProjectLibrary = request.app.state.project_library
    try:
        text = (await request.body()).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="the body must be valid UTF-8") from exc
    try:
        summary = validate_lesson(text)
    except ProjectValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    target = _parse_folder_query(folder_id)
    try:
        row = library.upsert(summary, blob=text, now=_now(), folder_id=target)
    except ProjectFolderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc.args[0])) from exc
    return row_to_metadata(row)


@router.get("/projects/{project_id}", response_class=Response)
def get_project(request: Request, project_id: str) -> Response:
    if project_id in ("folders",):
        raise HTTPException(status_code=404, detail="project folders not found")
    library: ProjectLibrary = request.app.state.project_library
    try:
        row = library.get(project_id)
    except ProjectNotFoundError as exc:
        raise _project_not_found(project_id) from exc
    return Response(content=row.blob, media_type="application/json")


@router.patch("/projects/{project_id}", response_model=ProjectMetadataOut)
def move_project(request: Request, project_id: str, body: ProjectMoveIn) -> ProjectMetadataOut:
    if project_id in ("folders",):
        raise HTTPException(status_code=404, detail="project folders not found")
    library: ProjectLibrary = request.app.state.project_library
    try:
        row = library.move_project(project_id, body.folder_id)
    except ProjectNotFoundError as exc:
        raise _project_not_found(project_id) from exc
    except ProjectFolderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc.args[0])) from exc
    return row_to_metadata(row)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(request: Request, project_id: str) -> None:
    library: ProjectLibrary = request.app.state.project_library
    try:
        library.delete(project_id)
    except ProjectNotFoundError as exc:
        raise _project_not_found(project_id) from exc
    ai_library = getattr(request.app.state, "ai_library", None)
    if ai_library is not None:
        try:
            ai_library.delete_by_project(project_id)
        except Exception as exc:  # noqa: BLE001 - cascade best-effort, project already deleted
            logging.getLogger(__name__).warning("ai cascade delete failed: %s", exc)


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


# -- project folders (flat) -------------------------------------------


@router.get("/project-folders", response_model=list[ProjectFolderOut])
def list_project_folders(request: Request) -> list[ProjectFolderOut]:
    library: ProjectLibrary = request.app.state.project_library
    return [folder_to_schema(folder) for folder in library.list_folders()]


@router.post("/project-folders", response_model=ProjectFolderOut, status_code=201)
def create_project_folder(request: Request, body: ProjectFolderCreate) -> ProjectFolderOut:
    library: ProjectLibrary = request.app.state.project_library
    try:
        folder = library.create_folder(body.name)
    except ProjectFolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProjectFolderValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return folder_to_schema(folder)


@router.patch("/project-folders/{folder_id}", response_model=ProjectFolderOut)
def rename_project_folder(
    request: Request, folder_id: str, body: ProjectFolderUpdate
) -> ProjectFolderOut:
    library: ProjectLibrary = request.app.state.project_library
    try:
        folder = library.rename_folder(folder_id, body.name)
    except ProjectFolderNotFoundError as exc:
        raise _folder_not_found(folder_id) from exc
    except ProjectFolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProjectFolderValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return folder_to_schema(folder)


@router.delete("/project-folders/{folder_id}", status_code=204)
def delete_project_folder(
    request: Request,
    folder_id: str,
    mode: Literal["move_to_root", "delete_projects"] = Query(default="move_to_root"),
) -> None:
    library: ProjectLibrary = request.app.state.project_library
    try:
        doomed = library.delete_folder(folder_id, delete_projects=(mode == "delete_projects"))
    except ProjectFolderNotFoundError as exc:
        raise _folder_not_found(folder_id) from exc
    if doomed:
        ai_library = getattr(request.app.state, "ai_library", None)
        if ai_library is not None:
            for project_id in doomed:
                try:
                    ai_library.delete_by_project(project_id)
                except Exception as exc:  # noqa: BLE001 - cascade best-effort
                    logging.getLogger(__name__).warning("ai cascade delete failed: %s", exc)
