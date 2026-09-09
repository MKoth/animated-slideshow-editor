import type { Engine } from '../internal'
import type { Command } from './command'
import { requireNonEmpty } from '../guards'

export interface RenameProjectParameters {
  readonly name: string
}

export interface RenameProjectInverse {
  readonly oldName: string
  readonly oldUpdatedAt: string
}

export class RenameProjectCommand implements Command<RenameProjectInverse> {
  readonly type = 'RenameProject'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string

  constructor(input: RenameProjectParameters) {
    this.#name = input.name
    this.parameters = { name: input.name }
  }

  validate(engine: Engine): void {
    requireNonEmpty(this.#name, 'Project name')
    requireNonEmpty(this.#name.trim(), 'Project name')
    if (!engine.project) {
      throw new Error('No project is currently open')
    }
  }

  execute(engine: Engine): RenameProjectInverse {
    const { oldName, oldUpdatedAt } = engine.renameProject(this.#name.trim())
    return { oldName, oldUpdatedAt }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
