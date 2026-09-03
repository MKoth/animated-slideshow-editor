import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetAudioClipNoiseReductionParameters {
  readonly slideId: string
  readonly clipId: string
  readonly noiseReduction: number
}

export interface SetAudioClipNoiseReductionInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldNoiseReduction: number
}

export class SetAudioClipNoiseReductionCommand implements Command<SetAudioClipNoiseReductionInverse> {
  readonly type = 'SetAudioClipNoiseReduction'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #noiseReduction: number

  constructor(input: SetAudioClipNoiseReductionParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#noiseReduction = input.noiseReduction
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      noiseReduction: input.noiseReduction,
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    requireFiniteNumber(this.#noiseReduction, 'AudioClip noiseReduction', (v) => v >= 0 && v <= 1)
  }

  execute(engine: Engine): SetAudioClipNoiseReductionInverse {
    const oldNoiseReduction = engine.setAudioClipNoiseReduction(
      this.#slideId,
      this.#clipId,
      this.#noiseReduction,
    )
    return { slideId: this.#slideId, clipId: this.#clipId, oldNoiseReduction }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
