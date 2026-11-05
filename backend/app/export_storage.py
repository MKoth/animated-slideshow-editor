from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

DEFAULT_EXPORT_ROOT = Path(__file__).resolve().parents[1] / "exports"


def settings_file(data_dir: Path) -> Path:
    return data_dir / "export_settings.json"


def load_export_root(data_dir: Path) -> Path:
    path = settings_file(data_dir)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        root = Path(raw["exportRoot"]).expanduser()
        if root.is_absolute():
            return root
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return DEFAULT_EXPORT_ROOT


def save_export_root(data_dir: Path, value: str) -> Path:
    root = Path(value).expanduser()
    if not root.is_absolute():
        raise ValueError("Export directory must be an absolute path")
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    path = settings_file(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"exportRoot": str(root)}, indent=2), encoding="utf-8")
    return root


def project_export_dir(root: Path, project_id: str) -> Path:
    # Project ids are opaque, but never allow them to escape the configured root.
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", project_id).strip("._") or "project"
    result = (root / safe_id).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError("Invalid project id")
    result.mkdir(parents=True, exist_ok=True)
    return result


def read_manifest(project_dir: Path) -> dict[str, Any]:
    try:
        data = json.loads((project_dir / "export-manifest.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {
            "slides": {},
            "joinedOutdated": True,
            "joinedReady": False,
            "subtitlesReady": False,
            "subtitlesOutdated": True,
        }


def write_manifest(project_dir: Path, manifest: dict[str, Any]) -> None:
    (project_dir / "export-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
