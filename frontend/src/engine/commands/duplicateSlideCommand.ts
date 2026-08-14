import type { Engine } from '../internal'
import type { Command } from './command'

export interface DuplicateSlideParameters {
  readonly slideId: string
}

export interface DuplicateSlideInverse {
  readonly slideId: string
}

export class DuplicateSlideCommand implements Command<DuplicateSlideInverse> {
  readonly type = 'DuplicateSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string

  constructor(input: DuplicateSlideParameters) {
    this.#slideId = input.slideId
    this.parameters = { slideId: input.slideId }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    engine.getSlide(this.#slideId)
  }

  execute(engine: Engine): DuplicateSlideInverse {
    const slide = engine.duplicateSlide(this.#slideId)
    return { slideId: slide.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
