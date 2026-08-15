import type { Engine } from './internal'

export interface ShaderDefinitionRef {
  readonly id: string
  readonly name: string
}

export class ShaderLibrarySync {
  readonly #engine: Engine

  constructor(engine: Engine) {
    this.#engine = engine
  }

  apply(definitions: readonly ShaderDefinitionRef[]): void {
    for (const definition of definitions) {
      this.#engine.registerShaderDefinition(definition.id, definition.name)
    }
  }
}
