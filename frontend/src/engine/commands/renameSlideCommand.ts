import type { Engine } from '../internal'
import type { Command } from './command'
import { requireNonEmpty } from '../guards'

export interface RenameSlideParameters {
  readonly slideId: string
  readonly name: string
}

export interface RenameSlideInverse {
  readonly slideId: string
  readonly oldName: string
}

export class RenameSlideCommand implements Command<RenameSlideInverse> {
  readonly type = 'RenameSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #name: string

  constructor(input: RenameSlideParameters) {
    this.#slideId = input.slideId
    this.#name = input.name
    this.parameters = { slideId: input.slideId, name: input.name }
  }

  validate(engine: Engine): void {
    requireNonEmpty(this.#name, 'Slide name')
    engine.getSlide(this.#slideId)
  }

  execute(engine: Engine): RenameSlideInverse {
    const slide = engine.getSlide(this.#slideId)
    const oldName = slide.name
    engine.renameSlide(this.#slideId, this.#name)
    return { slideId: this.#slideId, oldName }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
