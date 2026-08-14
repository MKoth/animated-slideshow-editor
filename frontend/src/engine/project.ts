import type { Slide } from './slide'
import type { EmbeddedAsset } from './embeddedAsset'

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

  constructor(
    metadata: ProjectMetadata,
    slides: Slide[],
    settings: Readonly<Record<string, unknown>> = {},
    embeddedAssets: readonly EmbeddedAsset[] = [],
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
  }

  get embeddedAssets(): readonly EmbeddedAsset[] {
    return this.#embeddedAssets
  }

  embedAsset(asset: EmbeddedAsset): void {
    const index = this.#embeddedAssets.findIndex((entry) => entry.id === asset.id)
    if (index >= 0) {
      this.#embeddedAssets[index] = asset
    } else {
      this.#embeddedAssets.push(asset)
    }
  }
}
