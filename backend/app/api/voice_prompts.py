from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request

from app.voice_prompts.library import VoicePromptLibrary, VoicePromptNotFoundError
from app.voice_prompts.schemas import (
    VoicePromptCreate,
    VoicePromptOut,
    VoicePromptUpdate,
    row_to_schema,
)

router = APIRouter()


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _not_found(prompt_id: str, exc: Exception) -> HTTPException:
    return HTTPException(status_code=404, detail=f"voice_prompt {prompt_id} not found")


@router.get("/voice-prompts", response_model=list[VoicePromptOut])
def list_voice_prompts(request: Request) -> list[VoicePromptOut]:
    library: VoicePromptLibrary = request.app.state.voice_prompt_library
    return [row_to_schema(row) for row in library.list()]


@router.post("/voice-prompts", response_model=VoicePromptOut, status_code=201)
def create_voice_prompt(request: Request, body: VoicePromptCreate) -> VoicePromptOut:
    library: VoicePromptLibrary = request.app.state.voice_prompt_library
    title = body.title.strip()
    instruction = body.instruction.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title must be a non-empty string")
    if not instruction:
        raise HTTPException(status_code=422, detail="instruction must be a non-empty string")
    row = library.create(
        title=title,
        instruction=instruction,
        language=body.language,
        voice=body.voice,
        params=body.params,
        now=_now(),
    )
    return row_to_schema(row)


@router.get("/voice-prompts/{prompt_id}", response_model=VoicePromptOut)
def get_voice_prompt(request: Request, prompt_id: str) -> VoicePromptOut:
    library: VoicePromptLibrary = request.app.state.voice_prompt_library
    try:
        row = library.get(prompt_id)
    except VoicePromptNotFoundError as exc:
        raise _not_found(prompt_id, exc) from exc
    return row_to_schema(row)


@router.put("/voice-prompts/{prompt_id}", response_model=VoicePromptOut)
def update_voice_prompt(
    request: Request, prompt_id: str, body: VoicePromptUpdate
) -> VoicePromptOut:
    library: VoicePromptLibrary = request.app.state.voice_prompt_library
    patch: dict[str, object] = {}
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(status_code=422, detail="title must be a non-empty string")
        patch["title"] = t
    if body.instruction is not None:
        instr = body.instruction.strip()
        if not instr:
            raise HTTPException(status_code=422, detail="instruction must be a non-empty string")
        patch["instruction"] = instr
    if body.language is not None:
        patch["language"] = body.language
    elif "language" in body.model_fields_set:
        patch["language"] = None
    if body.voice is not None:
        patch["voice"] = body.voice
    elif "voice" in body.model_fields_set:
        patch["voice"] = None
    if body.params is not None:
        patch["params"] = body.params
    elif "params" in body.model_fields_set:
        patch["params"] = None
    # if no fields were set, return current
    if not patch and not body.model_fields_set:
        raise HTTPException(status_code=422, detail="no fields to update")
    try:
        row = library.update(prompt_id, patch, now=_now())
    except VoicePromptNotFoundError as exc:
        raise _not_found(prompt_id, exc) from exc
    return row_to_schema(row)


@router.delete("/voice-prompts/{prompt_id}", status_code=204)
def delete_voice_prompt(request: Request, prompt_id: str) -> None:
    library: VoicePromptLibrary = request.app.state.voice_prompt_library
    try:
        library.delete(prompt_id)
    except VoicePromptNotFoundError as exc:
        raise _not_found(prompt_id, exc) from exc
