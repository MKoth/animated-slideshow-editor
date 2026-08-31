import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SplitAudioClipParameters {
  readonly slideId: string
  readonly clipId: string
  readonly atTime: number
}

export interface SplitAudioClipInverse {
  readonly slideId: string
  readonly originalClipId: string
  readonly newClipId: string
  readonly originalSourceEnd: number
}

export class SplitAudioClipCommand implements Command<SplitAudioClipInverse> {
  readonly type = 'SplitAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #atTime: number

  constructor(input: SplitAudioClipParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#atTime = input.atTime
    this.parameters = { slideId: input.slideId, clipId: input.clipId, atTime: input.atTime }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    requireFiniteNumber(this.#atTime, 'Split atTime', (v) => Number.isFinite(v))
    const playbackDuration = (clip.sourceEnd - clip.sourceStart) / (clip.playbackRate || 1)
    const start = clip.timelineStart
    const end = start + playbackDuration
    if (this.#atTime <= start || this.#atTime >= end) {
      throw new Error('Split time must be inside the clip')
    }
  }

  execute(engine: Engine): SplitAudioClipInverse {
    const result = engine.splitAudioClip(this.#slideId, this.#clipId, this.#atTime)
    return {
      slideId: this.#slideId,
      originalClipId: this.#clipId,
      newClipId: result.newClipId,
      originalSourceEnd: result.originalSourceEnd,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
