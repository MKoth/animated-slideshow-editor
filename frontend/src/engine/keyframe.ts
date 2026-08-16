import { newId } from './ids'
import type { KeyframeJSON } from './json'
import { requireFiniteNumber } from './guards'

export type InterpolationType = 'hold' | 'linear' | 'bezier'

export type KeyframeValue = string | number | boolean | number[]

export type KeyframeTangent = {
  readonly time: number
  readonly value: number
}

export const ZERO_TANGENT: KeyframeTangent = Object.freeze({ time: 0, value: 0 })

export function requireKeyframeInterpolation(value: unknown): InterpolationType {
  if (value === 'hold' || value === 'linear' || value === 'bezier') {
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
