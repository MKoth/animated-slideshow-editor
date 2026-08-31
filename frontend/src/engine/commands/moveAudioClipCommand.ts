import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import { requireAudioTrackId } from '../audioClip'
import type { AudioTrackId } from '../audioClip'

export interface MoveAudioClipParameters {
  readonly slideId: string
  readonly clipId: string
  readonly timelineStart: number
  readonly trackId?: AudioTrackId
}

export interface MoveAudioClipInverse {
  readonly slideId: string
  readonly clipId: string
  readonly oldTimelineStart: number
  readonly oldTrackId: AudioTrackId
}

export class MoveAudioClipCommand implements Command<MoveAudioClipInverse> {
  readonly type = 'MoveAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string
  readonly #timelineStart: number
  readonly #trackId?: AudioTrackId

  constructor(input: MoveAudioClipParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.#timelineStart = input.timelineStart
    this.#trackId = input.trackId
    this.parameters = {
      slideId: input.slideId,
      clipId: input.clipId,
      timelineStart: input.timelineStart,
      ...(input.trackId !== undefined ? { trackId: input.trackId } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
    requireFiniteNumber(this.#timelineStart, 'AudioClip timelineStart', (v) => v >= 0)
    if (this.#trackId !== undefined) requireAudioTrackId(this.#trackId, 'AudioClip trackId')
  }

  execute(engine: Engine): MoveAudioClipInverse {
    const result = engine.moveAudioClip(this.#slideId, this.#clipId, {
      timelineStart: this.#timelineStart,
      trackId: this.#trackId,
    })
    return {
      slideId: this.#slideId,
      clipId: this.#clipId,
      oldTimelineStart: result.oldTimelineStart,
      oldTrackId: result.oldTrackId,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
