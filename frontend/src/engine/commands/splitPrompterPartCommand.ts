import type { Engine } from '../internal'
import type { Command } from './command'

export type SplitPrompterMode = 'left' | 'right' | 'out'

export interface SplitPrompterPartParameters {
  readonly slideId: string
  readonly partId: string
  readonly wordIndex: number
  readonly mode: SplitPrompterMode
}

export interface SplitPrompterPartInverse {
  readonly slideId: string
  readonly partId: string
  readonly oldText: string
  readonly oldDuration: number
  readonly oldStartTime: number
  readonly oldEndTime: number
  readonly newPartIds: readonly string[]
  readonly createdPartIds: readonly string[]
}

export class SplitPrompterPartCommand implements Command<SplitPrompterPartInverse> {
  readonly type = 'SplitPrompterPart'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #wordIndex: number
  readonly #mode: SplitPrompterMode

  constructor(input: SplitPrompterPartParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#wordIndex = input.wordIndex
    this.#mode = input.mode
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      wordIndex: input.wordIndex,
      mode: input.mode,
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (!Number.isInteger(this.#wordIndex) || this.#wordIndex < 0) {
      throw new Error('wordIndex must be a non-negative integer')
    }
    if (!['left', 'right', 'out'].includes(this.#mode)) {
      throw new Error('mode must be left, right, or out')
    }
    const words = part.text.trim() === '' ? [] : (part.text.match(/\S+/g) ?? [])
    if (this.#wordIndex >= words.length) {
      throw new Error(`wordIndex out of bounds: ${this.#wordIndex} >= ${words.length}`)
    }
  }

  execute(engine: Engine): SplitPrompterPartInverse {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter!.parts.find((p) => p.id === this.#partId)!
    const oldText = part.text
    const oldDuration = part.duration
    const oldStartTime = part.startTime
    const oldEndTime = part.endTime
    const result = engine.splitPrompterPart(
      this.#slideId,
      this.#partId,
      this.#wordIndex,
      this.#mode,
    )
    const created = result.newPartIds.filter((id) => id !== this.#partId)
    return {
      slideId: this.#slideId,
      partId: this.#partId,
      oldText,
      oldDuration,
      oldStartTime,
      oldEndTime,
      newPartIds: result.newPartIds,
      createdPartIds: created,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
