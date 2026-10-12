from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.config import _load_environment_file


def test_load_environment_file_reads_secret_without_overriding_exported_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("AI_SECRET_KEY=from-file\n")

    monkeypatch.delenv("AI_SECRET_KEY", raising=False)
    _load_environment_file(env_file)
    assert os.environ["AI_SECRET_KEY"] == "from-file"

    monkeypatch.setenv("AI_SECRET_KEY", "from-process")
    env_file.write_text("AI_SECRET_KEY=from-file-again\n")
    _load_environment_file(env_file)
    assert os.environ["AI_SECRET_KEY"] == "from-process"
