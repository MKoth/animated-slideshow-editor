import type { Slide } from './slide'
import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import type { EmbeddedShaderDefinition } from './embeddedShader'

export interface ProjectMetadata {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly author: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateProjectInput {
  readonly name: string
  readonly description?: string
  readonly author?: string
}

export class Project {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly author: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly slides: Slide[]
  readonly settings: Readonly<Record<string, unknown>>
  readonly #embeddedAssets: EmbeddedAsset[]
  readonly #embeddedMaterials: EmbeddedMaterialDefinition[]
  readonly #embeddedShaders: EmbeddedShaderDefinition[]

  constructor(
    metadata: ProjectMetadata,
    slides: Slide[],
    settings: Readonly<Record<string, unknown>> = {},
    embeddedAssets: readonly EmbeddedAsset[] = [],
    embeddedMaterials: readonly EmbeddedMaterialDefinition[] = [],
    embeddedShaders: readonly EmbeddedShaderDefinition[] = [],
  ) {
    this.id = metadata.id
    this.name = metadata.name
    this.description = metadata.description
    this.author = metadata.author
    this.createdAt = metadata.createdAt
    this.updatedAt = metadata.updatedAt
    this.slides = slides
    this.settings = settings
    this.#embeddedAssets = [...embeddedAssets]
    this.#embeddedMaterials = [...embeddedMaterials]
    this.#embeddedShaders = [...embeddedShaders]
  }

  get embeddedAssets(): readonly EmbeddedAsset[] {
    return this.#embeddedAssets
  }

  get embeddedMaterials(): readonly EmbeddedMaterialDefinition[] {
    return this.#embeddedMaterials
  }

  get embeddedShaders(): readonly EmbeddedShaderDefinition[] {
    return this.#embeddedShaders
  }

  embedAsset(asset: EmbeddedAsset): void {
    const index = this.#embeddedAssets.findIndex((entry) => entry.id === asset.id)
    if (index >= 0) {
      this.#embeddedAssets[index] = asset
    } else {
      this.#embeddedAssets.push(asset)
    }
  }

  embedMaterial(definition: EmbeddedMaterialDefinition): void {
    const index = this.#embeddedMaterials.findIndex((entry) => entry.id === definition.id)
    if (index >= 0) {
      this.#embeddedMaterials[index] = definition
    } else {
      this.#embeddedMaterials.push(definition)
    }
  }

  embedShader(definition: EmbeddedShaderDefinition): void {
    const index = this.#embeddedShaders.findIndex((entry) => entry.id === definition.id)
    if (index >= 0) {
      this.#embeddedShaders[index] = definition
    } else {
      this.#embeddedShaders.push(definition)
    }
  }
}
