import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface UpdatePrompterPartParameters {
  readonly slideId: string
  readonly partId: string
  readonly text?: string
  readonly duration?: number
  readonly shiftDownstream?: boolean
  readonly ttsLanguage?: 'en' | 'es' | null
  readonly ttsProsody?: import('../cartesiaControls').CartesiaDelivery | null
}

export interface UpdatePrompterPartInverse {
  readonly slideId: string
  readonly partId: string
  readonly oldText: string
  readonly oldDuration: number
  readonly oldStartTime: number
  readonly oldEndTime: number
  readonly oldTtsLanguage?: 'en' | 'es'
  readonly oldTtsProsody?: import('../cartesiaControls').CartesiaDelivery
  readonly shiftedParts: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
  readonly shiftedClips: readonly { id: string; oldTimelineStart: number }[]
}

export class UpdatePrompterPartCommand implements Command<UpdatePrompterPartInverse> {
  readonly type = 'UpdatePrompterPart'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #text: string | undefined
  readonly #duration: number | undefined
  readonly #shiftDownstream: boolean
  readonly #ttsLanguage: 'en' | 'es' | null | undefined
  readonly #ttsProsody: import('../cartesiaControls').CartesiaDelivery | null | undefined

  constructor(input: UpdatePrompterPartParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#text = input.text
    this.#duration = input.duration
    this.#shiftDownstream = input.shiftDownstream ?? false
    this.#ttsLanguage = input.ttsLanguage
    this.#ttsProsody = input.ttsProsody
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.duration !== undefined ? { duration: input.duration } : {}),
      ...(input.shiftDownstream ? { shiftDownstream: true } : {}),
      ...(input.ttsLanguage !== undefined ? { ttsLanguage: input.ttsLanguage } : {}),
      ...(input.ttsProsody !== undefined ? { ttsProsody: input.ttsProsody } : {}),
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((entry) => entry.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (this.#duration !== undefined)
      requireFiniteNumber(this.#duration, 'PrompterPart duration', (v) => v >= 0)
    if (this.#text !== undefined && typeof this.#text !== 'string')
      throw new Error('PrompterPart text must be a string')
    if (
      this.#ttsLanguage !== undefined &&
      this.#ttsLanguage !== null &&
      this.#ttsLanguage !== 'en' &&
      this.#ttsLanguage !== 'es'
    )
      throw new Error('PrompterPart TTS language must be en or es')
  }

  execute(engine: Engine): UpdatePrompterPartInverse {
    return engine.updatePrompterPart(this.#slideId, this.#partId, {
      text: this.#text,
      duration: this.#duration,
      shiftDownstream: this.#shiftDownstream,
      ttsLanguage: this.#ttsLanguage,
      ttsProsody: this.#ttsProsody,
    })
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
