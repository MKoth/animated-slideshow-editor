# ruff: noqa: BLE001, S110
from __future__ import annotations

import asyncio
import dataclasses
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from app.tts.languages import normalize_language_code

router = APIRouter()

# Global serialized queue for TTS generation — one inference at a time
_tts_lock = asyncio.Lock()


def _resolve_reference_asset_path(request: Request, asset_id: str) -> str:
    """Map an asset-library audio id to its on-disk file path."""
    from app.assets.library import AssetNotFoundError

    asset_library = getattr(request.app.state, "asset_library", None)
    settings = getattr(request.app.state, "settings", None)
    if asset_library is None or settings is None:
        raise HTTPException(status_code=500, detail="asset library unavailable")
    try:
        definition = asset_library.get(asset_id)
    except AssetNotFoundError as e:
        raise HTTPException(
            status_code=404, detail=f"reference audio asset not found: {asset_id}"
        ) from e
    except KeyError as e:
        raise HTTPException(
            status_code=404, detail=f"reference audio asset not found: {asset_id}"
        ) from e
    data_dir = getattr(settings, "data_dir", None)
    if data_dir is None:
        raise HTTPException(status_code=500, detail="data directory unavailable")
    from pathlib import Path

    path = Path(data_dir) / definition.original_path
    try:
        if not path.is_file():
            raise HTTPException(status_code=422, detail=f"reference audio file missing: {asset_id}")
    except OSError as e:
        raise HTTPException(
            status_code=422, detail=f"reference audio unreadable: {asset_id}: {e}"
        ) from e
    return str(path)


def _get_reference_status() -> dict[str, Any]:
    try:
        from app.tts.engine import get_reference_status as _status

        status = _status()
        return dict(status)
    except Exception:
        return {"audioConfigured": False, "textConfigured": False}


class TTSGenerateRequest(BaseModel):
    text: str = Field(description="text to synthesize")
    promptId: str | None = Field(default=None, description="voice prompt id")
    language: str | None = None
    voice: str | None = None
    instruction: str | None = None
    referenceAssetId: str | None = Field(
        default=None, description="asset library audio id used as Base voice-clone reference"
    )
    refText: str | None = Field(
        default=None, description="transcript override for the voice-clone reference audio"
    )
    modelId: str | None = Field(
        default=None, alias="modelId", description="HuggingFace model id override"
    )
    provider: str | None = Field(default=None, description="tts provider override: auto, sine, mlx")

    model_config = {"populate_by_name": True}

    @field_validator("language", mode="before")
    @classmethod
    def validate_language(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise TypeError("language must be a string")
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
            raise TypeError("modelId must be a string")
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
            raise TypeError("provider must be a string")
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
            raise TypeError("provider must be a string")
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
            raise TypeError("modelId must be a string")
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
            raise TypeError("model_id must be a string")
        if v.strip() == "":
            return None
        try:
            from app.tts.registry import normalize_model_id

            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        except Exception:
            return v.strip()


def _get_registry_defaults() -> tuple[
    str, str, list[str], list[str], Callable[[], dict[str, dict[str, object]]]
]:
    try:
        from app.tts.registry import (
            DEFAULT_MODEL_ID,
            DEFAULT_PROVIDER,
            SUPPORTED_MODELS,
            SUPPORTED_PROVIDERS,
            get_all_capabilities,
        )

        return (
            DEFAULT_MODEL_ID,
            DEFAULT_PROVIDER,
            SUPPORTED_MODELS,
            SUPPORTED_PROVIDERS,
            get_all_capabilities,
        )
    except Exception:
        # fallback
        default_model = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
        default_provider = "auto"
        models = [default_model]
        providers = ["auto", "sine", "mlx"]

        def cap():  # type: ignore
            return {
                default_model: {
                    "languages": ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
                    "speakers": [
                        "Vivian",
                        "Serena",
                        "Uncle_Fu",
                        "Dylan",
                        "Eric",
                        "Ryan",
                        "Aiden",
                        "Ono_Anna",
                        "Sohee",
                    ],
                    "instructionSupported": False,
                    "downloaded": False,
                }
            }

        return default_model, default_provider, models, providers, cap


def _enrich_capabilities_with_download(capabilities: dict[str, Any]) -> dict[str, Any]:
    try:
        from app.tts.registry import is_model_downloaded

        enriched: dict[str, Any] = {}
        for mid, cap in capabilities.items():
            try:
                downloaded = is_model_downloaded(mid)
            except Exception:
                downloaded = False
            enriched[mid] = {**cap, "downloaded": downloaded}
        return enriched
    except Exception:
        return capabilities


def _get_download_statuses(models: list[str]) -> dict[str, bool]:
    try:
        from app.tts.registry import is_model_downloaded

        return {m: is_model_downloaded(m) for m in models}
    except Exception:
        return {m: False for m in models}


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
    _default_model, _default_provider, models, providers, get_all = _get_registry_defaults()
    provider, model_id = _get_settings_values(request)
    capabilities = _enrich_capabilities_with_download(get_all())
    download_statuses = _get_download_statuses(models)
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
        "downloaded": download_statuses,
        "modelsStatus": [{"id": m, "downloaded": download_statuses.get(m, False)} for m in models],
        "reference": _get_reference_status(),
        "mlxAvailable": _is_mlx_available(),
    }


@router.get("/tts/capabilities")
def get_tts_capabilities(request: Request) -> dict[str, Any]:
    _default_model, _default_provider, models, providers, get_all = _get_registry_defaults()
    provider, model_id = _get_settings_values(request)
    raw_capabilities = get_all()
    capabilities = _enrich_capabilities_with_download(raw_capabilities)
    download_statuses = _get_download_statuses(models)
    # aggregate languages/speakers across models
    all_languages: set[str] = set()
    all_speakers: set[str] = set()
    for cap in capabilities.values():
        langs = cap.get("languages", [])
        spks = cap.get("speakers", [])
        if isinstance(langs, list):
            all_languages.update(langs)
        if isinstance(spks, list):
            all_speakers.update(spks)
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
        "downloaded": download_statuses,
        "modelsStatus": [{"id": m, "downloaded": download_statuses.get(m, False)} for m in models],
        "reference": _get_reference_status(),
        "mlxAvailable": _is_mlx_available(),
    }


def _is_mlx_available() -> bool:
    try:
        from app.tts.engine import _is_mlx_importable as _check

        return bool(_check())
    except Exception:
        return False


class TtsModelDownloadRequest(BaseModel):
    modelId: str = Field(description="HuggingFace model id to download")

    model_config = {"populate_by_name": True}

    @field_validator("modelId", mode="before")
    @classmethod
    def validate_model_id(cls, v: str | None) -> str | None:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("modelId must be a non-empty string")
        try:
            from app.tts.registry import normalize_model_id

            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


def _snapshot_download_model(model_id: str) -> str:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"huggingface_hub not installed: {e}") from e
    return snapshot_download(repo_id=model_id)


@router.post("/tts/models/download")
async def download_tts_model(body: TtsModelDownloadRequest) -> dict[str, Any]:
    """Pre-download a TTS model's weights so selection takes effect immediately.

    Without this, the weights are fetched implicitly inside the first
    /tts/generate call (blocking it for minutes with no progress feedback).
    """
    model_id = (body.modelId or "").strip()
    async with _tts_lock:
        try:
            path: str = await asyncio.to_thread(_snapshot_download_model, model_id)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"model download failed: {e}") from e
    try:
        from app.tts.registry import is_model_downloaded

        downloaded = is_model_downloaded(model_id)
    except Exception:
        downloaded = True
    return {"modelId": model_id, "downloaded": downloaded, "path": path}


@router.get("/tts/settings")
def get_tts_settings(request: Request) -> dict[str, Any]:
    provider, model_id = _get_settings_values(request)
    _default_model, _default_provider, models, providers, _get_all = _get_registry_defaults()
    download_statuses = _get_download_statuses(models)
    return {
        "provider": provider,
        "modelId": model_id,
        "model_id": model_id,
        "tts_provider": provider,
        "tts_model_id": model_id,
        "models": models,
        "providers": providers,
        "downloaded": download_statuses,
        "modelsStatus": [{"id": m, "downloaded": download_statuses.get(m, False)} for m in models],
        "reference": _get_reference_status(),
        "mlxAvailable": _is_mlx_available(),
    }


@router.put("/tts/settings")
def update_tts_settings(request: Request, body: TtsSettingsUpdate) -> dict[str, Any]:
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        from app.config import load_settings

        settings = load_settings()
        request.app.state.settings = settings
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
            new_provider = normalize_provider(new_provider) or new_provider
        if body.modelId is not None or getattr(body, "model_id", None) is not None:
            new_model_id = normalize_model_id(new_model_id) or new_model_id
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    # Update settings – handle frozen or not
    try:
        # try direct mutation
        settings.tts_provider = new_provider
        settings.tts_model_id = new_model_id
    except Exception:
        try:
            new_settings = dataclasses.replace(
                settings, tts_provider=new_provider, tts_model_id=new_model_id
            )
            request.app.state.settings = new_settings
            settings = new_settings
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"failed to update settings: {exc}"
            ) from exc

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
                    request.app.state.tts_engine = None
                except Exception:
                    pass
        # Preload new engine (handles fallback)
        try:
            engine = get_tts_engine(provider=new_provider, model_id=new_model_id)
            request.app.state.tts_engine = engine
        except MlxNotAvailableError:
            if new_provider == "mlx":
                # Store placeholder that will 503 on next generate – consistent with factory
                request.app.state.tts_engine = MlxQwenTtsEngine(new_model_id)  # type: ignore
            else:
                request.app.state.tts_engine = SineTtsEngine()
        except ValueError as ve:
            raise HTTPException(status_code=422, detail=str(ve)) from ve
        except Exception:
            # fallback to sine
            from app.tts.engine import SineTtsEngine

            request.app.state.tts_engine = SineTtsEngine()
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
    global_provider = (
        getattr(settings, "tts_provider", default_provider) if settings else default_provider
    )
    global_model_id = (
        getattr(settings, "tts_model_id", default_model) if settings else default_model
    )

    effective_provider = (
        body.provider
        if body.provider is not None
        else (prompt_provider if prompt_provider else global_provider)
    )
    effective_model_id = (
        body.modelId
        if body.modelId is not None
        else (prompt_model_id if prompt_model_id else global_model_id)
    )

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

    # Resolve Base voice-clone reference: per-request asset > prompt stored asset > defaults.
    # Engine falls back to TTS_REF_AUDIO / backend/my_voice.wav + transcript when
    # no explicit reference is given, so Base works out of the box.
    try:
        from app.tts.registry import get_model_mode as _mode_for_ref

        _needs_ref = _mode_for_ref(effective_model_id) == "voice_clone"
    except Exception:
        _needs_ref = False
    if _needs_ref:
        ref_asset_id: str | None = None
        if isinstance(body.referenceAssetId, str) and body.referenceAssetId.strip():
            ref_asset_id = body.referenceAssetId.strip()
        elif isinstance(effective_params, dict):
            maybe_ref = effective_params.get("referenceAssetId")
            if isinstance(maybe_ref, str) and maybe_ref.strip():
                ref_asset_id = maybe_ref.strip()
        ref_text_override: str | None = None
        if isinstance(body.refText, str) and body.refText.strip():
            ref_text_override = body.refText.strip()
        elif isinstance(effective_params, dict):
            for _k in ("ref_text", "refText", "referenceText"):
                _v = effective_params.get(_k)
                if isinstance(_v, str) and _v.strip():
                    ref_text_override = _v.strip()
                    break
        merged: dict[str, Any] = (
            dict(effective_params) if isinstance(effective_params, dict) else {}
        )
        if ref_asset_id is not None:
            merged["ref_audio"] = _resolve_reference_asset_path(request, ref_asset_id)
            merged["referenceAssetId"] = ref_asset_id
        if ref_text_override is not None:
            merged["ref_text"] = ref_text_override
        effective_params = merged or None

    # Resolve engine: always use singleton factory with effective values (handles reload)
    provider_for_engine = effective_provider
    model_id_for_engine = effective_model_id
    engine: Any | None = None
    try:
        from app.tts.engine import MlxNotAvailableError, get_tts_engine

        engine = get_tts_engine(provider=provider_for_engine, model_id=model_id_for_engine)
        # Update cache
        try:
            request.app.state.tts_engine = engine
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
                    request.app.state.tts_engine = engine
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
