import type { Engine } from '../internal'
import type { Command } from './command'

export interface DuplicateClipParameters {
  readonly clipId: string
}

export interface DuplicateClipInverse {
  readonly clipId: string
}

export class DuplicateClipCommand implements Command<DuplicateClipInverse> {
  readonly type = 'DuplicateClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string

  constructor(input: DuplicateClipParameters) {
    this.#clipId = input.clipId
    this.parameters = { clipId: input.clipId }
  }

  validate(engine: Engine): void {
    engine.getClip(this.#clipId)
  }

  execute(engine: Engine): DuplicateClipInverse {
    const clip = engine.duplicateClip(this.#clipId)
    return { clipId: clip.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
