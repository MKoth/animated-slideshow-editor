from fastapi import APIRouter, HTTPException, Request

from app.clips.library import (
    ClipDuplicateIDError,
    ClipLibrary,
    ClipNotFoundError,
    ClipValidationError,
    now_utc,
)
from app.clips.schemas import (
    ClipCreateIn,
    ClipDefinitionOut,
    ClipUpdateIn,
    definition_to_schema,
)

router = APIRouter()


def _clip_not_found(clip_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"clip {clip_id} not found")


def _invalid_payload(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=message)


@router.get("/clips/library", response_model=list[ClipDefinitionOut])
def list_library_clips(request: Request) -> list[ClipDefinitionOut]:
    library: ClipLibrary = request.app.state.clip_library
    return [definition_to_schema(definition) for definition in library.list_all()]


@router.get("/clips/library/{clip_id}", response_model=ClipDefinitionOut)
def get_library_clip(request: Request, clip_id: str) -> ClipDefinitionOut:
    library: ClipLibrary = request.app.state.clip_library
    try:
        definition = library.get(clip_id)
    except ClipNotFoundError as exc:
        raise _clip_not_found(clip_id) from exc
    return definition_to_schema(definition)


@router.post("/clips/library", response_model=ClipDefinitionOut)
def create_library_clip(request: Request, payload: ClipCreateIn) -> ClipDefinitionOut:
    library: ClipLibrary = request.app.state.clip_library
    try:
        definition = library.create(
            clip_id=payload.id,
            name=payload.name,
            duration=payload.duration,
            category=payload.category,
            params=payload.params,
            channels=payload.channels,
            channel_animations=payload.channel_animations,
            now=now_utc(),
        )
    except ClipValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    except ClipDuplicateIDError as exc:
        raise _conflict(str(exc)) from exc
    return definition_to_schema(definition)


@router.put("/clips/library/{clip_id}", response_model=ClipDefinitionOut)
def update_library_clip(request: Request, clip_id: str, payload: ClipUpdateIn) -> ClipDefinitionOut:
    library: ClipLibrary = request.app.state.clip_library
    try:
        definition = library.update(
            clip_id,
            name=payload.name,
            duration=payload.duration,
            category=payload.category,
            params=payload.params,
            channels=payload.channels,
            channel_animations=payload.channel_animations,
            now=now_utc(),
        )
    except ClipNotFoundError as exc:
        raise _clip_not_found(clip_id) from exc
    except ClipValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.delete("/clips/library/{clip_id}", status_code=204)
def delete_library_clip(request: Request, clip_id: str) -> None:
    library: ClipLibrary = request.app.state.clip_library
    try:
        library.delete(clip_id)
    except ClipNotFoundError as exc:
        raise _clip_not_found(clip_id) from exc
