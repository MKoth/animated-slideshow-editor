from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base

GRAYSCALE_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(vec3(luma), color.a);
}
"""

SEPIA_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  float r = dot(color.rgb, vec3(0.393, 0.769, 0.189));
  float g = dot(color.rgb, vec3(0.349, 0.686, 0.168));
  float b = dot(color.rgb, vec3(0.272, 0.534, 0.131));
  fragColor = vec4(r, g, b, color.a);
}
"""

GLOW_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 glow = color.rgb * (1.0 + luma * 0.6);
  fragColor = vec4(clamp(glow, 0.0, 1.0), color.a);
}
"""

BLUR_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec2 texel = 1.0 / vec2(textureSize(uTexture, 0));
  vec4 sum = vec4(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      sum += texture(uTexture, vUv + vec2(float(x), float(y)) * texel);
    }
  }
  fragColor = sum / 9.0;
}
"""

GRADIENT_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uStartColor;
uniform vec3 uEndColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(mix(uEndColor, uStartColor, vUv.y), 1.0);
}
"""

BUILTIN_SHADER_NAMES = ["Grayscale", "Sepia", "Glow", "Blur", "Gradient"]

BUILTIN_SHADERS: list[dict[str, object]] = [
    {
        "id": str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/grayscale")),
        "name": "Grayscale",
        "description": "Renders the texture in shades of gray.",
        "tags": ["built-in", "color"],
        "source": GRAYSCALE_SOURCE,
        "seed_version": 1,
    },
    {
        "id": str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/sepia")),
        "name": "Sepia",
        "description": "Applies a warm sepia tone to the texture.",
        "tags": ["built-in", "color"],
        "source": SEPIA_SOURCE,
        "seed_version": 1,
    },
    {
        "id": str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/glow")),
        "name": "Glow",
        "description": "Brightens luminous areas for a soft glow.",
        "tags": ["built-in", "color"],
        "source": GLOW_SOURCE,
        "seed_version": 1,
    },
    {
        "id": str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/blur")),
        "name": "Blur",
        "description": "Smooths the texture with a nine-tap box blur.",
        "tags": ["built-in", "blur"],
        "source": BLUR_SOURCE,
        "seed_version": 1,
    },
    {
        "id": str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/gradient")),
        "name": "Gradient",
        "description": "Renders a vertical gradient with configurable start and end colors.",
        "tags": ["built-in", "color"],
        "source": GRADIENT_SOURCE,
        "default_uniforms": [
            {"key": "uStartColor", "kind": "vec3", "default": [0.0, 0.25, 0.5]},
            {"key": "uEndColor", "kind": "vec3", "default": [0.9, 0.9, 1.0]},
        ],
        "seed_version": 2,
    },
]


class ShaderDefinition(Base):
    """The reusable library record holding a fragment shader and its uniform defaults."""

    __tablename__ = "shader_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    default_uniforms: Mapped[list[dict[str, object]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    seed_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
