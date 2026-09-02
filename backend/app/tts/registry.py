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

# Canonical speaker metadata: description + native language hint per spec #253
# Keep aligned with frontend ttsVoices fallback.
SPEAKER_META: dict[str, dict[str, str]] = {
    "Vivian": {"description": "Bright edgy young female", "nativeLanguage": "Chinese", "iso": "zh"},
    "Serena": {"description": "Warm gentle young female", "nativeLanguage": "Chinese", "iso": "zh"},
    "Uncle_Fu": {"description": "Seasoned low mellow", "nativeLanguage": "Chinese", "iso": "zh"},
    "Dylan": {"description": "Beijing", "nativeLanguage": "Chinese", "iso": "zh"},
    "Eric": {"description": "Chengdu", "nativeLanguage": "Chinese", "iso": "zh"},
    "Ryan": {"description": "Dynamic", "nativeLanguage": "English", "iso": "en"},
    "Aiden": {"description": "Sunny American", "nativeLanguage": "English", "iso": "en"},
    "Ono_Anna": {"description": "Playful", "nativeLanguage": "Japanese", "iso": "ja"},
    "Sohee": {"description": "Warm rich", "nativeLanguage": "Korean", "iso": "ko"},
    # Base/VoiceDesign extras (shown when per-model list includes them)
    "Chelsie": {"description": "Clear female", "nativeLanguage": "English", "iso": "en"},
    "Ethan": {"description": "Warm male", "nativeLanguage": "English", "iso": "en"},
}

def _speaker_hint(speaker: str) -> str:
    meta = SPEAKER_META.get(speaker)
    if not meta:
        return speaker
    return f"{meta['description']}, {meta['nativeLanguage']}"


SPEAKER_HINTS: dict[str, str] = {k: _speaker_hint(k) for k in SPEAKER_META}

# Legacy voice alias -> canonical (only nova -> Ryan as migration per spec)
LEGACY_VOICE_TO_CANONICAL: dict[str, str] = {
    "nova": "Ryan",
}

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


def get_speaker_hint(speaker: str) -> str | None:
    return SPEAKER_HINTS.get(speaker)


def get_speaker_meta(speaker: str) -> dict[str, str] | None:
    meta = SPEAKER_META.get(speaker)
    return dict(meta) if meta else None


def get_speaker_hints_for_model(model_id: str) -> dict[str, str]:
    speakers = get_supported_speakers(model_id)
    return {s: SPEAKER_HINTS.get(s, s) for s in speakers}


def is_valid_speaker_for_model(speaker: str, model_id: str) -> bool:
    if not speaker or not speaker.strip():
        return False
    key = speaker.strip().lower()
    speakers = get_supported_speakers(model_id)
    lower_map = {s.lower(): s for s in speakers}
    if key in lower_map:
        return True
    # legacy alias counts as valid (will migrate)
    if key in LEGACY_VOICE_TO_CANONICAL:
        target = LEGACY_VOICE_TO_CANONICAL[key]
        return target.lower() in lower_map
    return False


def normalize_speaker(speaker: str | None, model_id: str | None = None) -> str | None:
    if speaker is None:
        return None
    stripped = speaker.strip()
    if stripped == "":
        return None
    key = stripped.lower()
    if key in LEGACY_VOICE_TO_CANONICAL:
        return LEGACY_VOICE_TO_CANONICAL[key]
    # try case-insensitive match against model-specific or canonical list
    candidates = get_supported_speakers(model_id) if model_id else _CANONICAL_CUSTOMVOICE_SPEAKERS
    lower_map = {s.lower(): s for s in candidates}
    if key in lower_map:
        return lower_map[key]
    # fallback to global meta keys
    global_map = {k.lower(): k for k in SPEAKER_META}
    if key in global_map:
        return global_map[key]
    return None


def default_speaker_for_model(model_id: str, language: str | None = None) -> str:
    lang = (language or "").lower()
    is_zh = lang.startswith("zh") or lang == "chinese"
    default_zh = "Vivian"
    default_en = "Ryan"
    # Ensure default exists in model; otherwise pick first available
    speakers = get_supported_speakers(model_id)
    lower_set = {s.lower() for s in speakers}
    preferred = default_zh if is_zh else default_en
    if preferred.lower() in lower_set:
        return preferred
    # fallback to first speaker of model or hardcode
    return speakers[0] if speakers else preferred


def migrate_stored_voice(
    raw: str | None, model_id: str | None = None, language: str | None = None
) -> tuple[str, bool, str | None]:
    """Return (dropdown_value, is_unknown, warning). dropdown_value is "" for Auto/default."""
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return "", False, None
    stripped = raw.strip()
    key = stripped.lower()
    # Legacy nova -> Ryan migration (not unknown)
    if key in LEGACY_VOICE_TO_CANONICAL:
        return LEGACY_VOICE_TO_CANONICAL[key], False, None
    # Check valid for model (case-insensitive)
    mid = model_id or DEFAULT_MODEL_ID
    speakers = get_supported_speakers(mid)
    lower_map = {s.lower(): s for s in speakers}
    if key in lower_map:
        return lower_map[key], False, None
    # Global canonical check (allow cross-model but still valid? treat as unknown if not in model)
    # If speaker exists globally but not in this model -> unknown for this model
    if key in {k.lower() for k in SPEAKER_META}:
        # known speaker but not supported by this model
        return "", True, f"Voice '{stripped}' not supported by {mid.split('/')[-1]} — using default ({default_speaker_for_model(mid, language)})"
    # Completely unknown
    return "", True, f"Unknown voice '{stripped}' — using default ({default_speaker_for_model(mid, language)})"


def get_model_capabilities(model_id: str) -> dict[str, object]:
    speakers = get_supported_speakers(model_id)
    hints = {s: SPEAKER_HINTS.get(s, s) for s in speakers}
    meta = {s: SPEAKER_META[s] for s in speakers if s in SPEAKER_META}
    return {
        "languages": get_supported_languages(model_id),
        "speakers": speakers,
        "instructionSupported": INSTRUCTION_SUPPORTED_BY_MODEL.get(model_id, False),
        "speakerHints": hints,
        "speakerMeta": meta,
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
