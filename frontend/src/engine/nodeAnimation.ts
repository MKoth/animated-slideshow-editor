import type { SceneNode } from './sceneNode'
import { isRecord, requireMaterialOverrideValue, requireString } from './guards'
import type { AnimationProperty } from './animationProperties'
import type { Keyframe, KeyframeValue } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import { requireKeyframeInterpolation, requireKeyframeTangent, ZERO_TANGENT } from './keyframe'
import type { PropertyTrackJSON, MaterialTrackJSON } from './json'
import {
  requireAnimationProperty,
  requireAnimatableForNode,
  requireKeyframeTime,
  requireKeyframeValue,
} from './animationProperties'
import { requireMaterialKeyframeValue } from './materialKeyframes'
import type { MaterialParameterKindOf } from './keyframeTarget'

export type { MaterialParameterKindOf } from './keyframeTarget'

export class NodeAnimation {
  readonly #tracks = new Map<AnimationProperty, Keyframe[]>()
  readonly #materialTracks = new Map<string, Keyframe[]>()

  keyframes(property: AnimationProperty): readonly Keyframe[] {
    return this.#tracks.get(property) ?? []
  }

  hasTrack(property: AnimationProperty): boolean {
    return this.#tracks.has(property)
  }

  materialKeyframes(parameter: string): readonly Keyframe[] {
    return this.#materialTracks.get(parameter) ?? []
  }

  hasMaterialTrack(parameter: string): boolean {
    return this.#materialTracks.has(parameter)
  }

  materialTrackParameterKeys(): string[] {
    return [...this.#materialTracks.keys()]
  }

  add(property: AnimationProperty, keyframe: Keyframe): void {
    insertSorted(this.#tracks, property, keyframe)
  }

  addMaterial(parameter: string, keyframe: Keyframe): void {
    insertSorted(this.#materialTracks, parameter, keyframe)
  }

  remove(property: AnimationProperty, keyframeId: string): Keyframe | undefined {
    return removeById(this.#tracks, property, keyframeId)
  }

  removeMaterial(parameter: string, keyframeId: string): Keyframe | undefined {
    return removeById(this.#materialTracks, parameter, keyframeId)
  }

  get(property: AnimationProperty, keyframeId: string): Keyframe | undefined {
    return this.#tracks.get(property)?.find((entry) => entry.id === keyframeId)
  }

  getMaterial(parameter: string, keyframeId: string): Keyframe | undefined {
    return this.#materialTracks.get(parameter)?.find((entry) => entry.id === keyframeId)
  }

  copy(): NodeAnimation {
    const copy = new NodeAnimation()
    for (const [property, keyframes] of this.#tracks) {
      copy.#tracks.set(
        property,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const [parameter, keyframes] of this.#materialTracks) {
      copy.#materialTracks.set(
        parameter,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    return copy
  }

  toJSON(): PropertyTrackJSON[] {
    const tracks: PropertyTrackJSON[] = []
    for (const [property, keyframes] of this.#tracks) {
      tracks.push({ property, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  materialTracksJSON(): MaterialTrackJSON[] {
    const tracks: MaterialTrackJSON[] = []
    for (const [parameter, keyframes] of this.#materialTracks) {
      tracks.push({ parameter, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  static fromJSON(
    json: unknown,
    duration: number,
    node: SceneNode,
    parameterKindOf: MaterialParameterKindOf = () => undefined,
  ): NodeAnimation {
    const animation = new NodeAnimation()
    if (!isRecord(json) || !Array.isArray(json.tracks)) {
      throw new Error('Node animation must have a tracks array')
    }
    for (const track of json.tracks) {
      if (typeof track !== 'object' || track === null) {
        throw new Error(`Node "${node.id}" animation track must be an object`)
      }
      const record = track as Record<string, unknown>
      const property = requireAnimationProperty(record.property)
      requireAnimatableForNode(node, property)
      if (!Array.isArray(record.keyframes)) {
        throw new Error(`Track "${property}" must have a keyframes array`)
      }
      const parse = trackKeyframeParser(`Track "${property}"`, duration, (value, what) =>
        requireKeyframeValue(property, value, what),
      )
      for (const keyframeJson of record.keyframes) {
        animation.add(property, parse(keyframeJson))
      }
    }
    const materialTracks = json.materialTracks
    if (materialTracks !== undefined) {
      if (!Array.isArray(materialTracks)) {
        throw new Error('Node animation materialTracks must be an array')
      }
      for (const track of materialTracks) {
        readMaterialTrack(animation, track, duration, node, parameterKindOf)
      }
    }
    return animation
  }
}

function readMaterialTrack(
  animation: NodeAnimation,
  track: unknown,
  duration: number,
  node: SceneNode,
  parameterKindOf: MaterialParameterKindOf,
): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error(`Node "${node.id}" material track must be an object`)
  }
  const record = track as Record<string, unknown>
  const parameter = requireMaterialParameterKey(record.parameter)
  if (!Array.isArray(record.keyframes)) {
    throw new Error(`Material track "${parameter}" must have a keyframes array`)
  }
  const kind = parameterKindOf(node, parameter)
  const parse = trackKeyframeParser(`Material track "${parameter}"`, duration, (value, what) =>
    kind === undefined
      ? requireMaterialOverrideValue(value, what)
      : requireMaterialKeyframeValue(kind, value, what),
  )
  for (const keyframeJson of record.keyframes) {
    animation.addMaterial(parameter, parse(keyframeJson))
  }
}

function requireMaterialParameterKey(value: unknown): string {
  return requireString(value, 'Material parameter key')
}

function insertSorted(tracks: Map<string, Keyframe[]>, key: string, keyframe: Keyframe): void {
  const existing = tracks.get(key)
  if (!existing) {
    tracks.set(key, [keyframe])
    return
  }
  const index = existing.findIndex((entry) => entry.time > keyframe.time)
  if (index === -1) {
    existing.push(keyframe)
  } else {
    existing.splice(index, 0, keyframe)
  }
}

function removeById(
  tracks: Map<string, Keyframe[]>,
  key: string,
  keyframeId: string,
): Keyframe | undefined {
  const existing = tracks.get(key)
  if (!existing) {
    return undefined
  }
  const index = existing.findIndex((entry) => entry.id === keyframeId)
  if (index === -1) {
    return undefined
  }
  const [removed] = existing.splice(index, 1)
  if (existing.length === 0) {
    tracks.delete(key)
  }
  return removed
}

function copyKeyframe(keyframe: Keyframe): Keyframe {
  return new KeyframeModel(
    newKeyframeId(),
    keyframe.time,
    keyframe.value,
    keyframe.interpolation,
    { time: keyframe.tangentIn.time, value: keyframe.tangentIn.value },
    { time: keyframe.tangentOut.time, value: keyframe.tangentOut.value },
  )
}

function trackKeyframeParser(
  label: string,
  duration: number,
  valueOf: (value: unknown, what: string) => KeyframeValue,
): (keyframeJson: unknown) => Keyframe {
  let previousTime = -Infinity
  const seenIds = new Set<string>()
  return (keyframeJson: unknown): Keyframe => {
    if (typeof keyframeJson !== 'object' || keyframeJson === null) {
      throw new Error(`${label} keyframe must be an object`)
    }
    const record = keyframeJson as Record<string, unknown>
    const id = requireString(record.id, `${label} keyframe id`)
    if (seenIds.has(id)) {
      throw new Error(`Duplicate keyframe id: ${id}`)
    }
    seenIds.add(id)
    const time = requireKeyframeTime(record.time, duration, `Keyframe "${id}" time`)
    if (time < previousTime) {
      throw new Error(`${label} keyframe times must not decrease (out-of-order time ${time})`)
    }
    if (time === previousTime && time !== duration) {
      throw new Error(
        `${label} keyframe times must be distinct (duplicate time ${time} not at the slide duration)`,
      )
    }
    previousTime = time
    const value = valueOf(record.value, `Keyframe "${id}" value`)
    const interpolation =
      record.interpolation === undefined
        ? 'linear'
        : requireKeyframeInterpolation(record.interpolation)
    const tangentIn =
      record.tangentIn === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentIn)
    const tangentOut =
      record.tangentOut === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentOut)
    return new KeyframeModel(id, time, value, interpolation, tangentIn, tangentOut)
  }
}
