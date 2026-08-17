import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface MoveClipLayerCommandParameters {
  readonly nodeId: string
  readonly instanceId: string
  readonly newIndex: number
}

export interface MoveClipLayerCommandInverse {
  readonly nodeId: string
  readonly instanceId: string
  readonly oldIndex: number
}

export class MoveClipLayerCommand implements Command<MoveClipLayerCommandInverse> {
  readonly type = 'MoveClipLayer'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #instanceId: string
  readonly #newIndex: number

  constructor(input: MoveClipLayerCommandParameters) {
    this.#nodeId = input.nodeId
    this.#instanceId = input.instanceId
    this.#newIndex = input.newIndex
    this.parameters = {
      nodeId: input.nodeId,
      instanceId: input.instanceId,
      newIndex: input.newIndex,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getClipInstance(this.#nodeId, this.#instanceId)
    requireFiniteNumber(this.#newIndex, 'Layer index')
    if (!Number.isInteger(this.#newIndex) || this.#newIndex < 0) {
      throw new Error('Layer index must be a non-negative integer')
    }
    const node = engine.getNode(this.#nodeId)
    if (this.#newIndex >= node.clipInstances.length) {
      throw new Error(`Layer index out of bounds: ${this.#newIndex}`)
    }
  }

  execute(engine: Engine): MoveClipLayerCommandInverse {
    const node = engine.getNode(this.#nodeId)
    const oldIndex = node.clipInstances.findIndex((inst) => inst.id === this.#instanceId)
    engine.moveClipLayer(this.#nodeId, this.#instanceId, this.#newIndex)
    return { nodeId: this.#nodeId, instanceId: this.#instanceId, oldIndex }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
