import type { Engine } from '../internal'
import type { Command } from './command'

export interface MovePrompterPartParameters {
  readonly slideId: string
  readonly partId: string
  // Free placement like audio clips: arbitrary startTime, gaps allowed, may be >0 for leading gap
  readonly newStartTime: number
  // Legacy newIndex still accepted for reorder-only callers
  readonly newIndex?: number
}

export interface MovePrompterPartInverse {
  readonly slideId: string
  readonly partId: string
  readonly oldStartTime: number
  readonly oldEndTime: number
}

export class MovePrompterPartCommand implements Command<MovePrompterPartInverse> {
  readonly type = 'MovePrompterPart'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #newStartTime: number | undefined
  readonly #newIndex: number | undefined

  constructor(input: MovePrompterPartParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#newStartTime = input.newStartTime
    this.#newIndex = input.newIndex
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      ...(input.newStartTime !== undefined ? { newStartTime: input.newStartTime } : {}),
      ...(input.newIndex !== undefined ? { newIndex: input.newIndex } : {}),
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    if (!slide.prompter) throw new Error(`Slide "${this.#slideId}" has no prompter`)
    const part = slide.prompter.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (this.#newStartTime !== undefined) {
      if (typeof this.#newStartTime !== 'number' || !Number.isFinite(this.#newStartTime) || this.#newStartTime < 0) {
        throw new Error('newStartTime must be a non-negative finite number')
      }
    } else if (this.#newIndex !== undefined) {
      if (!Number.isInteger(this.#newIndex) || this.#newIndex < 0 || this.#newIndex >= slide.prompter.parts.length) {
        throw new Error(`newIndex out of bounds: ${this.#newIndex}`)
      }
    } else {
      throw new Error('MovePrompterPart requires newStartTime or newIndex')
    }
  }

  execute(engine: Engine): MovePrompterPartInverse {
    if (this.#newStartTime !== undefined) {
      const { oldStartTime, oldEndTime } = engine.movePrompterPartToTime(this.#slideId, this.#partId, this.#newStartTime)
      return { slideId: this.#slideId, partId: this.#partId, oldStartTime, oldEndTime }
    }
    const oldIndex = engine.movePrompterPart(this.#slideId, this.#partId, this.#newIndex!)
    // For legacy, fabricate oldStartTime from index (approx)
    const part = engine.getSlide(this.#slideId).prompter!.parts.find((p) => p.id === this.#partId)!
    return { slideId: this.#slideId, partId: this.#partId, oldStartTime: part.startTime, oldEndTime: part.endTime, oldIndex } as unknown as MovePrompterPartInverse
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
