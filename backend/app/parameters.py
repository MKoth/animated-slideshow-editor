"""Shared validation and normalization for parameter and uniform defaults.

Material parameters (kinds: color, number) and shader uniform defaults (kinds:
float, int, bool, vec2/3/4, sampler2D) share their default-value rules; a
shader's uniforms append to a material's parameter list, so both sides must
agree on how a default is stored and validated.
"""

from __future__ import annotations

import math
import re
from typing import Literal

ParameterKind = Literal[
    "color", "number", "float", "int", "bool", "vec2", "vec3", "vec4", "sampler2D"
]

UniformKind = Literal["float", "int", "bool", "vec2", "vec3", "vec4", "sampler2D"]

UNIFORM_KINDS: tuple[str, ...] = ("float", "int", "bool", "vec2", "vec3", "vec4", "sampler2D")

VEC_COMPONENTS: dict[str, int] = {"vec2": 2, "vec3": 3, "vec4": 4}

# Uniform keys reserved from user uniforms: the implicit source sampler and
# the material built-in parameter keys, which uniforms must never shadow.
RESERVED_UNIFORM_KEYS: frozenset[str] = frozenset({"uTexture", "tint", "opacityMultiplier"})

_COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$", flags=re.IGNORECASE)

ParameterDefault = str | float | int | bool | list[float]


class ParameterValidationError(ValueError):
    """Raised when a parameter default does not match its kind."""


def normalize_parameter_default(kind: str, default: object, key: str) -> ParameterDefault:
    """Validate a default value for its kind and return the canonical form."""
    if kind == "color":
        if not isinstance(default, str) or not _COLOR_PATTERN.match(default):
            raise ParameterValidationError(
                f"parameter {key}: color default must be a hex color like #ff0000"
            )
        return default.lower()
    if kind in ("number", "float"):
        if (
            isinstance(default, bool)
            or not isinstance(default, (int, float))
            or not math.isfinite(float(default))
        ):
            raise ParameterValidationError(
                f"parameter {key}: {kind} default must be a finite number"
            )
        return float(default)
    if kind == "int":
        if (
            isinstance(default, bool)
            or not isinstance(default, (int, float))
            or not math.isfinite(float(default))
            or not float(default).is_integer()
        ):
            raise ParameterValidationError(f"parameter {key}: int default must be an integer")
        return int(default)
    if kind == "bool":
        if not isinstance(default, bool):
            raise ParameterValidationError(f"parameter {key}: bool default must be a boolean")
        return default
    components = VEC_COMPONENTS.get(kind)
    if components is not None:
        if not isinstance(default, list):
            raise ParameterValidationError(
                f"parameter {key}: {kind} default must be a list of {components} numbers"
            )
        if len(default) != components:
            raise ParameterValidationError(
                f"parameter {key}: {kind} default must have {components} components"
            )
        values: list[float] = []
        for value in default:
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
            ):
                raise ParameterValidationError(
                    f"parameter {key}: {kind} components must be finite numbers"
                )
            values.append(float(value))
        return values
    if kind == "sampler2D":
        if not isinstance(default, str):
            raise ParameterValidationError(
                f"parameter {key}: sampler2D default must be an asset id string"
            )
        return default
    raise ParameterValidationError(f"parameter {key}: unknown kind {kind!r}")


def is_uniform_kind(kind: str) -> bool:
    return kind in UNIFORM_KINDS
