import type { Engine } from '../internal'
import type { Command } from './command'
import type { AudioClip } from '../audioClip'
import type { PrompterPart } from '../prompter'

export interface DeletePrompterPartParameters {
  readonly slideId: string
  readonly partId: string
}

export interface DeletePrompterPartInverse {
  readonly slideId: string
  readonly deletedPart: PrompterPart
  readonly deletedIndex: number
  readonly deletedClips: readonly { clip: AudioClip; index: number }[]
  readonly shiftedParts: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
  readonly shiftedClips: readonly { id: string; oldTimelineStart: number }[]
}

export class DeletePrompterPartCommand implements Command<DeletePrompterPartInverse> {
  readonly type = 'DeletePrompterPart'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string

  constructor(input: DeletePrompterPartParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.parameters = { slideId: input.slideId, partId: input.partId }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    if (!slide.prompter) throw new Error(`Slide "${this.#slideId}" has no prompter`)
    const part = slide.prompter.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
  }

  execute(engine: Engine): DeletePrompterPartInverse {
    const result = engine.deletePrompterPart(this.#slideId, this.#partId)
    return {
      slideId: this.#slideId,
      deletedPart: result.deletedPart,
      deletedIndex: result.deletedIndex,
      deletedClips: result.deletedClips,
      shiftedParts: result.shiftedParts,
      shiftedClips: result.shiftedClips,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
