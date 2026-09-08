import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetClipCollectionBindingsParameters {
  readonly collectionId: string
  readonly bindings: Readonly<Record<string, string>>
}

export interface SetClipCollectionBindingsInverse {
  readonly collectionId: string
  readonly oldBindings: Record<string, string>
  readonly newBindings: Record<string, string>
}

export class SetClipCollectionBindingsCommand implements Command<SetClipCollectionBindingsInverse> {
  readonly type = 'SetClipCollectionBindings'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string
  readonly #bindings: Record<string, string>

  constructor(input: SetClipCollectionBindingsParameters) {
    if (!input.collectionId || typeof input.collectionId !== 'string')
      throw new Error('collectionId must be non-empty string')
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
    this.#collectionId = input.collectionId
    this.#bindings = bindings
    this.parameters = { collectionId: input.collectionId, bindings: { ...bindings } }
  }

  validate(engine: Engine): void {
    engine.getClipCollection(this.#collectionId)
    for (const clipId of Object.values(this.#bindings)) {
      engine.getClip(clipId)
    }
  }

  execute(engine: Engine): SetClipCollectionBindingsInverse {
    const col = engine.getClipCollection(this.#collectionId)
    const oldBindings: Record<string, string> = {}
    for (const [k, v] of col.bindings.entries()) oldBindings[k] = v
    engine.setClipCollectionBindings(this.#collectionId, this.#bindings)
    return { collectionId: this.#collectionId, oldBindings, newBindings: { ...this.#bindings } }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
