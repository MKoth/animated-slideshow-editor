import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetAudioClipMutedParameters {
  readonly slideId: string
  readonly clipId: string
  readonly muted: boolean
}

export interface SetAudioClipMutedInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldMuted: boolean
}

export class SetAudioClipMutedCommand implements Command<SetAudioClipMutedInverse> {
  readonly type = 'SetAudioClipMuted'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #muted: boolean

  constructor(input: SetAudioClipMutedParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#muted = input.muted
    this.parameters = { slideId: input.slideId, clipId: input.clipId, muted: input.muted }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    if (typeof this.#muted !== 'boolean') throw new Error('AudioClip muted must be a boolean')
  }

  execute(engine: Engine): SetAudioClipMutedInverse {
    const oldMuted = engine.setAudioClipMuted(this.#slideId, this.#clipId, this.#muted)
    return { slideId: this.#slideId, clipId: this.#clipId, oldMuted }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
