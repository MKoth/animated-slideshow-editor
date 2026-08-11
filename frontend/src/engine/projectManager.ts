import type { EventBus } from './events'
import { newId } from './ids'
import type { CreateProjectInput, ProjectMetadata } from './project'
import { Project } from './project'
import type { Slide } from './slide'
import type { ProjectMetadataJSON } from './json'
import { requireNonEmpty, requireString, requireStringAllowEmpty } from './guards'

export class ProjectManager {
  readonly #bus: EventBus
  #project: Project | null = null

  constructor(bus: EventBus) {
    this.#bus = bus
  }

  get current(): Project | null {
    return this.#project
  }

  create(input: CreateProjectInput): Project {
    if (this.#project) {
      throw new Error('A project already exists in memory')
    }
    requireNonEmpty(input.name, 'Project name')
    const now = new Date().toISOString()
    const metadata: ProjectMetadata = {
      id: newId('project'),
      name: input.name,
      description: input.description ?? '',
      author: input.author ?? '',
      createdAt: now,
      updatedAt: now,
    }
    const project = new Project(metadata, [])
    this.#project = project
    this.#bus.emit({ type: 'ProjectCreated', projectId: project.id })
    return project
  }

  restore(
    metadata: ProjectMetadataJSON,
    slides: Slide[],
    settings: Readonly<Record<string, unknown>>,
  ): Project {
    const project = new Project(
      {
        id: requireString(metadata.id, 'Project id'),
        name: requireString(metadata.name, 'Project name'),
        description: requireStringAllowEmpty(metadata.description, 'Project description'),
        author: requireStringAllowEmpty(metadata.author, 'Project author'),
        createdAt: requireString(metadata.createdAt, 'Project createdAt'),
        updatedAt: requireString(metadata.updatedAt, 'Project updatedAt'),
      },
      slides,
      settings,
    )
    this.#project = project
    return project
  }

  clear(): void {
    this.#project = null
  }
}
