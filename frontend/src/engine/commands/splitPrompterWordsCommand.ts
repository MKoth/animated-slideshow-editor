import type { Engine } from '../internal'
import type { Command } from './command'
import type { AudioClip } from '../audioClip'
import type { PrompterPart } from '../prompter'

export interface SplitPrompterWordsParameters {
  readonly slideId: string
  readonly partId: string
  readonly startWordIndex: number
  readonly endWordIndex: number
}

export interface SplitPrompterWordsInverse {
  readonly oldPart: PrompterPart
  readonly oldClip?: AudioClip
  readonly oldIndex: number
  readonly newPartIds: readonly string[]
  readonly deletedClipId?: string
}

export class SplitPrompterWordsCommand implements Command<SplitPrompterWordsInverse> {
  readonly type = 'SplitPrompterWords'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #startWordIndex: number
  readonly #endWordIndex: number

  constructor(input: SplitPrompterWordsParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#startWordIndex = input.startWordIndex
    this.#endWordIndex = input.endWordIndex
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      startWordIndex: input.startWordIndex,
      endWordIndex: input.endWordIndex,
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (!Number.isInteger(this.#startWordIndex) || this.#startWordIndex < 0)
      throw new Error('startWordIndex must be a non-negative integer')
    if (!Number.isInteger(this.#endWordIndex) || this.#endWordIndex < 0)
      throw new Error('endWordIndex must be a non-negative integer')
    if (this.#endWordIndex < this.#startWordIndex)
      throw new Error('endWordIndex must be >= startWordIndex')
    const words = part.text.match(/\S+/g) ?? []
    if (this.#startWordIndex >= words.length)
      throw new Error(`startWordIndex out of bounds: ${this.#startWordIndex} >= ${words.length}`)
    if (this.#endWordIndex >= words.length)
      throw new Error(`endWordIndex out of bounds: ${this.#endWordIndex} >= ${words.length}`)
  }

  execute(engine: Engine): SplitPrompterWordsInverse {
    const result = engine.splitPrompterPartByWordRange(
      this.#slideId,
      this.#partId,
      this.#startWordIndex,
      this.#endWordIndex,
    )
    return {
      oldPart: result.oldPart,
      ...(result.oldClip ? { oldClip: result.oldClip } : {}),
      oldIndex: result.oldIndex,
      newPartIds: result.newPartIds,
      ...(result.deletedClipId ? { deletedClipId: result.deletedClipId } : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
