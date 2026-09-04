from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base


class ClipCollectionDefinition(Base):
    """The reusable library record defining a clip collection."""

    __tablename__ = "clip_collection_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    bindings: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    source_node_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    clips: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
