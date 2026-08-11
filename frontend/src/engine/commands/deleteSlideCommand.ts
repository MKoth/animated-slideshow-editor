import type { Engine } from '../internal'
import type { Command } from './command'
import type { SlideJSON } from '../json'

export interface DeleteSlideParameters {
  readonly slideId: string
}

export interface DeleteSlideInverse {
  readonly slideId: string
  readonly slideJSON: SlideJSON
}

export class DeleteSlideCommand implements Command<DeleteSlideInverse> {
  readonly type = 'DeleteSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string

  constructor(input: DeleteSlideParameters) {
    this.#slideId = input.slideId
    this.parameters = { slideId: input.slideId }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    engine.getSlide(this.#slideId)
  }

  execute(engine: Engine): DeleteSlideInverse {
    const slide = engine.getSlide(this.#slideId)
    const slideJSON = slide.toJSON()
    engine.removeSlide(this.#slideId)
    return { slideId: this.#slideId, slideJSON }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
