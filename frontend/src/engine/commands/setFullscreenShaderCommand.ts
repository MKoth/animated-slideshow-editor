import type { Engine } from '../internal'
import type { Command } from './command'
import { fullscreenShaderToJSON } from '../fullscreenShader'
import type { FullscreenShaderReference } from '../fullscreenShader'

export interface SetFullscreenShaderParameters {
  readonly slideId: string
  readonly shaderDefinitionId: string | null
}

export interface SetFullscreenShaderInverse {
  readonly slideId: string
  readonly previous: FullscreenShaderReference | null
}

export class SetFullscreenShaderCommand implements Command<SetFullscreenShaderInverse> {
  readonly type = 'SetFullscreenShader'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #shaderDefinitionId: string | null

  constructor(input: SetFullscreenShaderParameters) {
    this.#slideId = input.slideId
    this.#shaderDefinitionId = input.shaderDefinitionId
    this.parameters = {
      slideId: input.slideId,
      shaderDefinitionId: input.shaderDefinitionId,
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    if (this.#shaderDefinitionId !== null) {
      engine.getShaderDefinition(this.#shaderDefinitionId)
    }
  }

  execute(engine: Engine): SetFullscreenShaderInverse {
    const slide = engine.getSlide(this.#slideId)
    const inverse: SetFullscreenShaderInverse = {
      slideId: this.#slideId,
      previous: slide.fullscreenShader ? fullscreenShaderToJSON(slide.fullscreenShader) : null,
    }
    engine.setFullscreenShader(this.#slideId, this.#shaderDefinitionId)
    return inverse
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
