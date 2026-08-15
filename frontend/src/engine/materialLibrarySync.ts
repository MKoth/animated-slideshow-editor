import type { Engine } from './internal'

export interface MaterialDefinitionRef {
  readonly id: string
  readonly name: string
}

export class MaterialLibrarySync {
  readonly #engine: Engine

  constructor(engine: Engine) {
    this.#engine = engine
  }

  apply(definitions: readonly MaterialDefinitionRef[]): void {
    for (const definition of definitions) {
      this.#engine.registerMaterialDefinition(definition.id, definition.name)
    }
  }
}
