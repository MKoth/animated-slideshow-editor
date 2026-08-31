from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile

from app.assets.categories import DEFAULT_ASSET_CATEGORY
from app.assets.importer import AssetImporter, Upload
from app.assets.library import AssetLibrary, AssetNotFoundError
from app.assets.pipeline import size_error_message
from app.assets.schemas import (
    AssetDefinitionOut,
    PeaksOut,
    UploadErrorOut,
    UploadResult,
    definition_to_schema,
)
from app.config import Settings

router = APIRouter()


@router.post("/assets", response_model=UploadResult)
def upload_assets(
    request: Request,
    files: Annotated[list[UploadFile], File()],
    categories: Annotated[list[str] | None, Form()] = None,
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
    result = importer.import_uploads(uploads, imported_at=datetime.now(UTC).replace(tzinfo=None))
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
) -> list[AssetDefinitionOut]:
    library: AssetLibrary = request.app.state.asset_library
    return [definition_to_schema(definition) for definition in library.list(search, sort, order)]


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

    storage = request.app.state.asset_importer._storage  # type: ignore[attr-defined]
    database = request.app.state.database
    payload = get_or_compute_peaks(definition, storage, database)
    return PeaksOut(
        peaks=payload["peaks"],  # type: ignore[arg-type]
        duration=payload["duration"] if isinstance(payload["duration"], (int, float)) else None,  # type: ignore[arg-type]
        sampleRate=payload["sampleRate"] if isinstance(payload["sampleRate"], int) else None,  # type: ignore[arg-type]
        channels=payload["channels"] if isinstance(payload["channels"], int) else None,  # type: ignore[arg-type]
    )


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(request: Request, asset_id: str) -> None:
    library: AssetLibrary = request.app.state.asset_library
    try:
        library.delete(asset_id)
    except AssetNotFoundError as exc:
        raise _asset_not_found(asset_id, exc) from exc
