from dataclasses import dataclass
from io import BytesIO

from PIL import Image

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
WEBP_RIFF_SIGNATURE = b"RIFF"
WEBP_MARKER = b"WEBP"

# Audio signatures
WAV_WAVE_MARKER = b"WAVE"
OGG_SIGNATURE = b"OggS"
MP3_ID3_SIGNATURE = b"ID3"
EBML_SIGNATURE = b"\x1a\x45\xdf\xa3"
# MP3 frame sync mask: first byte 0xFF, second byte top 3 bits 0b111
MP3_FRAME_SYNC = 0xFF

THUMBNAIL_MAX_SIZE = 256
AUDIO_THUMBNAIL_SIZE = (256, 64)


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
        if extension is not None:
            try:
                with Image.open(BytesIO(content)) as image:
                    image.verify()
            except (OSError, SyntaxError, ValueError) as exc:
                raise ImageValidationError("corrupt or unreadable image file") from exc
            with Image.open(BytesIO(content)) as image:
                width, height = image.size
            return InspectedImage(extension=extension, width=width, height=height, content=content)
        # Try audio formats before rejecting
        audio_extension = self._sniff_audio_extension(content)
        if audio_extension is not None:
            # Audio assets are stored with dummy dimensions; real metadata comes from decode on the client
            return InspectedImage(extension=audio_extension, width=1, height=1, content=content)
        raise ImageValidationError(
            "unsupported file format — only PNG, JPG, WEBP, WAV, MP3, OGG and WEBM are accepted"
        )

    def create_thumbnail(self, content: bytes) -> bytes:
        # Audio thumbnails are generic waveform placeholders
        if self._sniff_audio_extension(content) is not None:
            placeholder = Image.new("RGBA", AUDIO_THUMBNAIL_SIZE, (26, 26, 26, 255))
            buffer = BytesIO()
            placeholder.save(buffer, format="PNG")
            return buffer.getvalue()
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

    @staticmethod
    def _sniff_audio_extension(content: bytes) -> str | None:
        if len(content) >= 12 and content.startswith(WEBP_RIFF_SIGNATURE) and content[8:12] == WAV_WAVE_MARKER:
            return ".wav"
        if content.startswith(OGG_SIGNATURE):
            return ".ogg"
        if content.startswith(MP3_ID3_SIGNATURE):
            return ".mp3"
        if content.startswith(EBML_SIGNATURE):
            return ".webm"
        # MP3 frame sync without ID3 (first 2 bytes 0xFF 0xFB/0xF3/0xFA etc.)
        if len(content) >= 2 and content[0] == MP3_FRAME_SYNC and (content[1] & 0xE0) == 0xE0:
            return ".mp3"
        # Fallback: treat raw WAV without RIFF? Not needed
        return None
