import type { Engine } from '../internal'
import type { Command } from './command'

export interface MovePrompterPartParameters {
  readonly slideId: string
  readonly partId: string
  readonly newIndex: number
}

export interface MovePrompterPartInverse {
  readonly slideId: string
  readonly partId: string
  readonly oldIndex: number
}

export class MovePrompterPartCommand implements Command<MovePrompterPartInverse> {
  readonly type = 'MovePrompterPart'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #newIndex: number

  constructor(input: MovePrompterPartParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#newIndex = input.newIndex
    this.parameters = { slideId: input.slideId, partId: input.partId, newIndex: input.newIndex }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    if (!slide.prompter) throw new Error(`Slide "${this.#slideId}" has no prompter`)
    const idx = slide.prompter.parts.findIndex((p) => p.id === this.#partId)
    if (idx === -1) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (!Number.isInteger(this.#newIndex) || this.#newIndex < 0 || this.#newIndex >= slide.prompter.parts.length) {
      throw new Error(`newIndex out of bounds: ${this.#newIndex}`)
    }
  }

  execute(engine: Engine): MovePrompterPartInverse {
    const oldIndex = engine.movePrompterPart(this.#slideId, this.#partId, this.#newIndex)
    return { slideId: this.#slideId, partId: this.#partId, oldIndex }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
