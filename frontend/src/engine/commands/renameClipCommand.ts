import type { Engine } from '../internal'
import type { Command } from './command'
import { requireNonEmpty } from '../guards'

export interface RenameClipParameters {
  readonly clipId: string
  readonly name: string
}

export interface RenameClipInverse {
  readonly clipId: string
  readonly oldName: string
}

export class RenameClipCommand implements Command<RenameClipInverse> {
  readonly type = 'RenameClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #name: string

  constructor(input: RenameClipParameters) {
    this.#clipId = input.clipId
    this.#name = input.name
    this.parameters = { clipId: input.clipId, name: input.name }
  }

  validate(engine: Engine): void {
    const clip = engine.getClip(this.#clipId)
    requireNonEmpty(this.#name, 'Clip name')
    if (this.#name === clip.name) {
      throw new Error('Clip name is unchanged')
    }
  }

  execute(engine: Engine): RenameClipInverse {
    const clip = engine.getClip(this.#clipId)
    const oldName = clip.name
    engine.renameClip(this.#clipId, this.#name)
    return { clipId: this.#clipId, oldName }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
