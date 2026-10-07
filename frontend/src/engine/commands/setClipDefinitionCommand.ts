import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipJSON } from '../json'
import { ClipDefinition } from '../clipDefinition'

export interface SetClipDefinitionParameters {
  readonly clip: ClipJSON
}

export interface SetClipDefinitionInverse {
  readonly clip: ClipJSON
}

/** Replace a reusable clip definition while preserving an undo snapshot. */
export class SetClipDefinitionCommand implements Command<SetClipDefinitionInverse> {
  readonly type = 'SetClipDefinition'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clip: ClipJSON

  constructor(input: SetClipDefinitionParameters) {
    this.#clip = structuredClone(input.clip)
    this.parameters = { clip: this.#clip }
  }

  validate(engine: Engine): void {
    engine.getClip(this.#clip.id)
    // Parse up front so malformed replacements fail before changing project data.
    const candidate = ClipDefinition.fromJSON(this.#clip)
    if (candidate.id !== this.#clip.id) throw new Error('Clip id cannot be changed')
  }

  execute(engine: Engine): SetClipDefinitionInverse {
    const clip = engine.getClip(this.#clip.id).toJSON()
    engine.restoreClipFromJSON(this.#clip)
    engine.emitClipChanged(this.#clip.id)
    return { clip }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
