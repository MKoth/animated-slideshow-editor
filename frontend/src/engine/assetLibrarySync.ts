import type { Engine } from './internal'

export interface AssetDefinitionRef {
  readonly id: string
  readonly name: string
}

export class AssetLibrarySync {
  readonly #engine: Engine

  constructor(engine: Engine) {
    this.#engine = engine
  }

  apply(definitions: readonly AssetDefinitionRef[]): void {
    for (const definition of definitions) {
      this.#engine.registerAssetDefinition(definition.id, definition.name)
    }
  }
}
