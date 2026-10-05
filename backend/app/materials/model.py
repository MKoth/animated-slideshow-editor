from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base
from app.shaders.model import CHALK_DEFAULT_UNIFORMS

BUILTIN_TINT: dict[str, object] = {"key": "tint", "kind": "color", "default": "#ffffff"}
BUILTIN_OPACITY: dict[str, object] = {
    "key": "opacityMultiplier",
    "kind": "number",
    "default": 1.0,
}
BUILTINS = [BUILTIN_TINT, BUILTIN_OPACITY]

DEFAULT_MATERIAL_ID: str = str(
    uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-material/default")
)
DEFAULT_MATERIAL_NAME = "Default Material"
DEFAULT_MATERIAL_DESCRIPTION = (
    "The default material every node starts with: tint white, opacity multiplier 1, no shader."
)
DEFAULT_MATERIAL_TAGS = ["built-in", "default"]

CHALK_MATERIAL_ID: str = str(
    uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-material/chalk")
)
CHALK_MATERIAL_NAME = "Chalk"
CHALK_MATERIAL_DESCRIPTION = (
    "The built-in Chalk shader over a node's rendered subtree: grainy edges, chalk-dust texture."
)
CHALK_MATERIAL_TAGS = ["built-in", "texture"]

# The material parameters the Chalk shader reflects, seeded alongside the
# built-in tint and opacity multiplier so a script can address them by name.
CHALK_MATERIAL_PARAMETERS: list[dict[str, object]] = [dict(parameter) for parameter in BUILTINS] + [
    dict(uniform) for uniform in CHALK_DEFAULT_UNIFORMS
]


def _builtin_defaults() -> list[dict[str, object]]:
    return [dict(parameter) for parameter in BUILTINS]


def builtin_material_ids() -> set[str]:
    return {DEFAULT_MATERIAL_ID, CHALK_MATERIAL_ID}


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
    shader_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
