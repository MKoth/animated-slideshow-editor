import type { Engine } from './internal'
import { embeddedShaderParameters } from './embeddedShader'

export interface ShaderDefinitionRef {
  readonly id: string
  readonly name: string
  readonly default_uniforms?: readonly Readonly<Record<string, unknown>>[]
}

export class ShaderLibrarySync {
  readonly #engine: Engine

  constructor(engine: Engine) {
    this.#engine = engine
  }

  apply(definitions: readonly ShaderDefinitionRef[]): void {
    for (const definition of definitions) {
      this.#engine.registerShaderDefinition(
        definition.id,
        definition.name,
        embeddedShaderParameters(definition.default_uniforms ?? []),
      )
    }
  }
}
