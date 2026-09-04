import type { Engine } from '../internal'
import type { Command } from './command'
import type { MorphBinding } from '../shape'

export interface SetMorphBindingParameters {
  readonly nodeId: string
  readonly binding: MorphBinding | null
}

export interface SetMorphBindingInverse {
  readonly nodeId: string
  readonly oldBinding: MorphBinding | null
}

export class SetMorphBindingCommand implements Command<SetMorphBindingInverse> {
  readonly type = 'SetMorphBinding'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #binding: MorphBinding | null

  constructor(input: SetMorphBindingParameters) {
    this.#nodeId = input.nodeId
    this.#binding = input.binding
      ? { fromShapeId: input.binding.fromShapeId ?? null, toShapeId: input.binding.toShapeId ?? null }
      : null
    this.parameters = {
      nodeId: input.nodeId,
      binding: this.#binding,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    if (this.#binding !== null) {
      if (
        this.#binding.fromShapeId !== null &&
        typeof this.#binding.fromShapeId !== 'string'
      ) {
        throw new Error('MorphBinding fromShapeId must be string or null')
      }
      if (
        this.#binding.toShapeId !== null &&
        typeof this.#binding.toShapeId !== 'string'
      ) {
        throw new Error('MorphBinding toShapeId must be string or null')
      }
    }
  }

  execute(engine: Engine): SetMorphBindingInverse {
    const oldBinding = engine.getMorphBinding(this.#nodeId)
    engine.setMorphBinding(this.#nodeId, this.#binding)
    return { nodeId: this.#nodeId, oldBinding }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
