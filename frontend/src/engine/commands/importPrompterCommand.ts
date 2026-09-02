import type { Engine } from '../internal'
import type { Command } from './command'

export interface ImportPrompterParameters {
  readonly slideId: string
  readonly rawText: string
  readonly mode?: 'replace' | 'append'
  readonly insertIndex?: number
}

export interface ImportPrompterInverse {
  readonly slideId: string
  readonly oldParts: readonly {
    id: string
    text: string
    startTime: number
    endTime: number
    duration: number
  }[]
  readonly newPartIds: readonly string[]
  readonly mode: 'replace' | 'append'
  readonly insertIndex?: number
  readonly deletedClips?: readonly { clip: import('../audioClip').AudioClip; index: number }[]
  readonly shiftedClips?: readonly { id: string; oldTimelineStart: number }[]
}

export class ImportPrompterCommand implements Command<ImportPrompterInverse> {
  readonly type = 'ImportPrompter'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #rawText: string
  readonly #mode: 'replace' | 'append'
  readonly #insertIndex: number | undefined

  constructor(input: ImportPrompterParameters) {
    this.#slideId = input.slideId
    this.#rawText = input.rawText
    this.#mode = input.mode ?? 'replace'
    this.#insertIndex = input.insertIndex
    this.parameters = {
      slideId: input.slideId,
      rawText: input.rawText,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.insertIndex !== undefined ? { insertIndex: input.insertIndex } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    if (typeof this.#rawText !== 'string') throw new Error('ImportPrompter rawText must be a string')
    if (this.#mode !== 'replace' && this.#mode !== 'append') throw new Error('ImportPrompter mode must be replace or append')
    if (this.#insertIndex !== undefined) {
      if (!Number.isInteger(this.#insertIndex) || this.#insertIndex < 0) throw new Error('insertIndex must be a non-negative integer')
      const slide = engine.getSlide(this.#slideId)
      const len = slide.prompter?.parts.length ?? 0
      if (this.#insertIndex > len) throw new Error(`insertIndex out of bounds: ${this.#insertIndex} > ${len}`)
    }
  }

  execute(engine: Engine): ImportPrompterInverse {
    const result = engine.importPrompter(this.#slideId, this.#rawText, {
      mode: this.#mode,
      insertIndex: this.#insertIndex,
    })
    return {
      slideId: this.#slideId,
      oldParts: result.oldParts,
      newPartIds: result.partIds,
      mode: result.mode,
      ...(result.insertIndex !== undefined ? { insertIndex: result.insertIndex } : {}),
      ...(result.deletedClips ? { deletedClips: result.deletedClips } : {}),
      ...(result.shiftedClips ? { shiftedClips: result.shiftedClips } : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
