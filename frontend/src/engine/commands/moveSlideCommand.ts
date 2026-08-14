import type { Engine } from '../internal'
import type { Command } from './command'

export interface MoveSlideParameters {
  readonly slideId: string
  readonly index: number
}

export interface MoveSlideInverse {
  readonly slideId: string
  readonly oldIndex: number
}

export class MoveSlideCommand implements Command<MoveSlideInverse> {
  readonly type = 'MoveSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #index: number

  constructor(input: MoveSlideParameters) {
    this.#slideId = input.slideId
    this.#index = input.index
    this.parameters = { slideId: input.slideId, index: input.index }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const project = engine.project
    if (!project) {
      throw new Error('No project exists in memory')
    }
    if (!Number.isInteger(this.#index) || this.#index < 0 || this.#index >= project.slides.length) {
      throw new Error(`Move index out of bounds: ${this.#index}`)
    }
  }

  execute(engine: Engine): MoveSlideInverse {
    const slide = engine.getSlide(this.#slideId)
    const project = engine.project
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const oldIndex = project.slides.indexOf(slide)
    engine.moveSlide(this.#slideId, this.#index)
    return { slideId: this.#slideId, oldIndex }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
