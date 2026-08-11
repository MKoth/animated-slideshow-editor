import type { AssetDefinitionJSON } from './json'

export class AssetDefinition {
  readonly id: string
  readonly name: string

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
    Object.freeze(this)
  }

  toJSON(): AssetDefinitionJSON {
    return { id: this.id, name: this.name }
  }
}
