from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.app_factory import AppFactory
from app.config import Settings


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    data_dir = tmp_path / "var"
    return Settings(
        frontend_url="http://localhost:5173",
        development_mode=False,
        data_dir=data_dir,
        database_url=f"sqlite:///{data_dir}/library.db",
        max_upload_bytes=20 * 1024 * 1024,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(AppFactory(settings).create())
