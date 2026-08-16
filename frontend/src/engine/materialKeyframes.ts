import { requireBoolean, requireFiniteNumber, requireMaterialOverrideValue } from './guards'
import type { KeyframeValue } from './keyframe'

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * Validate a keyframe value for a material-parameter track against the
 * parameter's kind. Continuous kinds (number, float, color, vec2/3/4) accept
 * their natural shapes; discrete kinds (int, bool, sampler2D) enforce integer,
 * boolean, and asset-id string respectively. Unknown kinds fall back to the
 * generic override shape so data authored against future definitions survives.
 */
export function requireMaterialKeyframeValue(
  kind: string,
  value: unknown,
  what = 'Keyframe value',
): KeyframeValue {
  switch (kind) {
    case 'int':
      return requireInteger(value, what)
    case 'bool':
      return requireBoolean(value, what)
    case 'sampler2D':
      return requireAssetId(value, what)
    case 'color':
      return requireHexColor(value, what)
    case 'number':
    case 'float':
      return requireFiniteNumber(value, what)
    case 'vec2':
    case 'vec3':
    case 'vec4':
      return requireVector(kind, value, what)
    default:
      return requireMaterialOverrideValue(value, what)
  }
}

function requireInteger(value: unknown, what: string): number {
  return requireFiniteNumber(value, what, Number.isInteger, 'an integer')
}

function requireAssetId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${what} must be a non-empty asset id string`)
  }
  return value
}

function requireHexColor(value: unknown, what: string): string {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    throw new Error(`${what} must be a hex color like #ff0000`)
  }
  return value
}

function requireVector(kind: string, value: unknown, what: string): number[] {
  const length = Number(kind.slice(3))
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${what} must be a number array of length ${length}`)
  }
  for (const component of value) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new Error(`${what} must be a number array of length ${length}`)
    }
  }
  return value
}
