import type { EventBus } from './events'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import type { Keyframe } from './keyframe'
import { newKeyframeId } from './keyframe'
import { Keyframe as KeyframeModel } from './keyframe'
import type { InterpolationType } from './keyframe'
import type { AnimationProperty } from './animationProperties'
import {
  requireAnimatableForNode,
  requireKeyframeTime,
  requireKeyframeValue,
} from './animationProperties'
import type { NodeAnimation } from './nodeAnimation'

export interface KeyframeMove {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly newTime: number
}

export interface KeyframeMoveResult {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly oldTime: number
}

interface ValidatedMove {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly newTime: number
  readonly oldTime: number
  readonly node: SceneNode
}

export class AnimationManager {
  readonly #bus: EventBus
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #slideLookup: (nodeId: string) => Slide

  constructor(
    bus: EventBus,
    nodeLookup: (nodeId: string) => SceneNode,
    slideLookup: (nodeId: string) => Slide,
  ) {
    this.#bus = bus
    this.#nodeLookup = nodeLookup
    this.#slideLookup = slideLookup
  }

  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[] {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.keyframes(property) ?? []
  }

  getKeyframe(
    nodeId: string,
    property: AnimationProperty,
    keyframeId: string,
  ): Keyframe | undefined {
    return this.#nodeAnimation(nodeId).get(property, keyframeId)
  }

  addKeyframe(nodeId: string, property: AnimationProperty, time: number, value: number): Keyframe {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    requireAnimatableForNode(node, property)
    const boundedTime = requireKeyframeTime(time, slide.duration)
    const boundedValue = requireKeyframeValue(property, value)
    const animation = this.#nodeAnimation(nodeId)
    this.#assertTimeFree(animation, property, node, boundedTime, [])
    const keyframe = new KeyframeModel(
      newKeyframeId(),
      boundedTime,
      boundedValue,
      previousInterpolation(animation.keyframes(property), boundedTime),
    )
    animation.add(property, keyframe)
    this.#bus.emit({ type: 'KeyframeAdded', nodeId, property, keyframeId: keyframe.id })
    return keyframe
  }

  deleteKeyframe(nodeId: string, property: AnimationProperty, keyframeId: string): Keyframe {
    const node = this.#nodeLookup(nodeId)
    this.#slideLookup(nodeId)
    requireAnimatableForNode(node, property)
    const animation = this.#nodeAnimation(nodeId)
    const removed = animation.remove(property, keyframeId)
    if (!removed) {
      throw new Error(`Keyframe not found: ${keyframeId} on property ${property}`)
    }
    this.#bus.emit({ type: 'KeyframeRemoved', nodeId, property, keyframeId })
    return removed
  }

  moveKeyframe(
    nodeId: string,
    property: AnimationProperty,
    keyframeId: string,
    newTime: number,
  ): void {
    const moves = this.#validateMoves([{ nodeId, property, keyframeId, newTime }])
    this.#applyMoves(moves)
  }

  moveKeyframes(moves: readonly KeyframeMove[]): KeyframeMoveResult[] {
    const validated = this.#validateMoves(moves)
    this.#applyMoves(validated)
    return validated.map((move) => ({
      nodeId: move.nodeId,
      property: move.property,
      keyframeId: move.keyframeId,
      oldTime: move.oldTime,
    }))
  }

  setKeyframeValue(
    nodeId: string,
    property: AnimationProperty,
    keyframeId: string,
    value: number,
  ): void {
    const node = this.#nodeLookup(nodeId)
    this.#slideLookup(nodeId)
    requireAnimatableForNode(node, property)
    const boundedValue = requireKeyframeValue(property, value)
    const animation = this.#nodeAnimation(nodeId)
    const keyframe = this.#requireKeyframe(animation, property, keyframeId)
    keyframe.value = boundedValue
    this.#bus.emit({ type: 'KeyframeValueChanged', nodeId, property, keyframeId })
  }

  #validateMoves(moves: readonly KeyframeMove[]): ValidatedMove[] {
    if (moves.length === 0) {
      throw new Error('At least one keyframe move is required')
    }
    const seen = new Set<string>()
    const validated: ValidatedMove[] = []
    for (const move of moves) {
      const node = this.#nodeLookup(move.nodeId)
      const slide = this.#slideLookup(move.nodeId)
      requireAnimatableForNode(node, move.property)
      const boundedTime = requireKeyframeTime(move.newTime, slide.duration)
      const identity = `${move.nodeId}\u0000${move.property}\u0000${move.keyframeId}`
      if (seen.has(identity)) {
        throw new Error(`Duplicate keyframe move: ${move.keyframeId} on property ${move.property}`)
      }
      seen.add(identity)
      const animation = this.#nodeAnimation(move.nodeId)
      const keyframe = this.#requireKeyframe(animation, move.property, move.keyframeId)
      const vacating = new Set<string>()
      for (const other of moves) {
        if (
          other.nodeId === move.nodeId &&
          other.property === move.property &&
          other.keyframeId !== move.keyframeId
        ) {
          vacating.add(other.keyframeId)
        }
      }
      this.#assertTimeFree(animation, move.property, node, boundedTime, [
        move.keyframeId,
        ...vacating,
      ])
      for (const other of moves) {
        if (
          other !== move &&
          other.nodeId === move.nodeId &&
          other.property === move.property &&
          other.newTime === boundedTime
        ) {
          throw new Error(
            `Two keyframes cannot move to the same time ${boundedTime} on property ${move.property}`,
          )
        }
      }
      validated.push({
        nodeId: move.nodeId,
        property: move.property,
        keyframeId: move.keyframeId,
        newTime: boundedTime,
        oldTime: keyframe.time,
        node,
      })
    }
    return validated
  }

  #applyMoves(moves: readonly ValidatedMove[]): void {
    for (const move of moves) {
      const animation = this.#nodeAnimation(move.nodeId)
      const keyframe = animation.get(move.property, move.keyframeId)
      if (!keyframe) {
        throw new Error(`Keyframe not found: ${move.keyframeId} on property ${move.property}`)
      }
      animation.remove(move.property, move.keyframeId)
      keyframe.time = move.newTime
      animation.add(move.property, keyframe)
    }
    for (const move of moves) {
      this.#bus.emit({
        type: 'KeyframeMoved',
        nodeId: move.nodeId,
        property: move.property,
        keyframeId: move.keyframeId,
      })
    }
  }

  #nodeAnimation(nodeId: string): NodeAnimation {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.ensure(nodeId)
  }

  #requireKeyframe(
    animation: NodeAnimation,
    property: AnimationProperty,
    keyframeId: string,
  ): Keyframe {
    const keyframe = animation.get(property, keyframeId)
    if (!keyframe) {
      throw new Error(`Keyframe not found: ${keyframeId} on property ${property}`)
    }
    return keyframe
  }

  #assertTimeFree(
    animation: NodeAnimation,
    property: AnimationProperty,
    node: SceneNode,
    time: number,
    excludedKeyframeIds: readonly string[],
  ): void {
    const occupied = animation
      .keyframes(property)
      .some((keyframe) => keyframe.time === time && !excludedKeyframeIds.includes(keyframe.id))
    if (occupied) {
      throw new Error(`Node ${node.name} already has a keyframe on ${property} at time ${time}`)
    }
  }
}

function previousInterpolation(
  keyframes: readonly Keyframe[],
  time: number,
): InterpolationType | undefined {
  let previous: Keyframe | undefined
  for (const keyframe of keyframes) {
    if (keyframe.time > time) {
      break
    }
    previous = keyframe
  }
  return previous?.interpolation
}
