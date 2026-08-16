import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animation'
import type { KeyframeValue } from '../keyframe'
import { requireAnimatableForNode } from '../animation'

export interface DeleteKeyframeParameters {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
}

export interface DeleteKeyframeInverse {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly time: number
  readonly value: KeyframeValue
}

export class DeleteKeyframeCommand implements Command<DeleteKeyframeInverse> {
  readonly type = 'DeleteKeyframe'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #property: AnimationProperty
  readonly #keyframeId: string

  constructor(input: DeleteKeyframeParameters) {
    this.#nodeId = input.nodeId
    this.#property = input.property
    this.#keyframeId = input.keyframeId
    this.parameters = {
      nodeId: input.nodeId,
      property: input.property,
      keyframeId: this.#keyframeId,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    requireAnimatableForNode(node, this.#property)
    if (!engine.getKeyframe(this.#nodeId, this.#property, this.#keyframeId)) {
      throw new Error(`Keyframe not found: ${this.#keyframeId} on property ${this.#property}`)
    }
  }

  execute(engine: Engine): DeleteKeyframeInverse {
    const keyframe = engine.deleteKeyframe(this.#nodeId, this.#property, this.#keyframeId)
    return {
      nodeId: this.#nodeId,
      property: this.#property,
      keyframeId: this.#keyframeId,
      time: keyframe.time,
      value: keyframe.value,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
