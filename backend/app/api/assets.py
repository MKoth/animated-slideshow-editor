from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile

from app.assets.categories import DEFAULT_ASSET_CATEGORY
from app.assets.importer import AssetImporter, Upload
from app.assets.library import (
    UNSET,
    AssetLibrary,
    AssetNotFoundError,
    FolderConflictError,
    FolderNotFoundError,
    FolderValidationError,
)
from app.assets.pipeline import size_error_message
from app.assets.schemas import (
    AssetDefinitionOut,
    AssetFolderCreate,
    AssetFolderOut,
    AssetFolderUpdate,
    AssetMoveIn,
    PeaksOut,
    UploadErrorOut,
    UploadResult,
    definition_to_schema,
    folder_to_schema,
)
from app.config import Settings

router = APIRouter()


def _folder_not_found(folder_id: str, exc: FolderNotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=f"folder {folder_id} not found")


def _parse_folder_filter(folder_id: str | None) -> str | None | object:
    """Map the ?folder_id= query to UNSET (global) / None (root) / id."""
    if folder_id is None:
        return UNSET
    if folder_id in ("", "root", "null"):
        return None
    return folder_id


@router.get("/assets/folders", response_model=list[AssetFolderOut])
def list_folders(request: Request) -> list[AssetFolderOut]:
    library: AssetLibrary = request.app.state.asset_library
    return [folder_to_schema(folder) for folder in library.list_folders()]


@router.post("/assets/folders", response_model=AssetFolderOut, status_code=201)
def create_folder(request: Request, body: AssetFolderCreate) -> AssetFolderOut:
    library: AssetLibrary = request.app.state.asset_library
    try:
        folder = library.create_folder(body.name, body.parent_id)
    except FolderNotFoundError as exc:
        raise _folder_not_found(str(body.parent_id), exc) from exc
    except FolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FolderValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return folder_to_schema(folder)


@router.get("/assets/folders/{folder_id}", response_model=AssetFolderOut)
def get_folder(request: Request, folder_id: str) -> AssetFolderOut:
    library: AssetLibrary = request.app.state.asset_library
    try:
        folder = library.get_folder(folder_id)
    except FolderNotFoundError as exc:
        raise _folder_not_found(folder_id, exc) from exc
    return folder_to_schema(folder)


@router.patch("/assets/folders/{folder_id}", response_model=AssetFolderOut)
def update_folder(request: Request, folder_id: str, body: AssetFolderUpdate) -> AssetFolderOut:
    library: AssetLibrary = request.app.state.asset_library
    parent: str | None | object = UNSET
    if "parent_id" in body.model_fields_set:
        parent = body.parent_id
    try:
        folder = library.update_folder(folder_id, name=body.name, parent_id=parent)
    except FolderNotFoundError as exc:
        # Distinguish folder vs new-parent missing: library raises with the missing id.
        raise HTTPException(status_code=404, detail=str(exc.args[0])) from exc
    except FolderConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FolderValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return folder_to_schema(folder)


@router.delete("/assets/folders/{folder_id}", status_code=204)
def delete_folder(request: Request, folder_id: str) -> None:
    library: AssetLibrary = request.app.state.asset_library
    try:
        library.delete_folder(folder_id)
    except FolderNotFoundError as exc:
        raise _folder_not_found(folder_id, exc) from exc


@router.post("/assets", response_model=UploadResult)
def upload_assets(
    request: Request,
    files: Annotated[list[UploadFile], File()],
    categories: Annotated[list[str] | None, Form()] = None,
    folder_id: Annotated[str | None, Form()] = None,
) -> UploadResult:
    if categories and len(categories) != len(files):
        raise HTTPException(
            status_code=422,
            detail="the number of category fields must match the number of files",
        )
    importer: AssetImporter = request.app.state.asset_importer
    settings: Settings = request.app.state.settings
    errors: list[UploadErrorOut] = []
    uploads: list[Upload] = []
    for index, file in enumerate(files):
        category = categories[index] if categories else DEFAULT_ASSET_CATEGORY
        size_error = (
            size_error_message(file.size, settings.max_upload_bytes)
            if file.size is not None
            else None
        )
        if size_error is not None:
            errors.append(UploadErrorOut(filename=file.filename or "unnamed", error=size_error))
            continue
        uploads.append(
            Upload(filename=file.filename or "unnamed", content=file.file.read(), category=category)
        )
    target_folder: str | None | object = _parse_folder_filter(folder_id)
    # Uploads default to root (NULL). An explicit folder id pins the destination.
    destination: str | None = target_folder if isinstance(target_folder, str) else None
    try:
        result = importer.import_uploads(
            uploads,
            imported_at=datetime.now(UTC).replace(tzinfo=None),
            folder_id=destination,
        )
    except FolderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc.args[0])) from exc
    errors.extend(
        UploadErrorOut(filename=error.filename, error=error.error) for error in result.errors
    )
    return UploadResult(
        created=[definition_to_schema(definition) for definition in result.created],
        errors=errors,
    )


@router.get("/assets", response_model=list[AssetDefinitionOut])
def list_assets(
    request: Request,
    search: Annotated[str | None, Query(max_length=255)] = None,
    sort: Literal["name", "import_date"] = "import_date",
    order: Literal["asc", "desc"] = "desc",
    folder_id: Annotated[str | None, Query()] = None,
) -> list[AssetDefinitionOut]:
    library: AssetLibrary = request.app.state.asset_library
    folder_filter = _parse_folder_filter(folder_id)
    # ?folder_id absent + ?search present + legacy clients: global. Explicit
    # ?folder_id=root (or "") scopes to root-level assets.
    return [
        definition_to_schema(definition)
        for definition in library.list(search, sort, order, folder_filter)
    ]


def _asset_not_found(asset_id: str, exc: AssetNotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=f"asset {asset_id} not found")


@router.get("/assets/{asset_id}", response_model=AssetDefinitionOut)
def get_asset(request: Request, asset_id: str) -> AssetDefinitionOut:
    library: AssetLibrary = request.app.state.asset_library
    try:
        definition = library.get(asset_id)
    except AssetNotFoundError as exc:
        raise _asset_not_found(asset_id, exc) from exc
    return definition_to_schema(definition)


@router.get("/assets/{asset_id}/peaks", response_model=PeaksOut)
def get_asset_peaks(request: Request, asset_id: str) -> PeaksOut:
    library: AssetLibrary = request.app.state.asset_library
    try:
        definition = library.get(asset_id)
    except AssetNotFoundError as exc:
        raise _asset_not_found(asset_id, exc) from exc
    if definition.category != "audio":
        raise HTTPException(status_code=404, detail=f"asset {asset_id} has no peaks (not audio)")
    from app.assets.peaks import get_or_compute_peaks

    storage = request.app.state.asset_importer._storage
    database = request.app.state.database
    payload = get_or_compute_peaks(definition, storage, database)
    return PeaksOut(
        peaks=payload["peaks"],  # type: ignore[arg-type]
        duration=payload["duration"] if isinstance(payload["duration"], (int, float)) else None,
        sampleRate=payload["sampleRate"] if isinstance(payload["sampleRate"], int) else None,
        channels=payload["channels"] if isinstance(payload["channels"], int) else None,
    )


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(request: Request, asset_id: str) -> None:
    if asset_id == "folders":
        raise HTTPException(status_code=404, detail="asset folders not found")
    library: AssetLibrary = request.app.state.asset_library
    try:
        library.delete(asset_id)
    except AssetNotFoundError as exc:
        raise _asset_not_found(asset_id, exc) from exc


@router.patch("/assets/{asset_id}", response_model=AssetDefinitionOut)
def move_asset(request: Request, asset_id: str, body: AssetMoveIn) -> AssetDefinitionOut:
    library: AssetLibrary = request.app.state.asset_library
    try:
        definition = library.move_asset(asset_id, body.folder_id)
    except AssetNotFoundError as exc:
        raise _asset_not_found(asset_id, exc) from exc
    except FolderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc.args[0])) from exc
    return definition_to_schema(definition)
