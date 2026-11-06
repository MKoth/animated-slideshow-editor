import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import { newPrompterPartId } from '../prompter'
import type { CartesiaDelivery } from '../cartesiaControls'

export interface CreatePrompterPartParameters {
  readonly slideId: string
  readonly text: string
  readonly duration: number
  readonly insertIndex?: number
  readonly id?: string
  readonly ttsLanguage?: 'en' | 'es'
  readonly ttsProsody?: CartesiaDelivery
}

export interface CreatePrompterPartInverse {
  readonly slideId: string
  readonly partId: string
}

export class CreatePrompterPartCommand implements Command<CreatePrompterPartInverse> {
  readonly type = 'CreatePrompterPart'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #text: string
  readonly #duration: number
  readonly #insertIndex: number | undefined
  readonly #id: string
  readonly #ttsLanguage: 'en' | 'es' | undefined
  readonly #ttsProsody: CartesiaDelivery | undefined

  constructor(input: CreatePrompterPartParameters) {
    this.#slideId = input.slideId
    this.#text = input.text
    this.#duration = input.duration
    this.#insertIndex = input.insertIndex
    this.#id = input.id ?? newPrompterPartId()
    this.#ttsLanguage = input.ttsLanguage
    this.#ttsProsody = input.ttsProsody
    this.parameters = {
      slideId: input.slideId,
      text: input.text,
      duration: input.duration,
      id: this.#id,
      ...(input.ttsLanguage ? { ttsLanguage: input.ttsLanguage } : {}),
      ...(input.ttsProsody ? { ttsProsody: input.ttsProsody } : {}),
      ...(input.insertIndex !== undefined ? { insertIndex: input.insertIndex } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    if (typeof this.#text !== 'string') throw new Error('PrompterPart text must be a string')
    if (this.#ttsLanguage !== undefined && this.#ttsLanguage !== 'en' && this.#ttsLanguage !== 'es')
      throw new Error('PrompterPart TTS language must be en or es')
    requireFiniteNumber(this.#duration, 'PrompterPart duration', (v) => v >= 0)
    if (
      this.#insertIndex !== undefined &&
      (!Number.isInteger(this.#insertIndex) || this.#insertIndex < 0)
    ) {
      throw new Error('insertIndex must be a non-negative integer')
    }
    const slide = engine.getSlide(this.#slideId)
    const len = slide.prompter?.parts.length ?? 0
    if (this.#insertIndex !== undefined && this.#insertIndex > len) {
      throw new Error(`insertIndex out of bounds: ${this.#insertIndex} > ${len}`)
    }
  }

  execute(engine: Engine): CreatePrompterPartInverse {
    const partId = this.#id
    engine.createPrompterPart(this.#slideId, {
      id: partId,
      text: this.#text,
      duration: this.#duration,
      insertIndex: this.#insertIndex,
      ttsLanguage: this.#ttsLanguage,
      ttsProsody: this.#ttsProsody,
    })
    return { slideId: this.#slideId, partId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
