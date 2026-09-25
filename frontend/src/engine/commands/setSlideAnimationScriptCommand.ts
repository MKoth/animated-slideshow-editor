import type { Engine } from '../internal'
import type { Command } from './command'
import { requireStringAllowEmpty } from '../guards'

export interface SetSlideAnimationScriptParameters {
  readonly slideId: string
  readonly source: string
}

export interface SetSlideAnimationScriptInverse {
  readonly slideId: string
  readonly previousSource: string | null
}

export class SetSlideAnimationScriptCommand implements Command<SetSlideAnimationScriptInverse> {
  readonly type = 'SetSlideAnimationScript'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #source: string

  constructor(input: SetSlideAnimationScriptParameters) {
    this.#slideId = input.slideId
    this.#source = input.source
    this.parameters = { slideId: input.slideId, source: input.source }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    requireStringAllowEmpty(this.#source, 'Animation Script source')
  }

  execute(engine: Engine): SetSlideAnimationScriptInverse {
    const slide = engine.getSlide(this.#slideId)
    const previousSource = slide.animationScript?.source ?? null
    engine.setSlideAnimationScriptSource(this.#slideId, this.#source)
    return { slideId: this.#slideId, previousSource }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
