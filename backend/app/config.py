import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "var"
DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@dataclass
class Settings:
    frontend_url: str
    development_mode: bool
    data_dir: Path
    database_url: str
    max_upload_bytes: int
    tts_provider: str = "auto"
    tts_model_id: str = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"


def load_settings() -> Settings:
    data_dir = Path(os.getenv("DATA_DIR", str(DEFAULT_DATA_DIR)))
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
    )
