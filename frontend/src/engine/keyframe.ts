import { newId } from './ids'
import type { KeyframeJSON } from './json'
import { requireFiniteNumber } from './guards'

export type InterpolationType = 'hold' | 'linear' | 'bezier' | 'bounce' | 'elastic' | 'spring'

import type { MorphKeyframeValue, MorphClipKeyframeValue } from './shape'
import type { SymmetryKeyframeValue } from './symmetry'

export type KeyframeValue =
  | string
  | number
  | boolean
  | number[]
  | MorphKeyframeValue
  | MorphClipKeyframeValue
  | SymmetryKeyframeValue

export type KeyframeTangent = {
  readonly time: number
  readonly value: number
}

/**
 * Link from a frozen-pose keyframe back to the collection placement that
 * produced it. `first` pins the collection's opening pose at the block start,
 * `last` pins the closing pose at the block end, `prefix` is the hold guard
 * at the block start that keeps a lone `last` key from hijacking the pre-block
 * pose. Plain (manually authored) keyframes carry no link.
 */
export type FreezeLinkRole = 'first' | 'last' | 'prefix'

export interface FreezeLink {
  readonly placementId: string
  readonly role: FreezeLinkRole
}

/** A keyframe's time is anchored proportionally within a collection placement. */
export interface CollectionTimingLink {
  readonly placementId: string
  readonly normalizedTime: number
}

export function collectionTimingLinkFromJSON(value: unknown): CollectionTimingLink | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.placementId !== 'string' || record.placementId === '') return undefined
  if (typeof record.normalizedTime !== 'number' || !Number.isFinite(record.normalizedTime)) {
    return undefined
  }
  return { placementId: record.placementId, normalizedTime: record.normalizedTime }
}

export function requireFreezeLinkRole(value: unknown): FreezeLinkRole {
  if (value === 'first' || value === 'last' || value === 'prefix') return value
  throw new Error(`Unknown freeze link role: ${String(value)}`)
}

/** Tolerant read — valid link object passes through, anything else → undefined. */
export function freezeLinkFromJSON(value: unknown): FreezeLink | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.placementId !== 'string' || record.placementId === '') return undefined
  const role = record.role
  if (role !== 'first' && role !== 'last' && role !== 'prefix') return undefined
  return { placementId: record.placementId, role }
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
  /** Session-only preview toggle — not serialized to LessonJSON */
  disabled: boolean
  /**
   * Wrap-around flag for the segment from this keyframe to the next.
   * When true with linear interpolation and both values numeric in [0,1],
   * evaluation takes the path through the 0/1 boundary
   * (e.g. 0.2 → 0 → 1 → 0.75). Ignored otherwise.
   */
  wrap: boolean
  /**
   * Per-host-keyframe blend factors for Controls with N timelines.
   * Length is N-1 (one per gap between timelines). Missing = [] (=0s).
   * Only meaningful on host Control tracks; ignored elsewhere.
   */
  blend: readonly number[]

  /**
   * Optional link to the collection placement whose freeze produced this
   * keyframe. Mutated by freeze / orphan flows, never by evaluation.
   * Not a constructor identity field — set post-construction so existing
   * positional call sites keep working.
   */
  freezeLink?: FreezeLink | undefined
  collectionTimingLink?: CollectionTimingLink | undefined

  constructor(
    id: string,
    time: number,
    value: KeyframeValue,
    interpolation: InterpolationType = 'linear',
    tangentIn: KeyframeTangent = ZERO_TANGENT,
    tangentOut: KeyframeTangent = ZERO_TANGENT,
    disabled = false,
    blend?: readonly number[],
    wrap = false,
    freezeLink?: FreezeLink,
    collectionTimingLink?: CollectionTimingLink,
  ) {
    this.id = id
    this.time = time
    this.value = value
    this.interpolation = interpolation
    this.tangentIn = tangentIn
    this.tangentOut = tangentOut
    this.disabled = disabled
    this.blend = blend ? [...blend] : []
    this.wrap = wrap
    if (freezeLink) this.freezeLink = { ...freezeLink }
    if (collectionTimingLink) this.collectionTimingLink = { ...collectionTimingLink }
  }

  toJSON(): KeyframeJSON {
    return {
      id: this.id,
      time: this.time,
      value: this.value,
      interpolation: this.interpolation,
      tangentIn: { time: this.tangentIn.time, value: this.tangentIn.value },
      tangentOut: { time: this.tangentOut.time, value: this.tangentOut.value },
      ...(this.blend.length > 0 ? { blend: [...this.blend] } : {}),
      ...(this.wrap ? { wrap: true } : {}),
      ...(this.freezeLink ? { freezeLink: { ...this.freezeLink } } : {}),
      ...(this.collectionTimingLink
        ? { collectionTimingLink: { ...this.collectionTimingLink } }
        : {}),
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
  readonly disabled?: boolean
  readonly blend?: readonly number[]
  readonly wrap?: boolean
  readonly freezeLink?: FreezeLink
  readonly collectionTimingLink?: CollectionTimingLink
}

export function snapshotOf(keyframe: Keyframe): KeyframeSnapshot {
  return {
    keyframeId: keyframe.id,
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
    tangentIn: { time: keyframe.tangentIn.time, value: keyframe.tangentIn.value },
    tangentOut: { time: keyframe.tangentOut.time, value: keyframe.tangentOut.value },
    ...(keyframe.disabled ? { disabled: true } : {}),
    ...(keyframe.blend.length > 0 ? { blend: [...keyframe.blend] } : {}),
    ...(keyframe.wrap ? { wrap: true } : {}),
    ...(keyframe.freezeLink ? { freezeLink: { ...keyframe.freezeLink } } : {}),
    ...(keyframe.collectionTimingLink
      ? { collectionTimingLink: { ...keyframe.collectionTimingLink } }
      : {}),
  }
}

export function requireKeyframeWrap(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error('Keyframe wrap must be a boolean')
  return value
}

export function requireKeyframeBlend(value: unknown): readonly number[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Keyframe blend must be an array')
  return (value as unknown[]).map((entry, idx) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new Error(`Keyframe blend[${idx}] must be a finite number`)
    }
    return Math.min(Math.max(entry, 0), 1)
  })
}
