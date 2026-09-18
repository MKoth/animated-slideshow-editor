import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'

export interface CreateClipCollectionParameters {
  readonly name: string
  readonly bindings: Readonly<Record<string, string>>
  readonly sourceNodeId?: string
  readonly category?: string
}

export interface CreateClipCollectionInverse {
  readonly collectionId: string
  readonly snapshot: import('../json').ClipCollectionJSON
}

export class CreateClipCollectionCommand implements Command<CreateClipCollectionInverse> {
  readonly type = 'CreateClipCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string
  readonly #bindings: Record<string, string>
  readonly #sourceNodeId?: string
  readonly #category: string

  constructor(input: CreateClipCollectionParameters) {
    requireString(input.name, 'ClipCollection name')
    if (!input.bindings || typeof input.bindings !== 'object' || Array.isArray(input.bindings)) {
      throw new Error('ClipCollection bindings must be an object')
    }
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.bindings)) {
      if (typeof k !== 'string' || k.trim() === '')
        throw new Error('Binding key must be non-empty string')
      if (typeof v !== 'string' || v === '')
        throw new Error(`Binding "${k}" must be non-empty string`)
      bindings[k.trim()] = v
    }
    if (input.category !== undefined && typeof input.category !== 'string') {
      throw new Error('ClipCollection category must be a string')
    }
    this.#name = input.name
    this.#bindings = bindings
    this.#sourceNodeId = input.sourceNodeId
    this.#category = typeof input.category === 'string' ? input.category.trim() : ''
    this.parameters = {
      name: input.name,
      bindings: { ...bindings },
      ...(input.sourceNodeId !== undefined ? { sourceNodeId: input.sourceNodeId } : {}),
      ...(this.#category !== '' ? { category: this.#category } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    requireString(this.#name, 'ClipCollection name')
    // Validate each clipId exists
    for (const clipId of Object.values(this.#bindings)) {
      engine.getClip(clipId)
    }
    if (this.#sourceNodeId !== undefined) {
      engine.getNode(this.#sourceNodeId)
    }
  }

  execute(engine: Engine): CreateClipCollectionInverse {
    const col = engine.createClipCollection(
      this.#name,
      this.#bindings,
      this.#sourceNodeId,
      this.#category,
    )
    return { collectionId: col.id, snapshot: col.toJSON() }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
