import type { SceneNode } from './sceneNode'
import { requireString } from './guards'
import type { AnimationProperty } from './animationProperties'
import type { Keyframe } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { PropertyTrackJSON } from './json'
import {
  requireAnimationProperty,
  requireAnimatableForNode,
  requireKeyframeTime,
  requireKeyframeValue,
} from './animationProperties'

export class NodeAnimation {
  readonly #tracks = new Map<AnimationProperty, Keyframe[]>()

  keyframes(property: AnimationProperty): readonly Keyframe[] {
    return this.#tracks.get(property) ?? []
  }

  hasTrack(property: AnimationProperty): boolean {
    return this.#tracks.has(property)
  }

  add(property: AnimationProperty, keyframe: Keyframe): void {
    const existing = this.#tracks.get(property)
    if (!existing) {
      this.#tracks.set(property, [keyframe])
      return
    }
    const index = existing.findIndex((entry) => entry.time > keyframe.time)
    if (index === -1) {
      existing.push(keyframe)
    } else {
      existing.splice(index, 0, keyframe)
    }
  }

  remove(property: AnimationProperty, keyframeId: string): Keyframe | undefined {
    const existing = this.#tracks.get(property)
    if (!existing) {
      return undefined
    }
    const index = existing.findIndex((entry) => entry.id === keyframeId)
    if (index === -1) {
      return undefined
    }
    const [removed] = existing.splice(index, 1)
    if (existing.length === 0) {
      this.#tracks.delete(property)
    }
    return removed
  }

  get(property: AnimationProperty, keyframeId: string): Keyframe | undefined {
    return this.#tracks.get(property)?.find((entry) => entry.id === keyframeId)
  }

  copy(): NodeAnimation {
    const copy = new NodeAnimation()
    for (const [property, keyframes] of this.#tracks) {
      copy.#tracks.set(
        property,
        keyframes.map(
          (keyframe) => new KeyframeModel(newKeyframeId(), keyframe.time, keyframe.value),
        ),
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

  static fromJSON(json: unknown, duration: number, node: SceneNode): NodeAnimation {
    const animation = new NodeAnimation()
    if (!Array.isArray(json)) {
      throw new Error('Node animation must be an array of tracks')
    }
    for (const track of json) {
      if (typeof track !== 'object' || track === null) {
        throw new Error(`Node "${node.id}" animation track must be an object`)
      }
      const record = track as Record<string, unknown>
      const property = requireAnimationProperty(record.property)
      requireAnimatableForNode(node, property)
      if (!Array.isArray(record.keyframes)) {
        throw new Error(`Track "${property}" must have a keyframes array`)
      }
      let previousTime = -Infinity
      const seenIds = new Set<string>()
      for (const keyframeJson of record.keyframes) {
        if (typeof keyframeJson !== 'object' || keyframeJson === null) {
          throw new Error(`Track "${property}" keyframe must be an object`)
        }
        const keyframeRecord = keyframeJson as Record<string, unknown>
        const id = requireString(keyframeRecord.id, `Track "${property}" keyframe id`)
        if (seenIds.has(id)) {
          throw new Error(`Duplicate keyframe id: ${id}`)
        }
        seenIds.add(id)
        const time = requireKeyframeTime(keyframeRecord.time, duration, `Keyframe "${id}" time`)
        if (time < previousTime) {
          throw new Error(
            `Track "${property}" keyframe times must not decrease (out-of-order time ${time})`,
          )
        }
        if (time === previousTime && time !== duration) {
          throw new Error(
            `Track "${property}" keyframe times must be distinct (duplicate time ${time} not at the slide duration)`,
          )
        }
        previousTime = time
        const value = requireKeyframeValue(property, keyframeRecord.value, `Keyframe "${id}" value`)
        animation.add(property, new KeyframeModel(id, time, value))
      }
    }
    return animation
  }
}
