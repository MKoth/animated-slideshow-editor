from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base


class ClipDefinition(Base):
    """The reusable library record defining a clip."""

    __tablename__ = "clip_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    duration: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    params: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    channels: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    channel_animations: Mapped[dict[str, dict[str, object]] | None] = mapped_column(
        JSON, nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
