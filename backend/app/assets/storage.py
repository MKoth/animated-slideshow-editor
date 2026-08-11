from pathlib import Path


def asset_url(relative_path: str) -> str:
    """Map a data-directory-relative path to the URL it is served at."""
    _, subdir, filename = relative_path.split("/")
    return f"/api/assets/{subdir}/{filename}"


class AssetStorage:
    """I write original and thumbnail files under the backend-owned data directory."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._originals_dir = data_dir / "assets" / "originals"
        self._thumbnails_dir = data_dir / "assets" / "thumbnails"

    @property
    def originals_dir(self) -> Path:
        return self._originals_dir

    @property
    def thumbnails_dir(self) -> Path:
        return self._thumbnails_dir

    def ensure_directories(self) -> None:
        self._originals_dir.mkdir(parents=True, exist_ok=True)
        self._thumbnails_dir.mkdir(parents=True, exist_ok=True)

    def save_original(self, definition_id: str, extension: str, content: bytes) -> str:
        """Persist the uploaded bytes verbatim; returns the path relative to the data directory."""
        filename = f"{definition_id}{extension}"
        (self._originals_dir / filename).write_bytes(content)
        return f"assets/originals/{filename}"

    def save_thumbnail(self, definition_id: str, content: bytes) -> str:
        """Persist thumbnail bytes; returns the path relative to the data directory."""
        filename = f"{definition_id}.png"
        (self._thumbnails_dir / filename).write_bytes(content)
        return f"assets/thumbnails/{filename}"

    def remove(self, relative_path: str) -> None:
        """Delete a stored file; missing files are ignored."""
        (self._data_dir / relative_path).unlink(missing_ok=True)
