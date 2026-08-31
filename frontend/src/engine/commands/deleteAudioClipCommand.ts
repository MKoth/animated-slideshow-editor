import type { Engine } from '../internal'
import type { Command } from './command'
import type { AudioClip } from '../audioClip'

export interface DeleteAudioClipParameters {
  readonly slideId: string
  readonly clipId: string
}

export interface DeleteAudioClipInverse {
  readonly slideId: string
  readonly clip: AudioClip
  readonly index: number
}

export class DeleteAudioClipCommand implements Command<DeleteAudioClipInverse> {
  readonly type = 'DeleteAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string

  constructor(input: DeleteAudioClipParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.parameters = { slideId: input.slideId, clipId: input.clipId }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
  }

  execute(engine: Engine): DeleteAudioClipInverse {
    const slide = engine.getSlide(this.#slideId)
    const index = slide.audio.clips.findIndex((c) => c.id === this.#clipId)
    const removed = engine.deleteAudioClip(this.#slideId, this.#clipId)
    return { slideId: this.#slideId, clip: removed, index }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
