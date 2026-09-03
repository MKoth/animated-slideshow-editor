import type { Engine } from '../internal'
import type { Command } from './command'
import type { ReusableObjectJSON } from '../reusableObject'

export interface ImportReusableObjectParameters {
  readonly objectJson: ReusableObjectJSON
  readonly targetParentId?: string
}

export interface ImportReusableObjectInverse {
  readonly createdNodeIds: readonly string[]
  readonly createdClipIds: readonly string[]
  readonly createdCollectionIds: readonly string[]
}

export class ImportReusableObjectCommand implements Command<ImportReusableObjectInverse> {
  readonly type = 'ImportReusableObject'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #objectJson: ReusableObjectJSON
  readonly #targetParentId?: string

  constructor(input: ImportReusableObjectParameters) {
    if (!input.objectJson) throw new Error('ImportReusableObject requires objectJson')
    this.#objectJson = input.objectJson
    this.#targetParentId = input.targetParentId
    this.parameters = { objectJson: input.objectJson, targetParentId: input.targetParentId }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    // Validate JSON lazily to avoid circular import issues – import dynamically
    // Use a simple structural check here; full validation happens in Engine.importReusableObject
    if (!this.#objectJson || typeof this.#objectJson !== 'object') throw new Error('Invalid reusable object JSON')
    if (this.#targetParentId) engine.getNode(this.#targetParentId)
  }

  execute(engine: Engine): ImportReusableObjectInverse {
    const result = engine.importReusableObject(this.#objectJson, this.#targetParentId)
    return {
      createdNodeIds: [...result.nodeIdMap.values()],
      createdClipIds: [...result.clipIdMap.values()],
      createdCollectionIds: [...result.collectionIdMap.values()],
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
