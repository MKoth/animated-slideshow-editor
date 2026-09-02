from datetime import datetime

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base


class VoicePrompt(Base):
    """Reusable text preset for local TTS generation."""

    __tablename__ = "voice_prompts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)
    voice: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    params: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True, default=None)
    model_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    provider: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
