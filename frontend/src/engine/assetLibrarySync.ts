import type { Engine } from './internal'

export interface AssetDefinitionRef {
  readonly id: string
  readonly name: string
}

export class AssetLibrarySync {
  readonly #engine: Engine
  /** Library ids this sync mirrored: only these are ever removed. */
  readonly #syncedIds = new Set<string>()

  constructor(engine: Engine) {
    this.#engine = engine
  }

  /**
   * Additively merge these definitions into the mirror. Tracked like
   * `syncAll`, so a later `syncAll` drops them if the library no longer
   * lists them.
   */
  apply(definitions: readonly AssetDefinitionRef[]): void {
    for (const definition of definitions) {
      this.#engine.registerAssetDefinition(definition.id, definition.name)
      this.#syncedIds.add(definition.id)
    }
  }

  /**
   * Mirror exactly these library definitions: register (or rename) every
   * listed id and drop ids a previous sync added that are now gone — e.g.
   * assets deleted from the library. Ids this sync never added (project
   * definitions restored from a lesson file) are left intact.
   */
  syncAll(definitions: readonly AssetDefinitionRef[]): void {
    const next = new Set(definitions.map((definition) => definition.id))
    for (const id of [...this.#syncedIds]) {
      if (!next.has(id)) {
        this.#engine.unregisterAssetDefinition(id)
        this.#syncedIds.delete(id)
      }
    }
    for (const definition of definitions) {
      this.#engine.registerAssetDefinition(definition.id, definition.name)
      this.#syncedIds.add(definition.id)
    }
  }
}
