from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.materials.library import MaterialLibrary, MaterialValidationError
from app.shaders.library import (
    ShaderLibrary,
    ShaderNotFoundError,
    ShaderProtectedError,
    ShaderValidationError,
    now_utc,
)
from app.shaders.schemas import (
    ShaderDefinitionOut,
    ShaderDuplicateIn,
    ShaderRenameIn,
    ShaderUniformsUpdateIn,
    definition_to_schema,
)

router = APIRouter()


def _shader_not_found(shader_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"shader {shader_id} not found")


def _invalid_payload(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _protected(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=message)


def _decode_source(content: bytes) -> str:
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise _invalid_payload(
            "the uploaded file is not a text file; shader source must be UTF-8 text"
        ) from exc


@router.post("/shaders/import", response_model=ShaderDefinitionOut)
def import_shader(
    request: Request,
    file: Annotated[UploadFile, File()],
    name: Annotated[str | None, Form()] = None,
    description: Annotated[str, Form()] = "",
    tags: Annotated[list[str] | None, Form()] = None,
) -> ShaderDefinitionOut:
    library: ShaderLibrary = request.app.state.shader_library
    source = _decode_source(file.file.read())
    try:
        definition = library.import_source(
            name=name or Path(file.filename or "shader.glsl").stem or "shader",
            description=description,
            tags=tags or [],
            source=source,
            now=now_utc(),
        )
    except ShaderValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.post("/shaders/duplicate", response_model=ShaderDefinitionOut)
def duplicate_shader(request: Request, payload: ShaderDuplicateIn) -> ShaderDefinitionOut:
    library: ShaderLibrary = request.app.state.shader_library
    try:
        definition = library.duplicate(payload.name, payload.source_id, now=now_utc())
    except ShaderNotFoundError as exc:
        raise _shader_not_found(payload.source_id) from exc
    except ShaderValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.get("/shaders", response_model=list[ShaderDefinitionOut])
def list_shaders(request: Request) -> list[ShaderDefinitionOut]:
    library: ShaderLibrary = request.app.state.shader_library
    return [definition_to_schema(definition) for definition in library.list_all()]


@router.get("/shaders/{shader_id}", response_model=ShaderDefinitionOut)
def get_shader(request: Request, shader_id: str) -> ShaderDefinitionOut:
    library: ShaderLibrary = request.app.state.shader_library
    try:
        definition = library.get(shader_id)
    except ShaderNotFoundError as exc:
        raise _shader_not_found(shader_id) from exc
    return definition_to_schema(definition)


@router.put("/shaders/{shader_id}", response_model=ShaderDefinitionOut)
def rename_shader(request: Request, shader_id: str, payload: ShaderRenameIn) -> ShaderDefinitionOut:
    library: ShaderLibrary = request.app.state.shader_library
    try:
        definition = library.rename(shader_id, payload.name, now=now_utc())
    except ShaderNotFoundError as exc:
        raise _shader_not_found(shader_id) from exc
    except ShaderValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.put("/shaders/{shader_id}/source", response_model=ShaderDefinitionOut)
def reupload_shader_source(
    request: Request,
    shader_id: str,
    file: Annotated[UploadFile, File()],
) -> ShaderDefinitionOut:
    library: ShaderLibrary = request.app.state.shader_library
    source = _decode_source(file.file.read())
    try:
        definition = library.reupload(shader_id, source, now=now_utc())
    except ShaderNotFoundError as exc:
        raise _shader_not_found(shader_id) from exc
    except ShaderValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.put("/shaders/{shader_id}/uniforms", response_model=ShaderDefinitionOut)
def update_shader_uniforms(
    request: Request, shader_id: str, payload: ShaderUniformsUpdateIn
) -> ShaderDefinitionOut:
    """Replace a shader's uniform defaults and flow them into referencing materials."""
    shader_library: ShaderLibrary = request.app.state.shader_library
    try:
        definition = shader_library.update_default_uniforms(
            shader_id, payload.default_uniforms, now=now_utc()
        )
    except ShaderNotFoundError as exc:
        raise _shader_not_found(shader_id) from exc
    except ShaderValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    material_library: MaterialLibrary = request.app.state.material_library
    try:
        material_library.reseed_for_shader(shader_id, definition.default_uniforms, now=now_utc())
    except MaterialValidationError as exc:
        raise _invalid_payload(str(exc)) from exc
    return definition_to_schema(definition)


@router.delete("/shaders/{shader_id}", status_code=204)
def delete_shader(request: Request, shader_id: str) -> None:
    library: ShaderLibrary = request.app.state.shader_library
    try:
        library.delete(shader_id)
    except ShaderNotFoundError as exc:
        raise _shader_not_found(shader_id) from exc
    except ShaderProtectedError as exc:
        raise _protected(str(exc)) from exc
