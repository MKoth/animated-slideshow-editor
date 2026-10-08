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

CHALK_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uGrain;
uniform float uNoiseScale;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Deterministic domain warp: offsets the lookup by low-frequency noise so
// cell edges never align to a visible grid. Same input => same output, so
// timeline determinism (same time => same pixels) is preserved.
vec2 warpVec(vec2 p) {
  return vec2(
    noise(p * 0.45 + vec2(13.7, 5.3)),
    noise(p * 0.45 + vec2(7.1, 17.9))
  ) - 0.5;
}

// Minification guard: when a noise cell covers less than a pixel (zoomed
// out), single-sample evaluation aliases into shimmer. Returns 0..1; scale the
// octave's amount so unresolvable detail fades to neutral instead of swimming.
float lodFade(vec2 p) {
  vec2 fw = fwidth(p) + vec2(1e-5);
  return 1.0 - smoothstep(0.35, 1.4, max(fw.x, fw.y));
}

void main() {
  vec4 color = texture(uTexture, vUv);
  float amount = clamp(uGrain, 0.0, 1.0);
  // uNoiseScale is the coarse<->fine control: higher packs more cells across
  // the surface (finer grain), lower stretches them (coarser grain).
  vec2 base = vUv * uNoiseScale;
  vec2 w = warpVec(base) * 1.6;
  float grain = mix(0.5, noise(base + w), amount * lodFade(base));
  float edge = smoothstep(0.2, 0.55, color.a * (0.75 + grain * 0.5));
  // Second octave rotated ~35 degrees and offset so its grid never aligns
  // with the first — this breaks the repeating pattern seen on zoom-out.
  mat2 rot = mat2(0.819, -0.574, 0.574, 0.819);
  vec2 dustP = rot * base * 2.5 + vec2(19.7, 7.9) + w * 2.0;
  float dustNoise = noise(dustP);
  float dust = mix(1.0, smoothstep(0.35, 0.7, dustNoise), amount * lodFade(dustP));
  vec3 chalk = clamp(color.rgb * (0.9 + grain * 0.3), 0.0, 1.0);
  // Pixi composites filter output with premultiplied alpha: the alpha must
  // scale the color, or dusted pixels keep full brightness and opaque strokes
  // never break up.
  float factor = edge * dust;
  fragColor = vec4(chalk * factor, color.a * factor);
}
"""

CHALK_DEFAULT_UNIFORMS: list[dict[str, object]] = [
    {"key": "uGrain", "kind": "float", "default": 0.65},
    {"key": "uNoiseScale", "kind": "float", "default": 220.0},
]

BUILTIN_SHADER_NAMES = ["Grayscale", "Sepia", "Glow", "Blur", "Gradient", "Chalk"]

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
    {
        "id": str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/chalk")),
        "name": "Chalk",
        "description": "Grainy chalk-on-blackboard look: adds noise and erodes edges.",
        "tags": ["built-in", "texture"],
        "source": CHALK_SOURCE,
        "default_uniforms": [dict(uniform) for uniform in CHALK_DEFAULT_UNIFORMS],
        # v2: the grain uniforms are float, not number — uniform kinds must be
        # GLSL kinds or the API cannot serialize the definition.
        # v3: opaque strokes dust too, emitted premultiplied so Pixi's
        # premultiplied blending actually thins them.
        # v4: domain-warped lookups plus a rotated second octave break the
        # visible grid/repeating pattern; an fwidth minification guard fades
        # unresolvable detail to neutral instead of shimmering on zoom-out.
        # uNoiseScale keeps its coarse<->fine meaning. No new uniforms.
        "seed_version": 4,
    },
]

CHALK_SHADER_ID: str = str(uuid5(NAMESPACE_URL, "animated-slideshow-editor/builtin-shader/chalk"))


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
