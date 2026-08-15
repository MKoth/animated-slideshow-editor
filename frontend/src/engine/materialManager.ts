import { MaterialDefinition } from './materialDefinition'
import { requireNonEmpty } from './guards'
import type { MaterialParameterDefault } from './materialResolution'

export class MaterialManager {
  readonly #definitions = new Map<string, MaterialDefinition>()

  get definitions(): readonly MaterialDefinition[] {
    return [...this.#definitions.values()]
  }

  register(
    id: string,
    name: string,
    parameters: readonly MaterialParameterDefault[] = [],
    shaderId: string | null = null,
  ): MaterialDefinition {
    requireNonEmpty(name, 'Material definition name')
    const definition = new MaterialDefinition(id, name, parameters, shaderId)
    this.#definitions.set(id, definition)
    return definition
  }

  getDefinition(definitionId: string): MaterialDefinition {
    const definition = this.#definitions.get(definitionId)
    if (!definition) {
      throw new Error(`Material definition not found: ${definitionId}`)
    }
    return definition
  }

  clear(): void {
    this.#definitions.clear()
  }
}
