from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from app.materials.library import (
    MaterialLibrary,
    MaterialNotFoundError,
    MaterialProtectedError,
    MaterialValidationError,
    ShaderReferenceNotFoundError,
    now_utc,
)
from app.materials.schemas import (
    MaterialCreateIn,
    MaterialDefinitionOut,
    MaterialShaderUpdateIn,
    MaterialUpdateIn,
    definition_to_schema,
)

router = APIRouter()


def _material_not_found(material_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"material {material_id} not found")


def _shader_not_found(shader_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"shader {shader_id} not found")


def _invalid_payload(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _protected(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=message)


@router.get("/materials", response_model=list[MaterialDefinitionOut])
def list_materials(request: Request) -> list[MaterialDefinitionOut]:
    library: MaterialLibrary = request.app.state.material_library
    return [definition_to_schema(definition) for definition in library.list_all()]


@router.post("/materials", response_model=MaterialDefinitionOut)
def create_material(request: Request, payload: MaterialCreateIn) -> MaterialDefinitionOut:
    library: MaterialLibrary = request.app.state.material_library
    now: datetime = now_utc()
    if payload.source_id is not None:
        source_id = payload.source_id
        if payload.description or payload.tags or payload.parameters:
            raise _invalid_payload(
                "a duplicate carries only name and source_id; other fields are copied "
                "from the source"
            )
        try:
            definition = library.duplicate(payload.name, source_id, now=now)
        except MaterialNotFoundError as exc:
            raise _material_not_found(source_id) from exc
        except MaterialValidationError as exc:
            raise _invalid_payload(str(exc)) from exc
    else:
        try:
            definition = library.create(
                payload.name, payload.description, payload.tags, payload.parameters, now=now
            )
        except MaterialValidationError as exc:
            raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.get("/materials/{material_id}", response_model=MaterialDefinitionOut)
def get_material(request: Request, material_id: str) -> MaterialDefinitionOut:
    library: MaterialLibrary = request.app.state.material_library
    try:
        definition = library.get(material_id)
    except MaterialNotFoundError as exc:
        raise _material_not_found(material_id) from exc
    return definition_to_schema(definition)


@router.put("/materials/{material_id}", response_model=MaterialDefinitionOut)
def update_material(
    request: Request, material_id: str, payload: MaterialUpdateIn
) -> MaterialDefinitionOut:
    library: MaterialLibrary = request.app.state.material_library
    try:
        definition = library.update(
            material_id,
            name=payload.name,
            description=payload.description,
            tags=payload.tags,
            parameters=payload.parameters,
            now=now_utc(),
        )
    except MaterialNotFoundError as exc:
        raise _material_not_found(material_id) from exc
    except MaterialValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.put("/materials/{material_id}/shader", response_model=MaterialDefinitionOut)
def assign_material_shader(
    request: Request, material_id: str, payload: MaterialShaderUpdateIn
) -> MaterialDefinitionOut:
    """Assign or remove (shader_id=None) the shader reference on a material."""
    library: MaterialLibrary = request.app.state.material_library
    try:
        definition = library.assign_shader(material_id, payload.shader_id, now=now_utc())
    except MaterialNotFoundError as exc:
        raise _material_not_found(material_id) from exc
    except ShaderReferenceNotFoundError as exc:
        raise _shader_not_found(str(exc.args[0])) from exc
    except MaterialValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.delete("/materials/{material_id}", status_code=204)
def delete_material(request: Request, material_id: str) -> None:
    library: MaterialLibrary = request.app.state.material_library
    try:
        library.delete(material_id)
    except MaterialNotFoundError as exc:
        raise _material_not_found(material_id) from exc
    except MaterialProtectedError as exc:
        raise _protected(str(exc)) from exc
