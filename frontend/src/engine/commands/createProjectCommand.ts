import type { Engine } from '../internal'
import type { Command } from './command'

export interface CreateProjectParameters {
  readonly name: string
  readonly description?: string
  readonly author?: string
}

export interface CreateProjectInverse {
  readonly projectId: string
}

export class CreateProjectCommand implements Command<CreateProjectInverse> {
  readonly type = 'CreateProject'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string
  readonly #description: string | undefined
  readonly #author: string | undefined

  constructor(input: CreateProjectParameters) {
    this.#name = input.name
    this.#description = input.description
    this.#author = input.author
    this.parameters = {
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
      ...(input.author !== undefined && { author: input.author }),
    }
  }

  validate(engine: Engine): void {
    if (engine.project) {
      throw new Error('A project already exists in memory')
    }
    if (this.#name.trim() === '') {
      throw new Error('Project name must not be empty')
    }
  }

  execute(engine: Engine): CreateProjectInverse {
    const project = engine.createProject({
      name: this.#name,
      description: this.#description,
      author: this.#author,
    })
    return { projectId: project.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
