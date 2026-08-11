import type { Slide } from './slide'
import type { ProjectJSON } from './json'

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

  toJSON(): ProjectJSON {
    return {
      metadata: {
        id: this.id,
        name: this.name,
        description: this.description,
        author: this.author,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      },
      settings: { ...this.settings },
      slides: this.slides.map((slide) => slide.toJSON()),
    }
  }
}
