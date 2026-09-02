# ruff: noqa: BLE001, S110
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from app.tts.languages import normalize_language_code

router = APIRouter()

# Global serialized queue for TTS generation — one inference at a time
_tts_lock = asyncio.Lock()


class TTSGenerateRequest(BaseModel):
    text: str = Field(description="text to synthesize")
    promptId: str | None = Field(default=None, description="voice prompt id")
    language: str | None = None
    voice: str | None = None
    instruction: str | None = None

    @field_validator("language", mode="before")
    @classmethod
    def validate_language(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("language must be a string")
        try:
            return normalize_language_code(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


@router.post("/tts/generate")
async def tts_generate(request: Request, body: TTSGenerateRequest) -> Response:
    text = body.text.strip() if isinstance(body.text, str) else ""
    if not text:
        raise HTTPException(status_code=422, detail="text must be a non-empty string")

    # Resolve voice prompt if provided and merge overrides
    effective_language: str | None = body.language
    effective_voice: str | None = body.voice
    effective_instruction: str | None = body.instruction
    effective_params: dict[str, Any] | None = None

    if body.promptId is not None:
        library = getattr(request.app.state, "voice_prompt_library", None)
        if library is not None:
            try:
                prompt = library.get(body.promptId)
            except Exception as exc:
                from app.voice_prompts.library import VoicePromptNotFoundError

                if isinstance(exc, VoicePromptNotFoundError):
                    raise HTTPException(
                        status_code=404, detail=f"voice_prompt {body.promptId} not found"
                    ) from exc
                raise
            # Merge: per-request overrides win over stored prompt
            if effective_language is None:
                effective_language = prompt.language
            if effective_voice is None:
                effective_voice = prompt.voice
            if effective_instruction is None:
                effective_instruction = prompt.instruction
            effective_params = prompt.params if isinstance(prompt.params, dict) else None
        else:
            # No library available – still validate existence via 404? If library missing, we can't validate, so continue with raw overrides
            pass

    # Determine engine via app state or global singleton (settings-aware)
    # Prefer app.state.tts_engine if factory pre-created, else singleton factory
    engine: Any | None = getattr(request.app.state, "tts_engine", None)
    settings = getattr(request.app.state, "settings", None)
    provider = getattr(settings, "tts_provider", None) if settings else None
    model_id = getattr(settings, "tts_model_id", None) if settings else None

    if engine is None:
        from app.tts.engine import MlxNotAvailableError, get_tts_engine

        try:
            engine = get_tts_engine(provider=provider, model_id=model_id)
        except MlxNotAvailableError as exc:
            # Provider forced to mlx but mlx not installed -> 503 per spec (service unavailable)
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"TTS engine init failed: {exc}") from exc
        # cache for next request (optional, like asset_library)
        try:
            request.app.state.tts_engine = engine
        except Exception:
            pass

    # Serialized concurrent queue
    async with _tts_lock:
        # Small delay to prove serialization in tests remains (10ms) – real model takes longer
        await asyncio.sleep(0.01)
        try:
            # Run blocking inference in thread pool to avoid blocking event loop
            # Engine.generate is blocking (MLX may be heavy)
            wav_bytes: bytes = await asyncio.to_thread(
                engine.generate,
                text,
                effective_language,
                effective_voice,
                effective_instruction,
                effective_params,
            )
        except Exception as exc:
            # Unwrap HTTPException already
            if isinstance(exc, HTTPException):
                raise
            from app.tts.engine import MlxNotAvailableError, TtsInferenceError, TtsModelLoadError

            if isinstance(exc, MlxNotAvailableError):
                # auto: fallback silently to sine if mlx package missing;
                # mlx provider: surface 503 so caller can retry/install
                if provider == "mlx":
                    raise HTTPException(status_code=503, detail=str(exc)) from exc
                try:
                    from app.tts.engine import SineTtsEngine

                    fallback = SineTtsEngine()
                    wav_bytes = fallback.generate(
                        text,
                        effective_language,
                        effective_voice,
                        effective_instruction,
                        effective_params,
                    )
                except Exception as fallback_exc:
                    raise HTTPException(status_code=500, detail=str(fallback_exc)) from fallback_exc
            elif isinstance(exc, TtsModelLoadError):
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            elif isinstance(exc, TtsInferenceError):
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            else:
                # Unknown error from sine or other – treat as 500
                # Preserve original message for debugging
                raise HTTPException(
                    status_code=500, detail=f"TTS generation failed: {exc}"
                ) from exc

    return Response(
        content=wav_bytes, media_type="audio/wav", headers={"Content-Length": str(len(wav_bytes))}
    )
