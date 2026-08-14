import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClampedKeyframe } from '../animation'
import { MIN_SLIDE_DURATION, MAX_SLIDE_DURATION } from '../slide'
import { requireFiniteNumber } from '../guards'

export interface SetSlideDurationParameters {
  readonly slideId: string
  readonly duration: number
}

export interface SetSlideDurationInverse {
  readonly slideId: string
  readonly oldDuration: number
  readonly clampedKeyframes: readonly ClampedKeyframe[]
}

export class SetSlideDurationCommand implements Command<SetSlideDurationInverse> {
  readonly type = 'SetSlideDuration'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #duration: number

  constructor(input: SetSlideDurationParameters) {
    this.#slideId = input.slideId
    this.#duration = input.duration
    this.parameters = { slideId: input.slideId, duration: input.duration }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    requireFiniteNumber(
      this.#duration,
      'Slide duration',
      (value) => value >= MIN_SLIDE_DURATION && value <= MAX_SLIDE_DURATION,
      `a number within [${MIN_SLIDE_DURATION}, ${MAX_SLIDE_DURATION}]`,
    )
  }

  execute(engine: Engine): SetSlideDurationInverse {
    const change = engine.setSlideDuration(this.#slideId, this.#duration)
    return {
      slideId: this.#slideId,
      oldDuration: change.oldDuration,
      clampedKeyframes: change.clampedKeyframes,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
