import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animation'
import { requireAnimatableForNode, requireKeyframeValue } from '../animation'

export interface SetKeyframeValueParameters {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly newValue: number
}

export interface SetKeyframeValueInverse {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly oldValue: number
}

export class SetKeyframeValueCommand implements Command<SetKeyframeValueInverse> {
  readonly type = 'SetKeyframeValue'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #property: AnimationProperty
  readonly #keyframeId: string
  readonly #newValue: number

  constructor(input: SetKeyframeValueParameters) {
    this.#nodeId = input.nodeId
    this.#property = input.property
    this.#keyframeId = input.keyframeId
    this.#newValue = input.newValue
    this.parameters = {
      nodeId: input.nodeId,
      property: input.property,
      keyframeId: this.#keyframeId,
      newValue: this.#newValue,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    requireAnimatableForNode(node, this.#property)
    requireKeyframeValue(this.#property, this.#newValue)
    if (!engine.getKeyframe(this.#nodeId, this.#property, this.#keyframeId)) {
      throw new Error(`Keyframe not found: ${this.#keyframeId} on property ${this.#property}`)
    }
  }

  execute(engine: Engine): SetKeyframeValueInverse {
    const keyframe = engine.getKeyframe(this.#nodeId, this.#property, this.#keyframeId)
    if (!keyframe) {
      throw new Error(`Keyframe not found: ${this.#keyframeId} on property ${this.#property}`)
    }
    const oldValue = keyframe.value
    engine.setKeyframeValue(this.#nodeId, this.#property, this.#keyframeId, this.#newValue)
    return {
      nodeId: this.#nodeId,
      property: this.#property,
      keyframeId: this.#keyframeId,
      oldValue,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
