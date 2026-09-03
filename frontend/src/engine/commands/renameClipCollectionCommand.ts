import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'

export interface RenameClipCollectionParameters {
  readonly collectionId: string
  readonly name: string
}

export interface RenameClipCollectionInverse {
  readonly collectionId: string
  readonly oldName: string
}

export class RenameClipCollectionCommand implements Command<RenameClipCollectionInverse> {
  readonly type = 'RenameClipCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string
  readonly #name: string

  constructor(input: RenameClipCollectionParameters) {
    if (!input.collectionId) throw new Error('collectionId required')
    requireString(input.name, 'ClipCollection name')
    this.#collectionId = input.collectionId
    this.#name = input.name
    this.parameters = { collectionId: input.collectionId, name: input.name }
  }

  validate(engine: Engine): void {
    const col = engine.getClipCollection(this.#collectionId)
    requireString(this.#name, 'ClipCollection name')
    if (this.#name === col.name) throw new Error('ClipCollection name is unchanged')
  }

  execute(engine: Engine): RenameClipCollectionInverse {
    const col = engine.getClipCollection(this.#collectionId)
    const oldName = col.name
    engine.renameClipCollection(this.#collectionId, this.#name)
    return { collectionId: this.#collectionId, oldName }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
