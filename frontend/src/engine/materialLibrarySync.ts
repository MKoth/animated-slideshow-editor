import type { Engine } from './internal'
import type { MaterialParameterDefault } from './materialResolution'

export interface MaterialDefinitionRef {
  readonly id: string
  readonly name: string
  readonly parameters?: readonly MaterialParameterDefault[]
  readonly shader_id?: string | null
}

export class MaterialLibrarySync {
  readonly #engine: Engine

  constructor(engine: Engine) {
    this.#engine = engine
  }

  apply(definitions: readonly MaterialDefinitionRef[]): void {
    for (const definition of definitions) {
      this.#engine.registerMaterialDefinition(
        definition.id,
        definition.name,
        definition.parameters ?? [],
        definition.shader_id ?? null,
      )
    }
  }
}
