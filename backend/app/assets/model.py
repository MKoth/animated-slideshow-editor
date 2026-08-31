from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.assets.categories import ASSET_CATEGORIES, DEFAULT_ASSET_CATEGORY
from app.model import Base

_CATEGORY_CHECK = CheckConstraint(
    f"category IN ({', '.join(repr(category) for category in ASSET_CATEGORIES)})",
    name="ck_asset_definition_category",
)


class AssetDefinition(Base):
    """The immutable, reusable asset library record."""

    __tablename__ = "asset_definitions"
    __table_args__ = (_CATEGORY_CHECK,)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(
        String(50), nullable=False, default=DEFAULT_ASSET_CATEGORY
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    ai_description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    import_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    aspect_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    default_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    default_rotation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    pivot_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    pivot_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    anchors: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    original_path: Mapped[str] = mapped_column(String(255), nullable=False)
    thumbnail_path: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    asset_metadata: Mapped[dict[str, object] | None] = mapped_column(
        "metadata", JSON, nullable=True, default=None
    )
