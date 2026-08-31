import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetAudioClipFadeParameters {
  readonly slideId: string
  readonly clipId: string
  readonly fadeIn?: number
  readonly fadeOut?: number
}

export interface SetAudioClipFadeInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldFadeIn?: number
  readonly oldFadeOut?: number
}

export class SetAudioClipFadeCommand implements Command<SetAudioClipFadeInverse> {
  readonly type = 'SetAudioClipFade'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #fadeIn?: number
  readonly #fadeOut?: number

  constructor(input: SetAudioClipFadeParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#fadeIn = input.fadeIn
    this.#fadeOut = input.fadeOut
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      ...(input.fadeIn !== undefined ? { fadeIn: input.fadeIn } : {}),
      ...(input.fadeOut !== undefined ? { fadeOut: input.fadeOut } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    if (this.#fadeIn !== undefined)
      requireFiniteNumber(this.#fadeIn, 'AudioClip fadeIn', (v) => v >= 0)
    if (this.#fadeOut !== undefined)
      requireFiniteNumber(this.#fadeOut, 'AudioClip fadeOut', (v) => v >= 0)
  }

  execute(engine: Engine): SetAudioClipFadeInverse {
    const result = engine.setAudioClipFade(this.#slideId, this.#clipId, {
      fadeIn: this.#fadeIn,
      fadeOut: this.#fadeOut,
    })
    return {
      slideId: this.#slideId,
      clipId: this.#clipId,
      oldFadeIn: result.oldFadeIn,
      oldFadeOut: result.oldFadeOut,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
