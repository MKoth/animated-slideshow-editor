# mypy: disable-error-code="unused-ignore,attr-defined,import-not-found,import-untyped"
# ruff: noqa: BLE001, S110, F401
from __future__ import annotations

import io
import math
import struct
import threading
import wave
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# Language / voice mapping for Qwen3-TTS CustomVoice
# ---------------------------------------------------------------------------

# ISO 639-1 -> Qwen language string capitalised. Qwen supports:
# Chinese, English, Japanese, Korean, German, French, Russian,
# Portuguese, Spanish, Italian, Auto
# Keep _LANGUAGE_MAP for backwards compatibility; canonical source is tts.languages
_LANGUAGE_MAP: dict[str, str] = {
    "en": "English",
    "eng": "English",
    "english": "English",
    "zh": "Chinese",
    "zho": "Chinese",
    "chinese": "Chinese",
    "cmn": "Chinese",
    "ja": "Japanese",
    "jpn": "Japanese",
    "japanese": "Japanese",
    "ko": "Korean",
    "kor": "Korean",
    "korean": "Korean",
    "de": "German",
    "deu": "German",
    "ger": "German",
    "german": "German",
    "fr": "French",
    "fra": "French",
    "fre": "French",
    "french": "French",
    "ru": "Russian",
    "rus": "Russian",
    "russian": "Russian",
    "pt": "Portuguese",
    "por": "Portuguese",
    "portuguese": "Portuguese",
    "es": "Spanish",
    "spa": "Spanish",
    "spanish": "Spanish",
    "it": "Italian",
    "ita": "Italian",
    "italian": "Italian",
    "auto": "Auto",
}

# Re-export canonical language constants for validators
try:
    from app.tts.languages import (
        ALLOWED_TTS_ISOS as _ALLOWED_TTS_ISOS,
    )
    from app.tts.languages import (
        LANGUAGE_OPTIONS as _LANGUAGE_OPTIONS,
    )
    from app.tts.languages import (
        TTS_ISO_TO_DISPLAY as _TTS_ISO_TO_DISPLAY,
    )
    from app.tts.languages import (
        normalize_language_code as _normalize_language_code,
    )
except Exception:  # pragma: no cover
    _ALLOWED_TTS_ISOS = set()
    _LANGUAGE_OPTIONS = []
    _TTS_ISO_TO_DISPLAY = {}
    _normalize_language_code = lambda x: x  # type: ignore

# Canonical speakers for mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16
# case-insensitive, but we keep canonical capitalisation for the model.
_CANONICAL_SPEAKERS: list[str] = [
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
_SPEAKER_LOWER_MAP: dict[str, str] = {s.lower(): s for s in _CANONICAL_SPEAKERS}
_DEFAULT_SPEAKER_EN = "Ryan"
_DEFAULT_SPEAKER_ZH = "Vivian"

# Re-export registry for capabilities exposure
try:
    from app.tts.registry import (
        DEFAULT_MODEL_ID as _DEFAULT_MODEL_ID,
    )
    from app.tts.registry import (
        DEFAULT_PROVIDER as _DEFAULT_PROVIDER,
    )
    from app.tts.registry import (
        SUPPORTED_MODELS as _SUPPORTED_MODELS,
    )
    from app.tts.registry import (
        SUPPORTED_PROVIDERS as _SUPPORTED_PROVIDERS,
    )
    from app.tts.registry import (
        get_all_capabilities as _get_all_capabilities,
    )
    from app.tts.registry import (
        get_model_capabilities as _get_model_capabilities,
    )
    from app.tts.registry import (
        get_supported_languages as _get_supported_languages,
    )
    from app.tts.registry import (
        get_supported_speakers as _get_supported_speakers,
    )
    from app.tts.registry import (
        is_valid_model as _is_valid_model,
    )
    from app.tts.registry import (
        is_valid_provider as _is_valid_provider,
    )
except Exception:  # pragma: no cover
    _DEFAULT_MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
    _DEFAULT_PROVIDER = "auto"
    _SUPPORTED_MODELS = [_DEFAULT_MODEL_ID]
    _SUPPORTED_PROVIDERS = ["auto", "sine", "mlx"]

    def _get_supported_speakers(model_id: str) -> list[str]:  # type: ignore[no-redef]
        return list(_CANONICAL_SPEAKERS)

    def _get_supported_languages(model_id: str) -> list[str]:  # type: ignore[no-redef]
        return ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]

    def _get_model_capabilities(model_id: str) -> dict[str, object]:  # type: ignore[no-redef]
        return {
            "languages": _get_supported_languages(model_id),
            "speakers": _get_supported_speakers(model_id),
            "instructionSupported": False,
        }

    def _get_all_capabilities() -> dict[str, dict[str, object]]:  # type: ignore[no-redef]
        return {m: _get_model_capabilities(m) for m in _SUPPORTED_MODELS}

    def _is_valid_model(model_id: str) -> bool:  # type: ignore[no-redef]
        return model_id == _DEFAULT_MODEL_ID

    def _is_valid_provider(p: str) -> bool:  # type: ignore[no-redef]
        return p in _SUPPORTED_PROVIDERS


def map_language(raw: str | None) -> str:
    if not raw:
        return "Auto"
    key = raw.strip().lower()
    # handle locale like en-US, en_US, es-419
    # take primary tag before - or _
    primary = key.split("-")[0].split("_")[0]
    if primary in _LANGUAGE_MAP:
        return _LANGUAGE_MAP[primary]
    if key in _LANGUAGE_MAP:
        return _LANGUAGE_MAP[key]
    return "Auto"


def map_speaker(raw: str | None, language: str | None = None) -> str:
    if not raw:
        # pick default based on language
        lang = (language or "").lower()
        if lang.startswith("zh") or lang == "chinese":
            return _DEFAULT_SPEAKER_ZH
        return _DEFAULT_SPEAKER_EN
    key = raw.strip().lower()
    if key in _SPEAKER_LOWER_MAP:
        return _SPEAKER_LOWER_MAP[key]
    # handle voice names like "nova", "alloy" – map to defaults
    # we keep deterministic fallback instead of error: return default en
    return _DEFAULT_SPEAKER_EN


def _wav_bytes_from_float32(samples: Any, sample_rate: int, channels: int = 1) -> bytes:
    """Encode float32 [-1,1] samples to 16-bit PCM WAV bytes."""
    import numpy as np  # type: ignore[import-not-found]

    # samples may be mx.array (convertible via np.array) or already np array
    arr = np.asarray(samples, dtype=np.float32)
    # flatten if 2D
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    # clip and scale
    arr = np.clip(arr, -1.0, 1.0)
    int16 = (arr * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int16.tobytes())
    return buf.getvalue()


def _generate_sine_wav(duration: float, sample_rate: int, channels: int, freq: float) -> bytes:
    n_samples = int(duration * sample_rate)
    amplitude = 0.25 * 32767
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        for i in range(n_samples):
            t = i / sample_rate
            sample = math.sin(2 * math.pi * freq * t) * amplitude
            if i < int(0.005 * sample_rate):
                sample *= i / (0.005 * sample_rate)
            elif i > n_samples - int(0.005 * sample_rate):
                sample *= (n_samples - i) / (0.005 * sample_rate)
            packed = struct.pack("<h", int(sample))
            for _ in range(channels):
                wf.writeframes(packed)
    return buffer.getvalue()


def _wav_bytes_for_text_sine(
    text: str,
    prompt_id: str | None,
    language: str | None,
    voice: str | None,
    instruction: str | None = None,
) -> bytes:
    # Deterministic duration: 0.06*len +0.35, clamped 0.5..30
    length = len(text.strip())
    if length == 0:
        length = 1
    duration = max(0.5, length * 0.06 + 0.35)
    duration = min(duration, 30.0)
    sample_rate = 24000
    channels = 1
    base_freq = 220.0
    if prompt_id:
        h = sum(ord(c) for c in prompt_id) % 40
        base_freq = 200 + h
    elif voice:
        h = sum(ord(c) for c in voice) % 60
        base_freq = 180 + h
    elif language:
        base_freq = 220 if language.lower().startswith("en") else 200
    # instruction variation: slight freq shift to prove it is read (if provided)
    if instruction:
        h2 = sum(ord(c) for c in instruction) % 20
        base_freq += (h2 - 10) * 0.5
    return _generate_sine_wav(duration, sample_rate, channels, base_freq)


# ---------------------------------------------------------------------------
# Engine protocol + implementations
# ---------------------------------------------------------------------------


class TtsEngine(Protocol):
    def generate(
        self,
        text: str,
        language: str | None = None,
        voice: str | None = None,
        instruction: str | None = None,
        params: dict[str, object] | None = None,
    ) -> bytes: ...


class SineTtsEngine:
    """Deterministic sine fallback – no MLX required."""

    def generate(
        self,
        text: str,
        language: str | None = None,
        voice: str | None = None,
        instruction: str | None = None,
        params: dict[str, object] | None = None,
    ) -> bytes:
        # params currently ignored for sine (could affect duration/freq in future)
        return _wav_bytes_for_text_sine(text, None, language, voice, instruction)


class MlxQwenTtsEngine:
    """MLX Qwen3-TTS 0.6B CustomVoice via mlx-audio.

    Loads `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16` once.
    Thread-safe, blocking. Caller must serialize via asyncio.Lock.
    """

    def __init__(self, model_id: str) -> None:
        self._model_id = model_id
        self._model: Any | None = None
        self._load_lock = threading.Lock()
        self._sample_rate = 24000

    def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            # lazy import – may raise ImportError
            try:
                # mlx-audio provides two entrypoints, try both
                try:
                    from mlx_audio.tts.utils import load_model  # type: ignore

                    model = load_model(self._model_id)
                except ImportError:
                    from mlx_audio.tts.utils import load  # type: ignore

                    model = load(self._model_id)
            except ImportError as e:
                raise MlxNotAvailableError(f"mlx-audio not installed: {e}") from e
            except Exception as e:
                raise TtsModelLoadError(f"failed to load TTS model {self._model_id}: {e}") from e
            # model should expose sample_rate
            try:
                self._sample_rate = int(getattr(model, "sample_rate", 24000))
            except Exception:
                pass
            self._model = model
            return model

    def generate(
        self,
        text: str,
        language: str | None = None,
        voice: str | None = None,
        instruction: str | None = None,
        params: dict[str, object] | None = None,
    ) -> bytes:
        model = self._ensure_model()
        # Map to Qwen conventions
        qwen_lang = map_language(language)
        qwen_speaker = map_speaker(voice, language)
        # instruction may be None -> default None
        instruct = (
            instruction.strip() if isinstance(instruction, str) and instruction.strip() else None
        )

        # Extract generation kwargs from params if provided
        gen_kwargs: dict[str, Any] = {}
        if isinstance(params, dict):
            # allow params to override temperature etc.
            for k in ("temperature", "top_k", "top_p", "repetition_penalty", "max_tokens"):
                if k in params:
                    gen_kwargs[k] = params[k]

        # Call mlx-audio generate_custom_voice
        try:
            # Prefer generate_custom_voice for CustomVoice models
            # fallback to generic generate if needed
            if hasattr(model, "generate_custom_voice"):
                gen = model.generate_custom_voice(
                    text=text,
                    speaker=qwen_speaker,
                    language=qwen_lang,
                    instruct=instruct,
                    **gen_kwargs,
                )
            else:
                gen = model.generate(
                    text=text,
                    voice=qwen_speaker,
                    instruct=instruct,
                    lang_code=qwen_lang.lower(),
                    **gen_kwargs,
                )
            results = list(gen)
        except Exception as e:
            raise TtsInferenceError(f"TTS inference failed: {e}") from e

        if not results:
            raise TtsInferenceError("TTS model returned no audio")

        # Concatenate if multiple segments (split_pattern)
        # Each result has .audio (mx.array) and maybe .sample_rate
        try:
            import mlx.core as mx  # type: ignore
            import numpy as np  # type: ignore[import-not-found]
        except ImportError as e:
            raise MlxNotAvailableError(f"mlx not installed: {e}") from e

        audios: list[Any] = []
        for r in results:
            audio = getattr(r, "audio", None)
            if audio is None:
                # some versions return tuple or raw array
                audio = r
            # ensure evaluated
            try:
                mx.eval(audio)
            except Exception:
                pass
            audios.append(audio)

        if len(audios) == 1:
            final_audio = audios[0]
        else:
            # concatenate along last axis
            try:
                final_audio = mx.concatenate(audios, axis=-1)  # type: ignore
                mx.eval(final_audio)
            except Exception:
                # fallback numpy concat
                import numpy as np  # type: ignore[import-not-found]

                np_arrays = [np.asarray(a) for a in audios]
                final_audio = np.concatenate(np_arrays, axis=-1)

        # Handle sample_rate from result vs model
        sr = self._sample_rate
        # try to get sr from first result
        if results and hasattr(results[0], "sample_rate"):
            try:
                sr = int(results[0].sample_rate)  # type: ignore
            except Exception:
                pass

        # Encode to WAV
        try:
            wav_bytes = _wav_bytes_from_float32(final_audio, sr, 1)
        except Exception as e:
            raise TtsInferenceError(f"failed to encode WAV: {e}") from e
        if len(wav_bytes) < 44:
            raise TtsInferenceError("generated WAV too short")
        return wav_bytes


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class TtsError(RuntimeError):
    pass


class MlxNotAvailableError(TtsError):
    """mlx or mlx-audio not installed – fallback to sine in auto mode."""


class TtsModelLoadError(TtsError):
    """Model download/load failed – should surface 503 in auto/mlx mode."""


class TtsInferenceError(TtsError):
    """Inference failed – 500/503."""


# ---------------------------------------------------------------------------
# Singleton factory
# ---------------------------------------------------------------------------

_singleton_lock = threading.Lock()
_singleton_engine: TtsEngine | None = None
_singleton_provider: str | None = None
_singleton_model_id: str | None = None


def _is_mlx_importable() -> bool:
    try:
        from mlx_audio.tts.utils import load, load_model  # type: ignore

        return True
    except Exception:
        return False


def get_tts_engine(
    provider: str | None = None,
    model_id: str | None = None,
) -> TtsEngine:
    """Return singleton TTS engine based on provider.

    provider: 'auto' | 'sine' | 'mlx' | None (None -> env TTS_PROVIDER or auto)
    model_id: huggingface id or None -> env TTS_MODEL_ID or default bf16
    In 'auto': if mlx importable, return Mlx engine (lazy load), else Sine.
             If Mlx load fails with MlxNotAvailable, fallback to Sine.
             If Mlx load fails with TtsModelLoadError/TtsInferenceError, raise.
    In 'mlx': force Mlx, raise if not available.
    In 'sine': always Sine.
    """
    import os

    # Validate against registry if available
    try:
        from app.tts.registry import (
            DEFAULT_MODEL_ID as _DEF_MID,
        )
        from app.tts.registry import (
            DEFAULT_PROVIDER as _DEF_PROV,
        )
        from app.tts.registry import (
            is_valid_model as _is_valid_model,
        )
        from app.tts.registry import (
            is_valid_provider as _is_valid_provider,
        )
    except Exception:  # pragma: no cover
        _DEF_MID = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
        _DEF_PROV = "auto"
        _is_valid_model = lambda x: True  # type: ignore
        _is_valid_provider = lambda x: x in ("auto", "sine", "mlx")  # type: ignore

    raw_provider = provider if provider is not None else os.getenv("TTS_PROVIDER", _DEF_PROV)
    eff_provider = (raw_provider or _DEF_PROV).strip().lower()
    if not _is_valid_provider(eff_provider):
        raise ValueError(f"unknown provider '{eff_provider}'")
    raw_model_id = (
        model_id
        if model_id is not None
        else os.getenv("TTS_MODEL_ID", _DEF_MID)
    )
    eff_model_id = (raw_model_id or _DEF_MID).strip()
    if not _is_valid_model(eff_model_id):
        raise ValueError(f"unknown modelId '{eff_model_id}'")

    global _singleton_engine, _singleton_provider, _singleton_model_id
    with _singleton_lock:
        if (
            _singleton_engine is not None
            and _singleton_provider == eff_provider
            and _singleton_model_id == eff_model_id
        ):
            return _singleton_engine

        if eff_provider == "sine":
            engine: TtsEngine = SineTtsEngine()
        elif eff_provider == "mlx":
            # force mlx – if not importable, raise immediately as 503 should be surfaced
            if not _is_mlx_importable():
                raise MlxNotAvailableError("TTS_PROVIDER=mlx but mlx-audio not installed")
            engine = MlxQwenTtsEngine(eff_model_id)
        else:  # auto
            if _is_mlx_importable():
                engine = MlxQwenTtsEngine(eff_model_id)
            else:
                engine = SineTtsEngine()

        _singleton_engine = engine
        _singleton_provider = eff_provider
        _singleton_model_id = eff_model_id
        return engine


def _reset_singleton_for_tests() -> None:
    """Test helper to reset singleton."""
    global _singleton_engine, _singleton_provider, _singleton_model_id
    with _singleton_lock:
        _singleton_engine = None
        _singleton_provider = None
        _singleton_model_id = None


def reset_tts_engine_singleton() -> None:
    """Production helper to reset singleton (used on settings change)."""
    _reset_singleton_for_tests()


def get_supported_speakers(model_id: str | None = None) -> list[str]:
    try:
        from app.tts.registry import DEFAULT_MODEL_ID as _DEF
        from app.tts.registry import get_supported_speakers as _reg_speakers

        mid = model_id or _DEF
        return _reg_speakers(mid)
    except Exception:
        return list(_CANONICAL_SPEAKERS)


def get_supported_languages(model_id: str | None = None) -> list[str]:
    try:
        from app.tts.registry import DEFAULT_MODEL_ID as _DEF
        from app.tts.registry import get_supported_languages as _reg_langs

        mid = model_id or _DEF
        return _reg_langs(mid)
    except Exception:
        return list(_ALLOWED_TTS_ISOS) if _ALLOWED_TTS_ISOS else ["en", "zh"]


def get_model_capabilities(model_id: str) -> dict[str, object]:
    try:
        from app.tts.registry import get_model_capabilities as _reg_cap

        return _reg_cap(model_id)
    except Exception:
        return {
            "languages": get_supported_languages(model_id),
            "speakers": get_supported_speakers(model_id),
            "instructionSupported": False,
        }


def get_all_capabilities() -> dict[str, dict[str, object]]:
    try:
        from app.tts.registry import get_all_capabilities as _reg_all

        return _reg_all()
    except Exception:
        return {m: get_model_capabilities(m) for m in [_DEFAULT_MODEL_ID]}
