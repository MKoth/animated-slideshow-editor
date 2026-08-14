import type { Slide } from './slide'

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

  constructor(
    metadata: ProjectMetadata,
    slides: Slide[],
    settings: Readonly<Record<string, unknown>> = {},
  ) {
    this.id = metadata.id
    this.name = metadata.name
    this.description = metadata.description
    this.author = metadata.author
    this.createdAt = metadata.createdAt
    this.updatedAt = metadata.updatedAt
    this.slides = slides
    this.settings = settings
  }
}
