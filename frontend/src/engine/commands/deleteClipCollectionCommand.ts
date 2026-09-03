import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipCollectionJSON } from '../json'

export interface DeleteClipCollectionParameters {
  readonly collectionId: string
}

export interface DeleteClipCollectionInverse {
  readonly collectionId: string
  readonly snapshot: ClipCollectionJSON
}

export class DeleteClipCollectionCommand implements Command<DeleteClipCollectionInverse> {
  readonly type = 'DeleteClipCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string

  constructor(input: DeleteClipCollectionParameters) {
    if (!input.collectionId || typeof input.collectionId !== 'string') throw new Error('collectionId must be non-empty string')
    this.#collectionId = input.collectionId
    this.parameters = { collectionId: input.collectionId }
  }

  validate(engine: Engine): void {
    engine.getClipCollection(this.#collectionId)
  }

  execute(engine: Engine): DeleteClipCollectionInverse {
    const col = engine.getClipCollection(this.#collectionId)
    const snapshot = col.toJSON()
    engine.deleteClipCollection(this.#collectionId)
    return { collectionId: this.#collectionId, snapshot }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
