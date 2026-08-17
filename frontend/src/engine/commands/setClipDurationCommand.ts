import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetClipDurationParameters {
  readonly clipId: string
  readonly duration: number
}

export interface SetClipDurationInverse {
  readonly clipId: string
  readonly oldDuration: number
}

export class SetClipDurationCommand implements Command<SetClipDurationInverse> {
  readonly type = 'SetClipDuration'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #duration: number

  constructor(input: SetClipDurationParameters) {
    this.#clipId = input.clipId
    this.#duration = input.duration
    this.parameters = { clipId: input.clipId, duration: input.duration }
  }

  validate(engine: Engine): void {
    engine.getClip(this.#clipId)
    requireFiniteNumber(this.#duration, 'Clip duration')
    if (this.#duration < 0) {
      throw new Error('Clip duration must be non-negative')
    }
  }

  execute(engine: Engine): SetClipDurationInverse {
    const clip = engine.getClip(this.#clipId)
    const oldDuration = clip.duration
    engine.setClipDuration(this.#clipId, this.#duration)
    return { clipId: this.#clipId, oldDuration }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
