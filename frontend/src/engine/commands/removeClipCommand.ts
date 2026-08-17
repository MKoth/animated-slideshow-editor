import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipInstanceJSON } from '../json'
import { clipInstanceToJSON } from '../clipInstance'

export interface RemoveClipCommandParameters {
  readonly nodeId: string
  readonly instanceId: string
}

export interface RemoveClipCommandInverse {
  readonly nodeId: string
  readonly layerIndex: number
  readonly instance: ClipInstanceJSON
  readonly instanceId: string
}

export class RemoveClipCommand implements Command<RemoveClipCommandInverse> {
  readonly type = 'RemoveClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #instanceId: string

  constructor(input: RemoveClipCommandParameters) {
    this.#nodeId = input.nodeId
    this.#instanceId = input.instanceId
    this.parameters = { nodeId: input.nodeId, instanceId: input.instanceId }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getClipInstance(this.#nodeId, this.#instanceId)
  }

  execute(engine: Engine): RemoveClipCommandInverse {
    const node = engine.getNode(this.#nodeId)
    const layerIndex = node.clipInstances.findIndex((inst) => inst.id === this.#instanceId)
    const removed = engine.removeClipInstance(this.#nodeId, this.#instanceId)
    return {
      nodeId: this.#nodeId,
      layerIndex,
      instance: clipInstanceToJSON(removed),
      instanceId: this.#instanceId,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
