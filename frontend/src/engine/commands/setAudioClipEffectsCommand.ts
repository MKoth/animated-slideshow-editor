import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetAudioClipEffectsParameters {
  readonly slideId: string
  readonly clipId: string
  readonly playbackRate?: number
  readonly pitchSemitones?: number
  readonly noiseReduction?: number
}

export interface SetAudioClipEffectsInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldPlaybackRate: number
  readonly oldPitchSemitones: number
  readonly oldNoiseReduction: number
}

export class SetAudioClipEffectsCommand implements Command<SetAudioClipEffectsInverse> {
  readonly type = 'SetAudioClipEffects'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #patch: { playbackRate?: number; pitchSemitones?: number; noiseReduction?: number }

  constructor(input: SetAudioClipEffectsParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#patch = {
      ...(input.playbackRate !== undefined ? { playbackRate: input.playbackRate } : {}),
      ...(input.pitchSemitones !== undefined ? { pitchSemitones: input.pitchSemitones } : {}),
      ...(input.noiseReduction !== undefined ? { noiseReduction: input.noiseReduction } : {}),
    }
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      ...this.#patch,
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    if (this.#patch.playbackRate !== undefined) {
      requireFiniteNumber(this.#patch.playbackRate, 'AudioClip playbackRate', (v) => v > 0)
    }
    if (this.#patch.pitchSemitones !== undefined) {
      requireFiniteNumber(this.#patch.pitchSemitones, 'AudioClip pitchSemitones', (v) => v >= -12 && v <= 12)
    }
    if (this.#patch.noiseReduction !== undefined) {
      requireFiniteNumber(this.#patch.noiseReduction, 'AudioClip noiseReduction', (v) => v >= 0 && v <= 1)
    }
  }

  execute(engine: Engine): SetAudioClipEffectsInverse {
    const result = engine.setAudioClipEffects(this.#slideId, this.#clipId, this.#patch)
    return { slideId: this.#slideId, clipId: this.#clipId, ...result }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
