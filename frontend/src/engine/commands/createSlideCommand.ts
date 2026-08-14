import type { Engine } from '../internal'
import type { Command } from './command'
import { requireNonEmpty } from '../guards'

export interface CreateSlideParameters {
  readonly name?: string
}

export interface CreateSlideInverse {
  readonly slideId: string
}

export class CreateSlideCommand implements Command<CreateSlideInverse> {
  readonly type = 'CreateSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string | undefined

  constructor(input: CreateSlideParameters = {}) {
    this.#name = input.name
    this.parameters = input.name !== undefined ? { name: input.name } : {}
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    if (this.#name !== undefined) {
      requireNonEmpty(this.#name, 'Slide name')
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
