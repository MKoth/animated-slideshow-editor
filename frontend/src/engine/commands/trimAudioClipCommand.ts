import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface TrimAudioClipParameters {
  readonly slideId: string
  readonly clipId: string
  readonly sourceStart?: number
  readonly sourceEnd?: number
}

export interface TrimAudioClipInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldSourceStart: number
  readonly oldSourceEnd: number
}

export class TrimAudioClipCommand implements Command<TrimAudioClipInverse> {
  readonly type = 'TrimAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #sourceStart?: number
  readonly #sourceEnd?: number

  constructor(input: TrimAudioClipParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#sourceStart = input.sourceStart
    this.#sourceEnd = input.sourceEnd
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      ...(input.sourceStart !== undefined ? { sourceStart: input.sourceStart } : {}),
      ...(input.sourceEnd !== undefined ? { sourceEnd: input.sourceEnd } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    const newStart = this.#sourceStart ?? clip.sourceStart
    const newEnd = this.#sourceEnd ?? clip.sourceEnd
    requireFiniteNumber(newStart, 'AudioClip sourceStart', (v) => v >= 0)
    requireFiniteNumber(newEnd, 'AudioClip sourceEnd', (v) => v > 0)
    if (newEnd <= newStart) throw new Error('AudioClip sourceEnd must be greater than sourceStart')
  }

  execute(engine: Engine): TrimAudioClipInverse {
    const result = engine.trimAudioClip(this.#slideId, this.#clipId, {
      sourceStart: this.#sourceStart,
      sourceEnd: this.#sourceEnd,
    })
    return {
      slideId: this.#slideId,
      clipId: this.#clipId,
      oldSourceStart: result.oldSourceStart,
      oldSourceEnd: result.oldSourceEnd,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
