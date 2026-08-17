import type { Keyframe } from './keyframe'
import type { MaterialOverrideValue } from './materialInstance'
import { OPACITY_MULTIPLIER_PARAMETER_KEY } from './materialResolution'

/**
 * Evaluate one material-parameter keyframe track at a time. Interpolation is
 * implied by the parameter kind (Spec 07 R27): continuous kinds (number/float,
 * color, vec2/3/4) interpolate linearly with per-channel clamping where
 * today's material resolution clamps; discrete kinds (int, bool, sampler2D)
 * hold — the value jumps at the keyframe time. Read-only, deterministic, and
 * allocation-free apart from the value objects continuous kinds produce.
 */
export function evaluateMaterialTrackValue(
  kind: string,
  key: string,
  keyframes: readonly Keyframe[],
  time: number,
): MaterialOverrideValue {
  const first = keyframes[0]
  if (time <= first.time) {
    return clampMaterialValue(kind, key, first.value as MaterialOverrideValue)
  }
  const last = keyframes[keyframes.length - 1]
  if (time >= last.time) {
    return clampMaterialValue(kind, key, last.value as MaterialOverrideValue)
  }
  if (isContinuousMaterialKind(kind)) {
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (to.time > from.time && time >= from.time && time < to.time) {
        const ratio = (time - from.time) / (to.time - from.time)
        return clampMaterialValue(
          kind,
          key,
          interpolateMaterialValue(
            kind,
            from.value as MaterialOverrideValue,
            to.value as MaterialOverrideValue,
            ratio,
          ),
        )
      }
    }
  }
  for (let i = keyframes.length - 1; i >= 0; i -= 1) {
    if (keyframes[i].time <= time) {
      return clampMaterialValue(kind, key, keyframes[i].value as MaterialOverrideValue)
    }
  }
  return clampMaterialValue(kind, key, first.value as MaterialOverrideValue)
}

function isContinuousMaterialKind(kind: string): boolean {
  return (
    kind === 'number' ||
    kind === 'float' ||
    kind === 'color' ||
    kind === 'vec2' ||
    kind === 'vec3' ||
    kind === 'vec4'
  )
}

function interpolateMaterialValue(
  kind: string,
  from: MaterialOverrideValue,
  to: MaterialOverrideValue,
  ratio: number,
): MaterialOverrideValue {
  switch (kind) {
    case 'number':
    case 'float':
      return (from as number) + ((to as number) - (from as number)) * ratio
    case 'color':
      return lerpHexColor(from as string, to as string, ratio)
    case 'vec2':
    case 'vec3':
    case 'vec4':
      return lerpVector(from as readonly number[], to as readonly number[], ratio)
    default:
      return from
  }
}

/**
 * Clamp a channel where today's material resolution clamps (Spec 07 R27):
 * opacityMultiplier to [0, 1] and the alpha channel of vec4 kinds.
 */
function clampMaterialValue(
  kind: string,
  key: string,
  value: MaterialOverrideValue,
): MaterialOverrideValue {
  if (key === OPACITY_MULTIPLIER_PARAMETER_KEY && typeof value === 'number') {
    return Math.min(Math.max(value, 0), 1)
  }
  if (kind === 'vec4' && Array.isArray(value) && value.length === 4) {
    return [value[0], value[1], value[2], Math.min(Math.max(value[3], 0), 1)]
  }
  return value
}

function lerpVector(from: readonly number[], to: readonly number[], ratio: number): number[] {
  const result = new Array<number>(from.length)
  for (let i = 0; i < from.length; i += 1) {
    result[i] = from[i] + (to[i] - from[i]) * ratio
  }
  return result
}

function lerpHexColor(from: string, to: string, ratio: number): string {
  const fromRed = parseInt(from.slice(1, 3), 16)
  const fromGreen = parseInt(from.slice(3, 5), 16)
  const fromBlue = parseInt(from.slice(5, 7), 16)
  const toRed = parseInt(to.slice(1, 3), 16)
  const toGreen = parseInt(to.slice(3, 5), 16)
  const toBlue = parseInt(to.slice(5, 7), 16)
  return `#${hexChannel(fromRed, toRed, ratio)}${hexChannel(fromGreen, toGreen, ratio)}${hexChannel(
    fromBlue,
    toBlue,
    ratio,
  )}`
}

function hexChannel(from: number, to: number, ratio: number): string {
  return Math.round(from + (to - from) * ratio)
    .toString(16)
    .padStart(2, '0')
}
