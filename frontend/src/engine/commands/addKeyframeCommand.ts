import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animation'
import { requireAnimatableForNode, requireKeyframeTime, requireKeyframeValue } from '../animation'

export interface AddKeyframeParameters {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly time: number
  readonly value: number
}

export interface AddKeyframeInverse {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly time: number
  readonly value: number
}

export class AddKeyframeCommand implements Command<AddKeyframeInverse> {
  readonly type = 'AddKeyframe'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #property: AnimationProperty
  readonly #time: number
  readonly #value: number

  constructor(input: AddKeyframeParameters) {
    this.#nodeId = input.nodeId
    this.#property = input.property
    this.#time = input.time
    this.#value = input.value
    this.parameters = {
      nodeId: input.nodeId,
      property: input.property,
      time: this.#time,
      value: this.#value,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    requireAnimatableForNode(node, this.#property)
    const slide = engine.getSlideOfNode(this.#nodeId)
    requireKeyframeTime(this.#time, slide.duration)
    requireKeyframeValue(this.#property, this.#value)
  }

  execute(engine: Engine): AddKeyframeInverse {
    const keyframe = engine.addKeyframe(this.#nodeId, this.#property, this.#time, this.#value)
    return {
      nodeId: this.#nodeId,
      property: this.#property,
      keyframeId: keyframe.id,
      time: keyframe.time,
      value: keyframe.value,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
