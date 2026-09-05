import { newId } from './ids'
import type { KeyframeJSON } from './json'
import { requireFiniteNumber } from './guards'

export type InterpolationType = 'hold' | 'linear' | 'bezier' | 'bounce' | 'elastic' | 'spring'

import type { MorphKeyframeValue, MorphClipKeyframeValue } from './shape'

export type KeyframeValue = string | number | boolean | number[] | MorphKeyframeValue | MorphClipKeyframeValue

export type KeyframeTangent = {
  readonly time: number
  readonly value: number
}

export const ZERO_TANGENT: KeyframeTangent = Object.freeze({ time: 0, value: 0 })

/** Whether the interpolation type is a parametric motion curve. */
export function isParametricInterpolation(interpolation: InterpolationType): boolean {
  return interpolation === 'bounce' || interpolation === 'elastic' || interpolation === 'spring'
}

/** Whether a material parameter kind is discrete (hold-only). */
export function isDiscreteMaterialKind(kind: string): boolean {
  return kind === 'int' || kind === 'bool' || kind === 'sampler2D'
}

export function requireKeyframeInterpolation(value: unknown): InterpolationType {
  if (
    value === 'hold' ||
    value === 'linear' ||
    value === 'bezier' ||
    value === 'bounce' ||
    value === 'elastic' ||
    value === 'spring'
  ) {
    return value
  }
  throw new Error(`Unknown keyframe interpolation: ${String(value)}`)
}

export function requireKeyframeTangent(value: unknown, what = 'Keyframe tangent'): KeyframeTangent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object with time and value`)
  }
  const record = value as Record<string, unknown>
  const time = requireFiniteNumber(record.time, `${what} time`)
  const tangentValue = requireFiniteNumber(record.value, `${what} value`)
  return { time, value: tangentValue }
}

export class Keyframe {
  readonly id: string
  time: number
  value: KeyframeValue
  interpolation: InterpolationType
  tangentIn: KeyframeTangent
  tangentOut: KeyframeTangent

  constructor(
    id: string,
    time: number,
    value: KeyframeValue,
    interpolation: InterpolationType = 'linear',
    tangentIn: KeyframeTangent = ZERO_TANGENT,
    tangentOut: KeyframeTangent = ZERO_TANGENT,
  ) {
    this.id = id
    this.time = time
    this.value = value
    this.interpolation = interpolation
    this.tangentIn = tangentIn
    this.tangentOut = tangentOut
  }

  toJSON(): KeyframeJSON {
    return {
      id: this.id,
      time: this.time,
      value: this.value,
      interpolation: this.interpolation,
      tangentIn: { time: this.tangentIn.time, value: this.tangentIn.value },
      tangentOut: { time: this.tangentOut.time, value: this.tangentOut.value },
    }
  }
}

export function newKeyframeId(): string {
  return newId('keyframe')
}

/** A full keyframe record for inverse payloads (Spec 02 R37). */
export interface KeyframeSnapshot {
  readonly keyframeId: string
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

export function snapshotOf(keyframe: Keyframe): KeyframeSnapshot {
  return {
    keyframeId: keyframe.id,
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
    tangentIn: { time: keyframe.tangentIn.time, value: keyframe.tangentIn.value },
    tangentOut: { time: keyframe.tangentOut.time, value: keyframe.tangentOut.value },
  }
}
