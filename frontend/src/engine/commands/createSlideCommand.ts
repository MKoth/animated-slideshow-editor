import type { Engine } from '../internal'
import type { Command } from './command'
import { requireNonEmpty } from '../guards'

export interface CreateSlideParameters {
  readonly name?: string
  /**
   * Pre-generated slide id for transactional planning (issue #471): callers
   * that must reference the new slide from later children of the same
   * Transaction generate the id upfront via `newId('slide')`. Absent ids keep
   * the legacy generated behavior.
   */
  readonly slideId?: string
}

export interface CreateSlideInverse {
  readonly slideId: string
}

export class CreateSlideCommand implements Command<CreateSlideInverse> {
  readonly type = 'CreateSlide'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string | undefined
  readonly #slideId: string | undefined

  constructor(input: CreateSlideParameters = {}) {
    this.#name = input.name
    this.#slideId = input.slideId
    this.parameters = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slideId !== undefined ? { slideId: input.slideId } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    if (this.#name !== undefined) {
      requireNonEmpty(this.#name, 'Slide name')
    }
    if (this.#slideId !== undefined) {
      requireNonEmpty(this.#slideId, 'Slide id')
      const existing = engine.project?.slides.some((slide) => slide.id === this.#slideId)
      if (existing) {
        throw new Error(`Slide id already exists: ${this.#slideId}`)
      }
    }
  }

  execute(engine: Engine): CreateSlideInverse {
    const slide = engine.createSlide(this.#name, this.#slideId)
    return { slideId: slide.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
