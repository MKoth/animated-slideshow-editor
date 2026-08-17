import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetClipCategoryParameters {
  readonly clipId: string
  readonly category: string
}

export interface SetClipCategoryInverse {
  readonly clipId: string
  readonly oldCategory: string
}

export class SetClipCategoryCommand implements Command<SetClipCategoryInverse> {
  readonly type = 'SetClipCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #category: string

  constructor(input: SetClipCategoryParameters) {
    this.#clipId = input.clipId
    this.#category = input.category
    this.parameters = { clipId: input.clipId, category: input.category }
  }

  validate(engine: Engine): void {
    engine.getClip(this.#clipId)
  }

  execute(engine: Engine): SetClipCategoryInverse {
    const clip = engine.getClip(this.#clipId)
    const oldCategory = clip.category
    engine.setClipCategory(this.#clipId, this.#category)
    return { clipId: this.#clipId, oldCategory }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
