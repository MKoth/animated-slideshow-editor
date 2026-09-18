import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetClipCollectionCategoryParameters {
  readonly collectionId: string
  readonly category: string
}

export interface SetClipCollectionCategoryInverse {
  readonly collectionId: string
  readonly oldCategory: string
}

export class SetClipCollectionCategoryCommand implements Command<SetClipCollectionCategoryInverse> {
  readonly type = 'SetClipCollectionCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string
  readonly #category: string

  constructor(input: SetClipCollectionCategoryParameters) {
    this.#collectionId = input.collectionId
    this.#category = input.category
    this.parameters = { collectionId: input.collectionId, category: input.category }
  }

  validate(engine: Engine): void {
    engine.getClipCollection(this.#collectionId)
  }

  execute(engine: Engine): SetClipCollectionCategoryInverse {
    const collection = engine.getClipCollection(this.#collectionId)
    const oldCategory = collection.category
    engine.setClipCollectionCategory(this.#collectionId, this.#category)
    return { collectionId: this.#collectionId, oldCategory }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
