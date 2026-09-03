import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'

export interface ApplyClipCollectionParameters {
  readonly collectionId: string
  readonly targetNodeId: string
}

export interface ApplyClipCollectionInverse {
  readonly collectionId: string
  readonly targetNodeId: string
  readonly created: readonly { nodeId: string; instanceId: string; clipId: string }[]
}

export class ApplyClipCollectionCommand implements Command<ApplyClipCollectionInverse> {
  readonly type = 'ApplyClipCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string
  readonly #targetNodeId: string

  constructor(input: ApplyClipCollectionParameters) {
    requireString(input.collectionId, 'collectionId')
    requireString(input.targetNodeId, 'targetNodeId')
    this.#collectionId = input.collectionId
    this.#targetNodeId = input.targetNodeId
    this.parameters = { collectionId: input.collectionId, targetNodeId: input.targetNodeId }
  }

  validate(engine: Engine): void {
    const col = engine.getClipCollection(this.#collectionId)
    engine.getNode(this.#targetNodeId)
    // Validate all clipIds in collection still exist
    for (const clipId of col.bindings.values()) {
      engine.getClip(clipId)
    }
  }

  execute(engine: Engine): ApplyClipCollectionInverse {
    const created = engine.applyClipCollection(this.#collectionId, this.#targetNodeId)
    return { collectionId: this.#collectionId, targetNodeId: this.#targetNodeId, created }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
