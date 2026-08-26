import type { Slide } from './slide'
import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import type { EmbeddedShaderDefinition } from './embeddedShader'
import type {
  EmbeddedDataSourceDefinition,
  EmbeddedFlowchartDataSourceDefinition,
} from './embeddedDataSource'

export type EmbeddedDataSourceUnion =
  EmbeddedDataSourceDefinition | EmbeddedFlowchartDataSourceDefinition

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
  readonly #embeddedDataSources: EmbeddedDataSourceUnion[]

  constructor(
    metadata: ProjectMetadata,
    slides: Slide[],
    settings: Readonly<Record<string, unknown>> = {},
    embeddedAssets: readonly EmbeddedAsset[] = [],
    embeddedMaterials: readonly EmbeddedMaterialDefinition[] = [],
    embeddedShaders: readonly EmbeddedShaderDefinition[] = [],
    embeddedDataSources: readonly EmbeddedDataSourceUnion[] = [],
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
    this.#embeddedDataSources = [...embeddedDataSources]
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

  get embeddedDataSources(): readonly EmbeddedDataSourceUnion[] {
    return this.#embeddedDataSources
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

  embedDataSource(definition: EmbeddedDataSourceUnion): void {
    const index = this.#embeddedDataSources.findIndex((entry) => entry.id === definition.id)
    if (index >= 0) {
      this.#embeddedDataSources[index] = definition
    } else {
      this.#embeddedDataSources.push(definition)
    }
  }

  removeDataSource(id: string): boolean {
    const index = this.#embeddedDataSources.findIndex((entry) => entry.id === id)
    if (index < 0) {
      return false
    }
    this.#embeddedDataSources.splice(index, 1)
    return true
  }
}
