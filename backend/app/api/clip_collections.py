from fastapi import APIRouter, HTTPException, Request

from app.clip_collections.library import (
    ClipCollectionDuplicateIDError,
    ClipCollectionLibrary,
    ClipCollectionNotFoundError,
    ClipCollectionValidationError,
    now_utc,
)
from app.clip_collections.schemas import (
    ClipCollectionCreateIn,
    ClipCollectionDefinitionOut,
    ClipCollectionUpdateIn,
    definition_to_schema,
)

router = APIRouter()


def _not_found(collection_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"clip collection {collection_id} not found")


def _invalid(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=message)


@router.get("/clip-collections/library", response_model=list[ClipCollectionDefinitionOut])
def list_library_collections(request: Request) -> list[ClipCollectionDefinitionOut]:
    library: ClipCollectionLibrary = request.app.state.clip_collection_library
    return [definition_to_schema(d) for d in library.list_all()]


@router.get("/clip-collections/library/{collection_id}", response_model=ClipCollectionDefinitionOut)
def get_library_collection(request: Request, collection_id: str) -> ClipCollectionDefinitionOut:
    library: ClipCollectionLibrary = request.app.state.clip_collection_library
    try:
        definition = library.get(collection_id)
    except ClipCollectionNotFoundError as exc:
        raise _not_found(collection_id) from exc
    return definition_to_schema(definition)


@router.post("/clip-collections/library", response_model=ClipCollectionDefinitionOut)
def create_library_collection(request: Request, payload: ClipCollectionCreateIn) -> ClipCollectionDefinitionOut:
    library: ClipCollectionLibrary = request.app.state.clip_collection_library
    try:
        definition = library.create(
            collection_id=payload.id,
            name=payload.name,
            bindings=payload.bindings,
            source_node_id=payload.source_node_id,
            clips=payload.clips,
            now=now_utc(),
        )
    except ClipCollectionValidationError as exc:
        raise _invalid(str(exc)) from exc
    except ClipCollectionDuplicateIDError as exc:
        raise _conflict(str(exc)) from exc
    return definition_to_schema(definition)


@router.put("/clip-collections/library/{collection_id}", response_model=ClipCollectionDefinitionOut)
def update_library_collection(
    request: Request, collection_id: str, payload: ClipCollectionUpdateIn
) -> ClipCollectionDefinitionOut:
    library: ClipCollectionLibrary = request.app.state.clip_collection_library
    try:
        definition = library.update(
            collection_id,
            name=payload.name,
            bindings=payload.bindings,
            source_node_id=payload.source_node_id,
            clips=payload.clips,
            now=now_utc(),
        )
    except ClipCollectionNotFoundError as exc:
        raise _not_found(collection_id) from exc
    except ClipCollectionValidationError as exc:
        raise _invalid(str(exc)) from exc
    return definition_to_schema(definition)


@router.delete("/clip-collections/library/{collection_id}", status_code=204)
def delete_library_collection(request: Request, collection_id: str) -> None:
    library: ClipCollectionLibrary = request.app.state.clip_collection_library
    try:
        library.delete(collection_id)
    except ClipCollectionNotFoundError as exc:
        raise _not_found(collection_id) from exc
