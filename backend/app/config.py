import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "var"
DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
DEFAULT_ZEN_URL = "https://opencode.ai/zen/go/v1"
DEFAULT_FALLBACK_MODELS = ("kimi-k2.6",)
DEFAULT_CONTEXT_BUDGET = 8000
DEFAULT_SYSTEM_PROMPT = (
    "You are the AI lesson advisor inside the AI Slideshow Editor. "
    "Answer with the read-only project context in mind and never claim to edit the project directly. "
    "Proposals are canonical engine commands reviewed and approved by the user. "
    "Stages A-E (scenario, reconciliation, prompter/TTS, calibration, board scripts) run only on accepted prior versions."
)
DEFAULT_ANIMATION_SYSTEM_PROMPT = (
    "You are the AI animation advisor inside the AI Slideshow Editor. "
    "Answer with the read-only animation context in mind (scene nodes with stable ids, rig, clips, "
    "clip collections, timeline) and never claim to edit the project directly. "
    "Proposals are canonical engine commands reviewed and approved by the user — primarily "
    "SetSlideAnimationScript compiling to ordinary timeline data. "
    "Stay on animation and camera work; Stages A-E (scenario, reconciliation, prompter/TTS, "
    "calibration, board scripts) belong to the Lesson assistant, not this mode."
)


@dataclass
class Settings:
    frontend_url: str
    development_mode: bool
    data_dir: Path
    database_url: str
    max_upload_bytes: int
    tts_provider: str = "auto"
    tts_model_id: str = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
    opencode_base_url: str = DEFAULT_ZEN_URL
    ai_fallback_models: tuple[str, ...] = DEFAULT_FALLBACK_MODELS
    ai_context_budget: int = DEFAULT_CONTEXT_BUDGET
    ai_secret_key: str | None = None
    ai_system_prompt_default: str = DEFAULT_SYSTEM_PROMPT


def _parse_fallback_models(raw: str | None) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return DEFAULT_FALLBACK_MODELS
    models = tuple(part.strip() for part in raw.split(",") if part.strip())
    return models or DEFAULT_FALLBACK_MODELS


def _parse_context_budget(raw: str | None) -> int:
    if raw is None or not raw.strip():
        return DEFAULT_CONTEXT_BUDGET
    try:
        value = int(raw.strip())
    except ValueError:
        return DEFAULT_CONTEXT_BUDGET
    return value if value > 0 else DEFAULT_CONTEXT_BUDGET


def _load_environment_file(path: Path) -> None:
    load_dotenv(path, override=False)


def load_settings() -> Settings:
    # Load backend/.env for local development; variables exported by the
    # process/container take precedence over values in the file.
    _load_environment_file(Path(__file__).resolve().parents[1] / ".env")
    data_dir = Path(os.getenv("DATA_DIR", str(DEFAULT_DATA_DIR)))
    secret_raw = os.getenv("AI_SECRET_KEY")
    secret = secret_raw.strip() if secret_raw and secret_raw.strip() else None
    return Settings(
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:5173"),
        development_mode=os.getenv("DEVELOPMENT_MODE", "true").lower() in {"1", "true", "yes"},
        data_dir=data_dir,
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{data_dir}/library.db"),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES))),
        tts_provider=os.getenv("TTS_PROVIDER", "auto").strip().lower(),
        tts_model_id=os.getenv(
            "TTS_MODEL_ID", "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
        ).strip(),
        opencode_base_url=os.getenv("OPENCODE_BASE_URL", DEFAULT_ZEN_URL).strip()
        or DEFAULT_ZEN_URL,
        ai_fallback_models=_parse_fallback_models(os.getenv("AI_FALLBACK_MODELS_OPENCODE")),
        ai_context_budget=_parse_context_budget(os.getenv("AI_CONTEXT_BUDGET")),
        ai_secret_key=secret,
    )
