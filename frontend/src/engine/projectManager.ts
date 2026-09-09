import type { EventBus } from './events'
import { newId } from './ids'
import type { CreateProjectInput, ProjectMetadata } from './project'
import { Project } from './project'
import { requireNonEmpty } from './guards'

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

  install(project: Project): Project {
    this.#project = project
    return project
  }

  rename(name: string): { oldName: string; oldUpdatedAt: string } {
    const project = this.#project
    if (!project) {
      throw new Error('No project is currently open')
    }
    requireNonEmpty(name, 'Project name')
    const trimmed = name.trim()
    requireNonEmpty(trimmed, 'Project name')
    const result = project.rename(trimmed)
    this.#bus.emit({ type: 'ProjectRenamed', projectId: project.id })
    return result
  }

  restoreRename(oldName: string, oldUpdatedAt: string): void {
    const project = this.#project
    if (!project) {
      throw new Error('No project is currently open')
    }
    project.restoreRename(oldName, oldUpdatedAt)
    this.#bus.emit({ type: 'ProjectRenamed', projectId: project.id })
  }

  clear(): void {
    this.#project = null
  }
}
