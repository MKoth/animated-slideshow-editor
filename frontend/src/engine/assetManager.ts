import { newId } from './ids'
import { AssetDefinition } from './assetDefinition'
import type { NodeManager } from './nodeManager'
import type { CreateNodeOptions } from './nodeManager'
import type { SceneNode } from './sceneNode'
import type { LessonJSON } from './json'
import { isRecord, requireNonEmpty, requireString } from './guards'

export class AssetManager {
  readonly #nodeManager: NodeManager
  readonly #definitions = new Map<string, AssetDefinition>()

  constructor(nodeManager: NodeManager) {
    this.#nodeManager = nodeManager
  }

  get definitions(): readonly AssetDefinition[] {
    return [...this.#definitions.values()]
  }

  defineAsset(name: string): AssetDefinition {
    requireNonEmpty(name, 'Asset definition name')
    const definition = new AssetDefinition(newId('asset'), name)
    this.#definitions.set(definition.id, definition)
    return definition
  }

  getDefinition(definitionId: string): AssetDefinition {
    const definition = this.#definitions.get(definitionId)
    if (!definition) {
      throw new Error(`Asset definition not found: ${definitionId}`)
    }
    return definition
  }

  register(id: string, name: string): AssetDefinition {
    requireNonEmpty(name, 'Asset definition name')
    const definition = new AssetDefinition(id, name)
    this.#definitions.set(id, definition)
    return definition
  }

  createInstance(
    sceneId: string,
    parentId: string,
    definitionId: string,
    name: string,
    options: Omit<CreateNodeOptions, 'components'> = {},
  ): SceneNode {
    const definition = this.getDefinition(definitionId)
    const components = {
      assetInstance: Object.freeze({
        kind: 'assetInstance' as const,
        assetDefinitionId: definition.id,
      }),
    }
    return this.#nodeManager.create(sceneId, parentId, name, { ...options, components })
  }

  restoreLibrary(library: LessonJSON['library']): void {
    this.#definitions.clear()
    if (!Array.isArray(library.assetDefinitions)) {
      throw new Error('Invalid lesson JSON: assetDefinitions must be an array')
    }
    for (const definitionJson of library.assetDefinitions) {
      if (!isRecord(definitionJson)) {
        throw new Error('Invalid lesson JSON: each asset definition must be an object')
      }
      const definition = new AssetDefinition(
        requireString(definitionJson.id, 'Asset definition id'),
        requireString(definitionJson.name, 'Asset definition name'),
      )
      if (this.#definitions.has(definition.id)) {
        throw new Error(`An asset definition with id "${definition.id}" already exists`)
      }
      this.#definitions.set(definition.id, definition)
    }
  }

  clear(): void {
    this.#definitions.clear()
  }
}
