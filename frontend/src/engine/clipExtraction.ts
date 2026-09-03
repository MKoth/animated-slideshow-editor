import type { AnimationProperty, CircleAnimationProperty } from './animationProperties'
import type { Keyframe, KeyframeTangent, InterpolationType, KeyframeValue } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { KeyframeTarget } from './keyframeTarget'


export interface ExtractableKeyframe {
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
  readonly keyframeId: string
}

export interface NormalizedKeyframe {
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
  readonly originalId: string
}

export interface ExtractionBounds {
  readonly selStart: number
  readonly selEnd: number
  readonly selDuration: number
  readonly clipDuration: number
}

export function computeExtractionBounds(keyframes: readonly ExtractableKeyframe[]): ExtractionBounds {
  if (keyframes.length === 0) {
    throw new Error('At least one keyframe is required for extraction')
  }
  let selStart = Infinity
  let selEnd = -Infinity
  for (const kf of keyframes) {
    if (kf.time < selStart) selStart = kf.time
    if (kf.time > selEnd) selEnd = kf.time
  }
  const selDuration = selEnd - selStart
  const clipDuration = selDuration > 1e-9 ? selDuration : 1
  return { selStart, selEnd, selDuration, clipDuration }
}

export function normalizeExtractable(
  kf: ExtractableKeyframe,
  bounds: ExtractionBounds,
): NormalizedKeyframe {
  const { selStart, selDuration } = bounds
  const normalizedTime = selDuration > 1e-9 ? (kf.time - selStart) / selDuration : 0

  // Tangent time offsets are normalized by the same duration factor (time units)
  const tangentIn: KeyframeTangent = {
    time: selDuration > 1e-9 ? kf.tangentIn.time / selDuration : kf.tangentIn.time,
    value: kf.tangentIn.value,
  }
  const tangentOut: KeyframeTangent = {
    time: selDuration > 1e-9 ? kf.tangentOut.time / selDuration : kf.tangentOut.time,
    value: kf.tangentOut.value,
  }

  // Value normalization: where applicable, map to [0,1]. For now, values are copied
  // verbatim — opacity already lives in [0,1], visible is boolean, circle angles
  // and scales are absolute. Validation below ensures opacity stays in [0,1].
  const normalizedValue = kf.value

  // Validate normalized time [0,1]
  if (normalizedTime < -1e-9 || normalizedTime > 1 + 1e-9) {
    throw new Error(`Normalized time ${normalizedTime} out of [0,1] for keyframe ${kf.keyframeId}`)
  }
  const clampedTime = Math.min(Math.max(normalizedTime, 0), 1)

  // Validate value where applicable (opacity)
  if (isOpacityTarget(kf.target)) {
    const v = normalizedValue as number
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9) {
      throw new Error(`Clip keyframe value for opacity must be within [0,1], got ${String(v)}`)
    }
  }

  return {
    target: kf.target,
    time: clampedTime,
    value: normalizedValue,
    interpolation: kf.interpolation,
    tangentIn,
    tangentOut,
    originalId: kf.keyframeId,
  }
}

function isOpacityTarget(target: KeyframeTarget): boolean {
  return target.kind === 'node' && 'property' in target && target.property === 'opacity'
}

export type NormalizedChannelKey =
  | { kind: 'property'; property: AnimationProperty }
  | { kind: 'visible'; nodeId: string } // visible is per-node but clip's visible is global; we merge all visible into one clip visible track
  | { kind: 'circle'; property: CircleAnimationProperty }
  | { kind: 'parameter'; parameter: string; nodeId: string }
  | { kind: 'dataLabel'; label: string }
  | { kind: 'table'; property: import('./animationProperties').TableAnimationProperty }

export function channelKeyOf(target: KeyframeTarget): string {
  if (target.kind === 'node') {
    if ('property' in target) {
      return `property:${target.property}`
    }
    if ('parameter' in target) {
      return `parameter:${target.parameter}`
    }
  }
  if (target.kind === 'visible') {
    return `visible`
  }
  if (target.kind === 'circle') {
    return `circle:${target.property}`
  }
  if (target.kind === 'dataLabel') {
    return `dataLabel:${target.label}`
  }
  if (target.kind === 'table') {
    return `table:${target.property}`
  }
  if (target.kind === 'clip') {
    return `clip:${target.channel}`
  }
  return `unknown:${JSON.stringify(target)}`
}

export function groupNormalizedByChannel(
  normalized: readonly NormalizedKeyframe[],
): Map<string, NormalizedKeyframe[]> {
  const groups = new Map<string, NormalizedKeyframe[]>()
  for (const nk of normalized) {
    const key = channelKeyOf(nk.target)
    const arr = groups.get(key)
    if (arr) {
      arr.push(nk)
    } else {
      groups.set(key, [nk])
    }
  }
  // Sort each group by time
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.time - b.time)
  }
  return groups
}

export function validateNoDuplicateTimes(
  groups: Map<string, NormalizedKeyframe[]>,
  // Existing times per channel for append validation
  existingTimesByKey?: Map<string, readonly number[]>,
): void {
  for (const [key, keyframes] of groups) {
    const seen = new Set<number>()
    for (const kf of keyframes) {
      // Check duplicate within the extraction group itself
      const rounded = Math.round(kf.time * 1e9) / 1e9
      if (seen.has(rounded)) {
        throw new Error(`Duplicate normalized time ${kf.time} in channel ${key}`)
      }
      seen.add(rounded)
    }
    if (existingTimesByKey) {
      const existing = existingTimesByKey.get(key)
      if (existing) {
        for (const kf of keyframes) {
          const rounded = Math.round(kf.time * 1e9) / 1e9
          for (const et of existing) {
            const er = Math.round(et * 1e9) / 1e9
            if (er === rounded) {
              throw new Error(`Clip already has a keyframe at time ${kf.time} on channel ${key}`)
            }
          }
        }
      }
    }
  }
}

export function createNormalizedClipKeyframes(
  keyframes: readonly ExtractableKeyframe[],
): {
  bounds: ExtractionBounds
  normalized: NormalizedKeyframe[]
  groups: Map<string, NormalizedKeyframe[]>
} {
  const bounds = computeExtractionBounds(keyframes)
  const normalized = keyframes.map((kf) => normalizeExtractable(kf, bounds))
  const groups = groupNormalizedByChannel(normalized)
  validateNoDuplicateTimes(groups)
  return { bounds, normalized, groups }
}

/**
 * Build KeyframeModel instances for insertion into a ClipDefinition,
 * generating new ids and preserving normalized data.
 */
export function toClipKeyframes(
  normalized: readonly NormalizedKeyframe[],
): Keyframe[] {
  return normalized.map(
    (nk) =>
      new KeyframeModel(
        newKeyframeId(),
        nk.time,
        nk.value,
        nk.interpolation,
        { time: nk.tangentIn.time, value: nk.tangentIn.value },
        { time: nk.tangentOut.time, value: nk.tangentOut.value },
      ),
  )
}
