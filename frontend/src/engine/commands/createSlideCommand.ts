import type { Engine } from '../internal'
import type { Command } from './command'

export interface CreateSlideParameters {
  readonly name: string
}

export interface CreateSlideInverse {
  readonly slideId: string
}

export class CreateSlideCommand implements Command<CreateSlideInverse> {
  readonly type = 'CreateSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string

  constructor(input: CreateSlideParameters) {
    this.#name = input.name
    this.parameters = { name: input.name }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    if (this.#name.trim() === '') {
      throw new Error('Slide name must not be empty')
    }
  }

  execute(engine: Engine): CreateSlideInverse {
    const slide = engine.createSlide(this.#name)
    return { slideId: slide.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
