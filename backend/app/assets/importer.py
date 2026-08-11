from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.assets.categories import DEFAULT_ASSET_CATEGORY, CategoryValidationError, validate_category
from app.assets.model import AssetDefinition
from app.assets.pipeline import ImagePipeline, ImageValidationError, InspectedImage
from app.assets.storage import AssetStorage
from app.database import Database


@dataclass(frozen=True)
class Upload:
    filename: str
    content: bytes
    category: str = DEFAULT_ASSET_CATEGORY


@dataclass(frozen=True)
class UploadError:
    filename: str
    error: str


@dataclass(frozen=True)
class ImportResult:
    created: list[AssetDefinition] = field(default_factory=list)
    errors: list[UploadError] = field(default_factory=list)


class AssetImporter:
    """I import uploaded images into the asset library as one transaction."""

    def __init__(self, database: Database, storage: AssetStorage, pipeline: ImagePipeline) -> None:
        self._database = database
        self._storage = storage
        self._pipeline = pipeline

    def import_uploads(self, uploads: list[Upload], imported_at: datetime) -> ImportResult:
        result = ImportResult()
        written_paths: list[str] = []
        with self._database.session() as session:
            try:
                for upload in uploads:
                    try:
                        validate_category(upload.category)
                        inspected = self._pipeline.inspect(upload.content)
                        definition = self._create_definition(upload, inspected, imported_at)
                        session.add(definition)
                        written_paths.append(definition.original_path)
                        written_paths.append(definition.thumbnail_path)
                        result.created.append(definition)
                    except (ImageValidationError, CategoryValidationError) as exc:
                        result.errors.append(UploadError(filename=upload.filename, error=str(exc)))
                session.commit()
            except Exception:
                for relative_path in written_paths:
                    self._storage.remove(relative_path)
                raise
        return result

    def _create_definition(
        self, upload: Upload, inspected: InspectedImage, imported_at: datetime
    ) -> AssetDefinition:
        definition_id = str(uuid4())
        name = Path(upload.filename).stem or upload.filename
        original_path = self._storage.save_original(
            definition_id, inspected.extension, inspected.content
        )
        thumbnail_path = self._storage.save_thumbnail(
            definition_id, self._pipeline.create_thumbnail(inspected.content)
        )
        return AssetDefinition(
            id=definition_id,
            name=name,
            category=upload.category,
            original_filename=upload.filename,
            import_date=imported_at,
            width=inspected.width,
            height=inspected.height,
            file_size=len(inspected.content),
            aspect_ratio=round(inspected.width / inspected.height, 4),
            original_path=original_path,
            thumbnail_path=thumbnail_path,
        )
