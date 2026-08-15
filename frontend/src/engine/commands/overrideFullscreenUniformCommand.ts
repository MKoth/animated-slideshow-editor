import type { Engine } from '../internal'
import type { Command } from './command'
import { requireMaterialOverrideValue, requireMaterialParameterKey } from '../guards'
import { requireFullscreenOverridePresent } from '../fullscreenShader'
import type { MaterialOverrideValue } from '../materialInstance'

export interface OverrideFullscreenUniformParameters {
  readonly slideId: string
  readonly uniform: string
  /** The override value, or null to clear the override. */
  readonly value: MaterialOverrideValue | null
}

export interface OverrideFullscreenUniformInverse {
  readonly slideId: string
  readonly uniform: string
  /** The previous override value, or null when there was none. */
  readonly previousValue: MaterialOverrideValue | null
}

export class OverrideFullscreenUniformCommand implements Command<OverrideFullscreenUniformInverse> {
  readonly type = 'OverrideFullscreenUniform'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #uniform: string
  readonly #value: MaterialOverrideValue | null

  constructor(input: OverrideFullscreenUniformParameters) {
    this.#slideId = input.slideId
    this.#uniform = input.uniform
    this.#value = input.value
    this.parameters = {
      slideId: input.slideId,
      uniform: input.uniform,
      value: this.#value,
    }
  }

  validate(engine: Engine): void {
    requireMaterialParameterKey(this.#uniform, 'Fullscreen uniform key')
    if (this.#value !== null) {
      requireMaterialOverrideValue(this.#value, `Fullscreen uniform "${this.#uniform}" value`)
    }
    const slide = engine.getSlide(this.#slideId)
    if (!slide.fullscreenShader) {
      throw new Error(`Slide "${this.#slideId}" has no fullscreen shader assigned`)
    }
    if (this.#value === null) {
      requireFullscreenOverridePresent(slide.fullscreenShader, this.#uniform, this.#slideId)
    }
  }

  execute(engine: Engine): OverrideFullscreenUniformInverse {
    const slide = engine.getSlide(this.#slideId)
    const overrides = slide.fullscreenShader?.overrides ?? {}
    const hadPrevious = Object.prototype.hasOwnProperty.call(overrides, this.#uniform)
    if (this.#value === null) {
      engine.clearFullscreenUniform(this.#slideId, this.#uniform)
    } else {
      engine.overrideFullscreenUniform(this.#slideId, this.#uniform, this.#value)
    }
    return {
      slideId: this.#slideId,
      uniform: this.#uniform,
      previousValue: hadPrevious ? overrides[this.#uniform] : null,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
