from datetime import datetime
from typing import cast

from pydantic import BaseModel

from app.assets.model import AssetDefinition, AssetFolder
from app.assets.storage import asset_url


class Pivot(BaseModel):
    x: float
    y: float


class Anchor(BaseModel):
    name: str
    x: float
    y: float


class AssetDefinitionOut(BaseModel):
    id: str
    name: str
    description: str
    category: str
    tags: list[str]
    ai_description: str
    original_filename: str
    import_date: datetime
    width: int
    height: int
    file_size: int
    aspect_ratio: float
    default_scale: float
    default_rotation: float
    pivot: Pivot
    anchors: list[Anchor]
    original_url: str
    thumbnail_url: str
    mimeType: str | None = None
    metadata: dict[str, object] | None = None
    folder_id: str | None = None


class AssetFolderOut(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    created_at: datetime
    updated_at: datetime


class AssetFolderCreate(BaseModel):
    name: str
    parent_id: str | None = None


class AssetFolderUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None


class AssetMoveIn(BaseModel):
    folder_id: str | None = None


class PeaksOut(BaseModel):
    peaks: list[int]
    duration: float | None = None
    sampleRate: int | None = None
    channels: int | None = None


class UploadErrorOut(BaseModel):
    filename: str
    error: str


class UploadResult(BaseModel):
    created: list[AssetDefinitionOut]
    errors: list[UploadErrorOut]


def definition_to_schema(definition: AssetDefinition) -> AssetDefinitionOut:
    return AssetDefinitionOut(
        id=definition.id,
        name=definition.name,
        description=definition.description,
        category=definition.category,
        tags=definition.tags,
        ai_description=definition.ai_description,
        original_filename=definition.original_filename,
        import_date=definition.import_date,
        width=definition.width,
        height=definition.height,
        file_size=definition.file_size,
        aspect_ratio=definition.aspect_ratio,
        default_scale=definition.default_scale,
        default_rotation=definition.default_rotation,
        pivot=Pivot(x=definition.pivot_x, y=definition.pivot_y),
        anchors=[
            Anchor(
                name=cast(str, anchor["name"]),
                x=cast(float, anchor["x"]),
                y=cast(float, anchor["y"]),
            )
            for anchor in definition.anchors
        ],
        original_url=asset_url(definition.original_path),
        thumbnail_url=asset_url(definition.thumbnail_path),
        mimeType=definition.mime_type,
        metadata=definition.asset_metadata,
        folder_id=definition.folder_id,
    )


def folder_to_schema(folder: AssetFolder) -> AssetFolderOut:
    return AssetFolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )
