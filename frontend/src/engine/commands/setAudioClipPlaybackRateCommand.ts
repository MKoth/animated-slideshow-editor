import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetAudioClipPlaybackRateParameters {
  readonly slideId: string
  readonly clipId: string
  readonly playbackRate: number
}

export interface SetAudioClipPlaybackRateInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldPlaybackRate: number
}

export class SetAudioClipPlaybackRateCommand implements Command<SetAudioClipPlaybackRateInverse> {
  readonly type = 'SetAudioClipPlaybackRate'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #playbackRate: number

  constructor(input: SetAudioClipPlaybackRateParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#playbackRate = input.playbackRate
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      playbackRate: input.playbackRate,
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    requireFiniteNumber(this.#playbackRate, 'AudioClip playbackRate', (v) => v > 0)
  }

  execute(engine: Engine): SetAudioClipPlaybackRateInverse {
    const oldPlaybackRate = engine.setAudioClipPlaybackRate(
      this.#slideId,
      this.#clipId,
      this.#playbackRate,
    )
    return { slideId: this.#slideId, clipId: this.#clipId, oldPlaybackRate }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
