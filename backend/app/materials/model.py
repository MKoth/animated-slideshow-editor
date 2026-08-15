from datetime import datetime

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base

BUILTIN_TINT: dict[str, object] = {"key": "tint", "kind": "color", "default": "#ffffff"}
BUILTIN_OPACITY: dict[str, object] = {
    "key": "opacityMultiplier",
    "kind": "number",
    "default": 1.0,
}
BUILTINS = [BUILTIN_TINT, BUILTIN_OPACITY]


def _builtin_defaults() -> list[dict[str, object]]:
    return [dict(parameter) for parameter in BUILTINS]


class MaterialDefinition(Base):
    """The reusable library record defining a material's parameter set."""

    __tablename__ = "material_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    parameters: Mapped[list[dict[str, object]]] = mapped_column(
        JSON, nullable=False, default=_builtin_defaults
    )
