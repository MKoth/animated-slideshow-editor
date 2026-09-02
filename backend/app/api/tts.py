# ruff: noqa: BLE001, S110
from __future__ import annotations

import asyncio
import dataclasses
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
    modelId: str | None = Field(default=None, alias="modelId", description="HuggingFace model id override")
    provider: str | None = Field(default=None, description="tts provider override: auto, sine, mlx")

    model_config = {"populate_by_name": True}

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

    @field_validator("modelId", mode="before")
    @classmethod
    def validate_model_id(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("modelId must be a string")
        if v.strip() == "":
            return None
        try:
            from app.tts.registry import normalize_model_id

            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        except Exception:
            return v.strip()

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("provider must be a string")
        if v.strip() == "":
            return None
        try:
            from app.tts.registry import normalize_provider

            return normalize_provider(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        except Exception:
            return v.strip().lower()


class TtsSettingsUpdate(BaseModel):
    provider: str | None = Field(default=None, description="tts provider: auto, sine, mlx")
    modelId: str | None = Field(default=None, alias="modelId", description="HuggingFace model id")
    # also allow snake for compatibility
    model_id: str | None = Field(default=None, alias="model_id")

    model_config = {"populate_by_name": True}

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("provider must be a string")
        if v.strip() == "":
            return None
        try:
            from app.tts.registry import normalize_provider

            return normalize_provider(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        except Exception:
            return v.strip().lower()

    @field_validator("modelId", mode="before")
    @classmethod
    def validate_model_id(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("modelId must be a string")
        if v.strip() == "":
            return None
        try:
            from app.tts.registry import normalize_model_id

            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        except Exception:
            return v.strip()

    @field_validator("model_id", mode="before")
    @classmethod
    def validate_model_id_snake(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("model_id must be a string")
        if v.strip() == "":
            return None
        try:
            from app.tts.registry import normalize_model_id

            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        except Exception:
            return v.strip()


def _get_registry_defaults():
    try:
        from app.tts.registry import (
            DEFAULT_MODEL_ID,
            DEFAULT_PROVIDER,
            SUPPORTED_MODELS,
            SUPPORTED_PROVIDERS,
            get_all_capabilities,
        )

        return DEFAULT_MODEL_ID, DEFAULT_PROVIDER, SUPPORTED_MODELS, SUPPORTED_PROVIDERS, get_all_capabilities
    except Exception:
        # fallback
        default_model = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
        default_provider = "auto"
        models = [default_model]
        providers = ["auto", "sine", "mlx"]

        def cap():  # type: ignore
            return {default_model: {"languages": ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"], "speakers": ["Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee"], "instructionSupported": False}}

        return default_model, default_provider, models, providers, cap


def _get_settings_values(request: Request) -> tuple[str, str]:
    settings = getattr(request.app.state, "settings", None)
    default_model, default_provider, _, _, _ = _get_registry_defaults()
    provider = getattr(settings, "tts_provider", default_provider) if settings else default_provider
    model_id = getattr(settings, "tts_model_id", default_model) if settings else default_model
    # normalize
    provider = (provider or default_provider).strip().lower()
    model_id = (model_id or default_model).strip()
    return provider, model_id


@router.get("/tts/models")
def get_tts_models(request: Request) -> dict[str, Any]:
    default_model, default_provider, models, providers, get_all = _get_registry_defaults()
    provider, model_id = _get_settings_values(request)
    capabilities = get_all()
    # per-model languages/speakers already in capabilities
    # also expose supported speakers/languages via engine helpers as fallback
    return {
        "models": models,
        "providers": providers,
        "defaultModel": model_id,
        "defaultProvider": provider,
        "default_model_id": model_id,
        "default_provider": provider,
        "capabilities": capabilities,
        "perModel": capabilities,
        "defaults": {"provider": provider, "modelId": model_id},
    }


@router.get("/tts/capabilities")
def get_tts_capabilities(request: Request) -> dict[str, Any]:
    default_model, default_provider, models, providers, get_all = _get_registry_defaults()
    provider, model_id = _get_settings_values(request)
    capabilities = get_all()
    # aggregate languages/speakers across models
    all_languages: set[str] = set()
    all_speakers: set[str] = set()
    for cap in capabilities.values():
        langs = cap.get("languages", [])
        spks = cap.get("speakers", [])
        if isinstance(langs, list):
            all_languages.update(langs)  # type: ignore
        if isinstance(spks, list):
            all_speakers.update(spks)  # type: ignore
    # also include per-model as get_supported_* from engine
    try:
        from app.tts.engine import get_supported_languages, get_supported_speakers

        # ensure we have at least default model's lists
        if not all_languages:
            all_languages.update(get_supported_languages(model_id))
        if not all_speakers:
            all_speakers.update(get_supported_speakers(model_id))
    except Exception:
        pass
    return {
        "models": models,
        "providers": providers,
        "defaultModel": model_id,
        "defaultProvider": provider,
        "default_model_id": model_id,
        "default_provider": provider,
        "languages": sorted(all_languages),
        "speakers": sorted(all_speakers),
        "capabilities": capabilities,
        "perModel": capabilities,
        "per_model": capabilities,
        "defaults": {"provider": provider, "modelId": model_id},
    }


@router.get("/tts/settings")
def get_tts_settings(request: Request) -> dict[str, Any]:
    provider, model_id = _get_settings_values(request)
    default_model, default_provider, models, providers, get_all = _get_registry_defaults()
    return {
        "provider": provider,
        "modelId": model_id,
        "model_id": model_id,
        "tts_provider": provider,
        "tts_model_id": model_id,
        "models": models,
        "providers": providers,
    }


@router.put("/tts/settings")
def update_tts_settings(request: Request, body: TtsSettingsUpdate) -> dict[str, Any]:
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        from app.config import load_settings

        settings = load_settings()
        request.app.state.settings = settings  # type: ignore
    # Determine new values (keep existing if body None)
    provider, model_id = _get_settings_values(request)
    new_provider = body.provider if body.provider is not None else provider
    # modelId alias handling – body may have modelId or model_id
    new_model_id = None
    if body.modelId is not None:
        new_model_id = body.modelId
    elif getattr(body, "model_id", None) is not None:
        new_model_id = body.model_id
    else:
        new_model_id = model_id

    # Validate via registry
    try:
        from app.tts.registry import normalize_model_id, normalize_provider

        if body.provider is not None:
            new_provider = normalize_provider(new_provider) or new_provider  # type: ignore
        if body.modelId is not None or getattr(body, "model_id", None) is not None:
            new_model_id = normalize_model_id(new_model_id) or new_model_id  # type: ignore
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    # Update settings – handle frozen or not
    try:
        # try direct mutation
        settings.tts_provider = new_provider  # type: ignore
        settings.tts_model_id = new_model_id  # type: ignore
    except Exception:
        try:
            new_settings = dataclasses.replace(settings, tts_provider=new_provider, tts_model_id=new_model_id)  # type: ignore
            request.app.state.settings = new_settings  # type: ignore
            settings = new_settings
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"failed to update settings: {exc}") from exc

    # Trigger engine singleton reload
    try:
        from app.tts.engine import (
            MlxNotAvailableError,
            MlxQwenTtsEngine,
            SineTtsEngine,
            get_tts_engine,
            reset_tts_engine_singleton,
        )

        reset_tts_engine_singleton()
        # Invalidate app.state cache
        if hasattr(request.app.state, "tts_engine"):
            try:
                delattr(request.app.state, "tts_engine")
            except Exception:
                try:
                    request.app.state.tts_engine = None  # type: ignore
                except Exception:
                    pass
        # Preload new engine (handles fallback)
        try:
            engine = get_tts_engine(provider=new_provider, model_id=new_model_id)
            request.app.state.tts_engine = engine  # type: ignore
        except MlxNotAvailableError:
            if new_provider == "mlx":
                # Store placeholder that will 503 on next generate – consistent with factory
                request.app.state.tts_engine = MlxQwenTtsEngine(new_model_id)  # type: ignore
            else:
                request.app.state.tts_engine = SineTtsEngine()  # type: ignore
        except ValueError as ve:
            raise HTTPException(status_code=422, detail=str(ve)) from ve
        except Exception:
            # fallback to sine
            from app.tts.engine import SineTtsEngine

            request.app.state.tts_engine = SineTtsEngine()  # type: ignore
    except HTTPException:
        raise
    except Exception:
        pass

    return {
        "provider": new_provider,
        "modelId": new_model_id,
        "model_id": new_model_id,
        "tts_provider": new_provider,
        "tts_model_id": new_model_id,
    }


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
    prompt_provider: str | None = None
    prompt_model_id: str | None = None

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
            # Extract stored model/provider from prompt (new columns or params legacy)
            prompt_provider = getattr(prompt, "provider", None)
            prompt_model_id = getattr(prompt, "model_id", None)
            if not prompt_provider and isinstance(prompt.params, dict):
                maybe = prompt.params.get("provider")
                if isinstance(maybe, str) and maybe.strip():
                    prompt_provider = maybe.strip().lower()
            if not prompt_model_id and isinstance(prompt.params, dict):
                maybe = prompt.params.get("modelId") or prompt.params.get("model_id")
                if isinstance(maybe, str) and maybe.strip():
                    prompt_model_id = maybe.strip()
        else:
            # No library available – still validate existence via 404? If library missing, we can't validate, so continue with raw overrides
            pass

    # Determine effective provider/model: request body > prompt stored > global settings
    settings = getattr(request.app.state, "settings", None)
    default_model, default_provider, _, _, _ = _get_registry_defaults()
    global_provider = getattr(settings, "tts_provider", default_provider) if settings else default_provider
    global_model_id = getattr(settings, "tts_model_id", default_model) if settings else default_model

    effective_provider = body.provider if body.provider is not None else (prompt_provider if prompt_provider else global_provider)
    effective_model_id = body.modelId if body.modelId is not None else (prompt_model_id if prompt_model_id else global_model_id)

    # Normalize (ensure lower for provider, strip for model)
    if isinstance(effective_provider, str):
        effective_provider = effective_provider.strip().lower() or global_provider
    if isinstance(effective_model_id, str):
        effective_model_id = effective_model_id.strip() or global_model_id

    # Validate provider/model via registry (convert invalid to 422)
    try:
        from app.tts.registry import is_valid_model, is_valid_provider

        if not is_valid_provider(effective_provider):
            raise HTTPException(status_code=422, detail=f"unknown provider '{effective_provider}'")
        if not is_valid_model(effective_model_id):
            raise HTTPException(status_code=422, detail=f"unknown modelId '{effective_model_id}'")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception:
        pass

    # Resolve engine: always use singleton factory with effective values (handles reload)
    provider_for_engine = effective_provider
    model_id_for_engine = effective_model_id
    engine: Any | None = None
    try:
        from app.tts.engine import MlxNotAvailableError, get_tts_engine

        engine = get_tts_engine(provider=provider_for_engine, model_id=model_id_for_engine)
        # Update cache
        try:
            request.app.state.tts_engine = engine  # type: ignore
        except Exception:
            pass
    except Exception as exc:
        from app.tts.engine import MlxNotAvailableError

        if isinstance(exc, MlxNotAvailableError):
            if provider_for_engine == "mlx":
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            # auto fallback is already handled inside get_tts_engine (returns Sine), so this path
            # means get_tts_engine raised MlxNotAvailable even in auto? Should fallback to sine now.
            try:
                from app.tts.engine import SineTtsEngine

                engine = SineTtsEngine()
                try:
                    request.app.state.tts_engine = engine  # type: ignore
                except Exception:
                    pass
            except Exception as fallback_exc:
                raise HTTPException(status_code=500, detail=str(fallback_exc)) from fallback_exc
        elif isinstance(exc, ValueError):
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        elif isinstance(exc, HTTPException):
            raise
        else:
            raise HTTPException(status_code=500, detail=f"TTS engine init failed: {exc}") from exc

    # Serialized concurrent queue
    async with _tts_lock:
        # Small delay to prove serialization in tests remains (10ms) – real model takes longer
        await asyncio.sleep(0.01)
        try:
            # Run blocking inference in thread pool to avoid blocking event loop
            # Engine.generate is blocking (MLX may be heavy)
            wav_bytes: bytes = await asyncio.to_thread(
                engine.generate,  # type: ignore
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
                if provider_for_engine == "mlx":
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
