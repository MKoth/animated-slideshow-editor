from __future__ import annotations

# Supported HuggingFace model ids for Qwen3-TTS 12Hz family
SUPPORTED_MODELS: list[str] = [
    "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
]

DEFAULT_MODEL_ID: str = SUPPORTED_MODELS[0]

SUPPORTED_PROVIDERS: list[str] = ["auto", "sine", "mlx"]

DEFAULT_PROVIDER: str = "auto"

# Per-model speaker lists
# CustomVoice models share the 9 canonical voices
_CANONICAL_CUSTOMVOICE_SPEAKERS: list[str] = [
    "Vivian",
    "Serena",
    "Uncle_Fu",
    "Dylan",
    "Eric",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
]

# Base models may use different names; simplified mapping for future distinct sets
_BASE_SPEAKERS: list[str] = [
    "Chelsie",
    "Ethan",
    "Vivian",
    "Serena",
    "Ryan",
    "Aiden",
]

# VoiceDesign may use generic VoiceDesign voices
_VOICEDESIGN_SPEAKERS: list[str] = [
    "Vivian",
    "Serena",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
    "Chelsie",
    "Ethan",
]

# Languages supported per model – all support the same 10 + Auto
_SUPPORTED_LANGUAGES: list[str] = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]

SPEAKERS_BY_MODEL: dict[str, list[str]] = {
    "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16": _CANONICAL_CUSTOMVOICE_SPEAKERS,
    "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16": _CANONICAL_CUSTOMVOICE_SPEAKERS,
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16": _BASE_SPEAKERS,
    "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16": _BASE_SPEAKERS,
    "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16": _VOICEDESIGN_SPEAKERS,
}

LANGUAGES_BY_MODEL: dict[str, list[str]] = {m: list(_SUPPORTED_LANGUAGES) for m in SUPPORTED_MODELS}

# Instruction support per model – 0.6B does NOT support instruction, 1.7B does
INSTRUCTION_SUPPORTED_BY_MODEL: dict[str, bool] = {
    "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16": False,
    "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16": True,
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16": False,
    "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16": False,
    "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16": True,
}


def is_valid_model(model_id: str) -> bool:
    return model_id in SUPPORTED_MODELS


def is_valid_provider(provider: str) -> bool:
    return provider in SUPPORTED_PROVIDERS


def get_supported_speakers(model_id: str) -> list[str]:
    # Return speakers for model, fallback to canonical if unknown model
    return list(SPEAKERS_BY_MODEL.get(model_id, _CANONICAL_CUSTOMVOICE_SPEAKERS))


def get_supported_languages(model_id: str) -> list[str]:
    return list(LANGUAGES_BY_MODEL.get(model_id, _SUPPORTED_LANGUAGES))


def get_model_capabilities(model_id: str) -> dict[str, object]:
    return {
        "languages": get_supported_languages(model_id),
        "speakers": get_supported_speakers(model_id),
        "instructionSupported": INSTRUCTION_SUPPORTED_BY_MODEL.get(model_id, False),
    }


def get_all_capabilities() -> dict[str, dict[str, object]]:
    return {m: get_model_capabilities(m) for m in SUPPORTED_MODELS}


def normalize_provider(raw: str | None) -> str | None:
    if raw is None:
        return None
    normalized = raw.strip().lower()
    if normalized not in SUPPORTED_PROVIDERS:
        raise ValueError(f"unknown provider '{raw}'; must be one of {', '.join(SUPPORTED_PROVIDERS)}")
    return normalized


def normalize_model_id(raw: str | None) -> str | None:
    if raw is None:
        return None
    stripped = raw.strip()
    if stripped == "":
        return None
    if stripped not in SUPPORTED_MODELS:
        raise ValueError(f"unknown modelId '{raw}'; must be one of {', '.join(SUPPORTED_MODELS)}")
    return stripped


def is_model_downloaded(model_id: str) -> bool:
    """Check if model weights are fully cached locally (no download needed)."""
    if model_id not in SUPPORTED_MODELS:
        return False
    try:
        from huggingface_hub import try_to_load_from_cache

        # Fast path: single-file model
        if try_to_load_from_cache(repo_id=model_id, filename="model.safetensors") is not None:
            return True
        # Sharded model: index + all shards
        index_path = try_to_load_from_cache(
            repo_id=model_id, filename="model.safetensors.index.json"
        )
        if index_path is not None:
            import json

            try:
                with open(index_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                return False
            weight_map = data.get("weight_map", {}) if isinstance(data, dict) else {}
            shards: set[str] = set()
            if isinstance(weight_map, dict):
                for v in weight_map.values():
                    if isinstance(v, str) and v:
                        shards.add(v)
            if not shards:
                return False
            for shard in shards:
                if try_to_load_from_cache(repo_id=model_id, filename=shard) is None:
                    return False
            return True
        # No model file nor index -> not fully downloaded
        return False
    except Exception:
        return False


def get_all_download_statuses() -> dict[str, bool]:
    return {m: is_model_downloaded(m) for m in SUPPORTED_MODELS}


def get_model_capabilities_with_status(model_id: str) -> dict[str, object]:
    base = get_model_capabilities(model_id)
    return {**base, "downloaded": is_model_downloaded(model_id)}
