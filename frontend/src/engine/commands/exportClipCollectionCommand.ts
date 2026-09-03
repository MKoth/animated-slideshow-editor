import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'
import type { ClipCollectionJSON } from '../json'

export interface ExportClipCollectionParameters {
  readonly parentNodeId: string
  readonly name: string
}

export interface ExportClipCollectionInverse {
  readonly collectionId: string
  readonly snapshot: ClipCollectionJSON
}

export class ExportClipCollectionCommand implements Command<ExportClipCollectionInverse> {
  readonly type = 'ExportClipCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #parentNodeId: string
  readonly #name: string

  constructor(input: ExportClipCollectionParameters) {
    requireString(input.parentNodeId, 'parentNodeId')
    requireString(input.name, 'ClipCollection name')
    this.#parentNodeId = input.parentNodeId
    this.#name = input.name
    this.parameters = { parentNodeId: input.parentNodeId, name: input.name }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    engine.getNode(this.#parentNodeId)
    requireString(this.#name, 'ClipCollection name')
  }

  execute(engine: Engine): ExportClipCollectionInverse {
    const col = engine.exportClipCollection(this.#parentNodeId, this.#name)
    const snapshot = col.toJSON()
    return { collectionId: col.id, snapshot }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
