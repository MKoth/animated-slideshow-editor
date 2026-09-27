import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireStringAllowEmpty } from '../guards'
import { newId } from '../ids'
import { parseScriptLibraryFunction } from '../animationScriptParser'
import { findDuplicateScriptFunctionName } from '../scriptLibrary'
import type { ScriptLibraryEntry } from '../scriptLibrary'

export interface SetScriptLibraryEntryParameters {
  readonly id?: string
  readonly name: string
  readonly description?: string
  readonly source: string
}

export interface SetScriptLibraryEntryInverse {
  readonly entryId: string
  readonly previous: ScriptLibraryEntry | null
  readonly next: ScriptLibraryEntry
  readonly created: boolean
}

function validateEntrySource(name: string, source: string): void {
  const trimmedName = name.trim()
  if (trimmedName === '') {
    throw new Error('Script function name must not be empty')
  }
  const parsed = parseScriptLibraryFunction(source)
  if (parsed.def === null || parsed.diagnostics.length > 0) {
    const first = parsed.diagnostics[0]
    throw new Error(
      `Script function "${trimmedName}" source is invalid: ${first !== undefined ? first.message : 'must define one function'}`,
    )
  }
  if (parsed.def.name !== trimmedName) {
    throw new Error(
      `Script function source defines "${parsed.def.name}", expected "${trimmedName}" — the function name must match the entry name`,
    )
  }
}

export class SetScriptLibraryEntryCommand implements Command<SetScriptLibraryEntryInverse> {
  readonly type = 'SetScriptLibraryEntry'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #id: string | undefined
  readonly #name: string
  readonly #description: string
  readonly #source: string

  constructor(input: SetScriptLibraryEntryParameters) {
    this.#id = input.id
    this.#name = input.name
    this.#description = input.description ?? ''
    this.#source = input.source
    this.parameters = {
      ...(input.id !== undefined ? { id: input.id } : {}),
      name: input.name,
      description: this.#description,
      source: input.source,
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    requireString(this.#name, 'Script function name')
    if (this.#name.trim() === '') {
      throw new Error('Script function name must not be empty')
    }
    requireStringAllowEmpty(this.#description, 'Script function description')
    requireStringAllowEmpty(this.#source, 'Script function source')
    validateEntrySource(this.#name, this.#source)
    const entries = engine.project.scriptFunctions
    const duplicate = findDuplicateScriptFunctionName(entries, this.#name, this.#id)
    if (duplicate) {
      throw new Error(
        `A script function named "${this.#name}" already exists (matching "${duplicate.name}")`,
      )
    }
    if (this.#id !== undefined) {
      // Updating an existing entry is allowed; creating with an explicit id
      // that does not exist yet is also allowed (stable id for AI proposals).
      void 0
    }
  }

  execute(engine: Engine): SetScriptLibraryEntryInverse {
    const project = engine.project
    if (!project) throw new Error('No project exists in memory')
    const trimmedName = this.#name.trim()
    const existing =
      this.#id !== undefined
        ? (project.scriptFunctions.find((entry) => entry.id === this.#id) ?? null)
        : (project.scriptFunctions.find(
            (entry) => entry.name.trim().toLowerCase() === trimmedName.toLowerCase(),
          ) ?? null)
    if (existing) {
      const sourceChanged = existing.source !== this.#source
      const next: ScriptLibraryEntry = {
        id: existing.id,
        name: trimmedName,
        description: this.#description,
        source: this.#source,
        version: sourceChanged ? existing.version + 1 : existing.version,
      }
      engine.upsertScriptFunction(next)
      return { entryId: existing.id, previous: { ...existing }, next: { ...next }, created: false }
    }
    const next: ScriptLibraryEntry = {
      id: this.#id ?? newId('script-function'),
      name: trimmedName,
      description: this.#description,
      source: this.#source,
      version: 1,
    }
    engine.upsertScriptFunction(next)
    return { entryId: next.id, previous: null, next: { ...next }, created: true }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
