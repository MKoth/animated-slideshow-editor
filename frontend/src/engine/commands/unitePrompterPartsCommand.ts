import type { Engine } from '../internal'
import type { Command } from './command'

export interface UnitePrompterPartsParameters {
  readonly slideId: string
  readonly leftPartId: string
  readonly rightPartId?: string
}

export interface UnitePrompterPartsInverse {
  readonly slideId: string
  readonly mergedId: string
  readonly oldParts: readonly {
    id: string
    text: string
    duration: number
    startTime: number
    endTime: number
  }[]
  readonly rightPartId: string
}

export class UnitePrompterPartsCommand implements Command<UnitePrompterPartsInverse> {
  readonly type = 'UnitePrompterParts'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #leftPartId: string
  readonly #rightPartId: string | undefined

  constructor(input: UnitePrompterPartsParameters) {
    this.#slideId = input.slideId
    this.#leftPartId = input.leftPartId
    this.#rightPartId = input.rightPartId
    this.parameters = {
      slideId: input.slideId,
      leftPartId: input.leftPartId,
      ...(input.rightPartId !== undefined ? { rightPartId: input.rightPartId } : {}),
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    if (!slide.prompter) throw new Error(`Slide "${this.#slideId}" has no prompter`)
    const leftIndex = slide.prompter.parts.findIndex((p) => p.id === this.#leftPartId)
    if (leftIndex === -1) throw new Error(`PrompterPart not found: ${this.#leftPartId}`)
    let rightIndex: number
    if (this.#rightPartId !== undefined) {
      rightIndex = slide.prompter.parts.findIndex((p) => p.id === this.#rightPartId)
      if (rightIndex === -1) throw new Error(`PrompterPart not found: ${this.#rightPartId}`)
      if (rightIndex !== leftIndex + 1) throw new Error('PrompterParts to unite must be adjacent')
    } else {
      rightIndex = leftIndex + 1
      if (rightIndex >= slide.prompter.parts.length) throw new Error('No next part to unite')
    }
  }

  execute(engine: Engine): UnitePrompterPartsInverse {
    const slideBefore = engine.getSlide(this.#slideId)
    const leftIndex = slideBefore.prompter!.parts.findIndex((p) => p.id === this.#leftPartId)
    const rightId = this.#rightPartId ?? slideBefore.prompter!.parts[leftIndex + 1].id
    const result = engine.unitePrompterParts(this.#slideId, this.#leftPartId, this.#rightPartId)
    return {
      slideId: this.#slideId,
      mergedId: result.mergedId,
      oldParts: result.oldParts,
      rightPartId: rightId,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

export class MergePrompterPartsCommand implements Command<UnitePrompterPartsInverse> {
  readonly type = 'MergePrompterParts'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #delegate: UnitePrompterPartsCommand
  constructor(input: UnitePrompterPartsParameters) {
    this.#delegate = new UnitePrompterPartsCommand(input)
    this.parameters = this.#delegate.parameters
  }
  validate(engine: Engine): void {
    return this.#delegate.validate(engine)
  }
  execute(engine: Engine): UnitePrompterPartsInverse {
    return this.#delegate.execute(engine)
  }
  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
