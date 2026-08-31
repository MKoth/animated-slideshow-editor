import type { Engine } from '../internal'
import type { Command } from './command'

export interface ImportPrompterParameters {
  readonly slideId: string
  readonly rawText: string
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
}

export class ImportPrompterCommand implements Command<ImportPrompterInverse> {
  readonly type = 'ImportPrompter'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #rawText: string

  constructor(input: ImportPrompterParameters) {
    this.#slideId = input.slideId
    this.#rawText = input.rawText
    this.parameters = { slideId: input.slideId, rawText: input.rawText }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    if (typeof this.#rawText !== 'string')
      throw new Error('ImportPrompter rawText must be a string')
  }

  execute(engine: Engine): ImportPrompterInverse {
    const result = engine.importPrompter(this.#slideId, this.#rawText)
    return { slideId: this.#slideId, oldParts: result.oldParts, newPartIds: result.partIds }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
