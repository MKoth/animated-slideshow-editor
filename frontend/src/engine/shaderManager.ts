import { ShaderDefinition } from './shaderDefinition'
import { requireNonEmpty } from './guards'
import type { MaterialParameterDefault } from './materialResolution'

export class ShaderManager {
  readonly #definitions = new Map<string, ShaderDefinition>()

  get definitions(): readonly ShaderDefinition[] {
    return [...this.#definitions.values()]
  }

  register(
    id: string,
    name: string,
    parameters: readonly MaterialParameterDefault[] = [],
  ): ShaderDefinition {
    requireNonEmpty(name, 'Shader definition name')
    const definition = new ShaderDefinition(id, name, parameters)
    this.#definitions.set(id, definition)
    return definition
  }

  getDefinition(definitionId: string): ShaderDefinition {
    const definition = this.#definitions.get(definitionId)
    if (!definition) {
      throw new Error(`Shader definition not found: ${definitionId}`)
    }
    return definition
  }

  clear(): void {
    this.#definitions.clear()
  }
}
