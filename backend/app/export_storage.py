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


def _folder_part(value: str, limit: int) -> str:
    safe = re.sub(r"[^\w.-]+", "-", value, flags=re.UNICODE).strip(".-_") or "Untitled"
    return safe[:limit].rstrip(".-_") or "Untitled"


def project_export_dir(
    root: Path,
    project_id: str,
    *,
    category_order: int = 0,
    category_name: str = "Uncategorized",
    project_order: int = 0,
    project_name: str = "Project",
) -> Path:
    # IDs remain the stable identity; names and explicit ordering are display-only.
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", project_id).strip("._") or "project"
    category_prefix = "00" if category_name == "Uncategorized" else f"{category_order + 1:02d}"
    result = (
        root
        / (
            f"{category_prefix}-{_folder_part(category_name, 70)}__"
            f"{project_order + 1:02d}-{_folder_part(project_name, 100)}--{safe_id}"
        )
    ).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError("Invalid project id")
    # Adopt the legacy ID-only directory and rename prior derived names by ID.
    if not result.exists() and root.exists():
        candidates = [
            child
            for child in root.iterdir()
            if child.is_dir() and (child.name == safe_id or child.name.endswith(f"--{safe_id}"))
        ]
        if len(candidates) == 1:
            candidates[0].replace(result)
    result.mkdir(parents=True, exist_ok=True)
    return result


def rename_existing_project_export(
    root: Path,
    project_id: str,
    *,
    category_order: int,
    category_name: str,
    project_order: int,
    project_name: str,
) -> Path | None:
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", project_id).strip("._") or "project"
    if not root.is_dir():
        return None
    if not any(
        child.is_dir() and (child.name == safe_id or child.name.endswith(f"--{safe_id}"))
        for child in root.iterdir()
    ):
        return None
    return project_export_dir(
        root,
        project_id,
        category_order=category_order,
        category_name=category_name,
        project_order=project_order,
        project_name=project_name,
    )


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
