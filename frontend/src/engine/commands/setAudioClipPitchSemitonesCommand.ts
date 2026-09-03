import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetAudioClipPitchSemitonesParameters {
  readonly slideId: string
  readonly clipId: string
  readonly pitchSemitones: number
}

export interface SetAudioClipPitchSemitonesInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldPitchSemitones: number
}

export class SetAudioClipPitchSemitonesCommand implements Command<SetAudioClipPitchSemitonesInverse> {
  readonly type = 'SetAudioClipPitchSemitones'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #pitchSemitones: number

  constructor(input: SetAudioClipPitchSemitonesParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#pitchSemitones = input.pitchSemitones
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      pitchSemitones: input.pitchSemitones,
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    requireFiniteNumber(this.#pitchSemitones, 'AudioClip pitchSemitones', (v) => v >= -12 && v <= 12)
  }

  execute(engine: Engine): SetAudioClipPitchSemitonesInverse {
    const oldPitchSemitones = engine.setAudioClipPitchSemitones(
      this.#slideId,
      this.#clipId,
      this.#pitchSemitones,
    )
    return { slideId: this.#slideId, clipId: this.#clipId, oldPitchSemitones }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
