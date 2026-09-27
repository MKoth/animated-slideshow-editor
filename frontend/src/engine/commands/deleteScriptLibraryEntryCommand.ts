import type { Engine } from '../internal'
import type { Command } from './command'
import type { ScriptLibraryEntry } from '../scriptLibrary'

export interface DeleteScriptLibraryEntryParameters {
  readonly id: string
}

export interface DeleteScriptLibraryEntryInverse {
  readonly removed: ScriptLibraryEntry
}

export class DeleteScriptLibraryEntryCommand implements Command<DeleteScriptLibraryEntryInverse> {
  readonly type = 'DeleteScriptLibraryEntry'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #id: string

  constructor(input: DeleteScriptLibraryEntryParameters) {
    this.#id = input.id
    this.parameters = { id: input.id }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    engine.getScriptFunction(this.#id)
  }

  execute(engine: Engine): DeleteScriptLibraryEntryInverse {
    const removed = engine.deleteScriptFunction(this.#id)
    return { removed: { ...removed } }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
