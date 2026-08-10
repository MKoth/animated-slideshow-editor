import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    frontend_url: str
    development_mode: bool


def load_settings() -> Settings:
    return Settings(
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:5173"),
        development_mode=os.getenv("DEVELOPMENT_MODE", "true").lower() in {"1", "true", "yes"},
    )
