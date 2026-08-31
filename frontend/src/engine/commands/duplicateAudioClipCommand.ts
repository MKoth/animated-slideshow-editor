import type { Engine } from '../internal'
import type { Command } from './command'

export interface DuplicateAudioClipParameters {
  readonly slideId: string
  readonly clipId: string
}

export interface DuplicateAudioClipInverse {
  readonly slideId: string
  readonly newClipId: string
}

export class DuplicateAudioClipCommand implements Command<DuplicateAudioClipInverse> {
  readonly type = 'DuplicateAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string

  constructor(input: DuplicateAudioClipParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.parameters = { slideId: input.slideId, clipId: input.clipId }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
  }

  execute(engine: Engine): DuplicateAudioClipInverse {
    const dup = engine.duplicateAudioClip(this.#slideId, this.#clipId)
    return { slideId: this.#slideId, newClipId: dup.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
