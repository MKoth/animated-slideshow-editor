import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetAudioClipVolumeParameters {
  readonly slideId: string
  readonly clipId: string
  readonly volume: number
}

export interface SetAudioClipVolumeInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldVolume: number
}

export class SetAudioClipVolumeCommand implements Command<SetAudioClipVolumeInverse> {
  readonly type = 'SetAudioClipVolume'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #volume: number

  constructor(input: SetAudioClipVolumeParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#volume = input.volume
    this.parameters = { slideId: input.slideId, clipId: input.clipId, volume: input.volume }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    requireFiniteNumber(this.#volume, 'AudioClip volume', (v) => v >= 0 && v <= 1)
  }

  execute(engine: Engine): SetAudioClipVolumeInverse {
    const oldVolume = engine.setAudioClipVolume(this.#slideId, this.#clipId, this.#volume)
    return { slideId: this.#slideId, clipId: this.#clipId, oldVolume }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
