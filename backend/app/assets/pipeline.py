from dataclasses import dataclass
from io import BytesIO

from PIL import Image

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
WEBP_RIFF_SIGNATURE = b"RIFF"
WEBP_MARKER = b"WEBP"

THUMBNAIL_MAX_SIZE = 256


class ImageValidationError(ValueError):
    """Raised when an uploaded file is not an acceptable image."""


def size_error_message(size: int, max_upload_bytes: int) -> str | None:
    """Return the upload-limit error message when size exceeds the cap, else None."""
    if size > max_upload_bytes:
        return f"file exceeds the {max_upload_bytes // (1024 * 1024)} MiB upload limit"
    return None


@dataclass(frozen=True)
class InspectedImage:
    extension: str
    width: int
    height: int
    content: bytes


class ImagePipeline:
    """I sniff, validate, and thumbnail uploaded image bytes."""

    def __init__(self, max_upload_bytes: int) -> None:
        self._max_upload_bytes = max_upload_bytes

    def inspect(self, content: bytes) -> InspectedImage:
        if not content:
            raise ImageValidationError("file is empty")
        size_error = size_error_message(len(content), self._max_upload_bytes)
        if size_error is not None:
            raise ImageValidationError(size_error)
        extension = self._sniff_extension(content)
        if extension is None:
            raise ImageValidationError(
                "unsupported file format — only PNG, JPG, and WEBP are accepted"
            )
        try:
            with Image.open(BytesIO(content)) as image:
                image.verify()
        except (OSError, SyntaxError, ValueError) as exc:
            raise ImageValidationError("corrupt or unreadable image file") from exc
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
        return InspectedImage(extension=extension, width=width, height=height, content=content)

    def create_thumbnail(self, content: bytes) -> bytes:
        with Image.open(BytesIO(content)) as image:
            image.thumbnail((THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            return buffer.getvalue()

    @staticmethod
    def _sniff_extension(content: bytes) -> str | None:
        if content.startswith(PNG_SIGNATURE):
            return ".png"
        if content.startswith(JPEG_SIGNATURE):
            return ".jpg"
        if content.startswith(WEBP_RIFF_SIGNATURE) and content[8:12] == WEBP_MARKER:
            return ".webp"
        return None
