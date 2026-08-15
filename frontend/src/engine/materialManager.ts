import { MaterialDefinition } from './materialDefinition'
import { requireNonEmpty } from './guards'

export class MaterialManager {
  readonly #definitions = new Map<string, MaterialDefinition>()

  get definitions(): readonly MaterialDefinition[] {
    return [...this.#definitions.values()]
  }

  register(id: string, name: string): MaterialDefinition {
    requireNonEmpty(name, 'Material definition name')
    const definition = new MaterialDefinition(id, name)
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
