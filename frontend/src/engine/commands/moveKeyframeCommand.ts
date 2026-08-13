import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animation'
import { requireAnimatableForNode, requireKeyframeTime } from '../animation'

export interface MoveKeyframeParameters {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly newTime: number
}

export interface MoveKeyframeInverse {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly oldTime: number
}

export class MoveKeyframeCommand implements Command<MoveKeyframeInverse> {
  readonly type = 'MoveKeyframe'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #property: AnimationProperty
  readonly #keyframeId: string
  readonly #newTime: number

  constructor(input: MoveKeyframeParameters) {
    this.#nodeId = input.nodeId
    this.#property = input.property
    this.#keyframeId = input.keyframeId
    this.#newTime = input.newTime
    this.parameters = {
      nodeId: input.nodeId,
      property: input.property,
      keyframeId: this.#keyframeId,
      newTime: this.#newTime,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    requireAnimatableForNode(node, this.#property)
    const slide = engine.getSlideOfNode(this.#nodeId)
    requireKeyframeTime(this.#newTime, slide.duration)
    if (!engine.getKeyframe(this.#nodeId, this.#property, this.#keyframeId)) {
      throw new Error(`Keyframe not found: ${this.#keyframeId} on property ${this.#property}`)
    }
  }

  execute(engine: Engine): MoveKeyframeInverse {
    const keyframe = engine.getKeyframe(this.#nodeId, this.#property, this.#keyframeId)
    if (!keyframe) {
      throw new Error(`Keyframe not found: ${this.#keyframeId} on property ${this.#property}`)
    }
    const oldTime = keyframe.time
    engine.moveKeyframe(this.#nodeId, this.#property, this.#keyframeId, this.#newTime)
    return {
      nodeId: this.#nodeId,
      property: this.#property,
      keyframeId: this.#keyframeId,
      oldTime,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
