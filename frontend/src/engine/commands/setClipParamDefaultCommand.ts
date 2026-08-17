import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetClipParamDefaultParameters {
  readonly clipId: string
  readonly paramKey: string
  readonly defaultValue: number
}

export interface SetClipParamDefaultInverse {
  readonly clipId: string
  readonly paramKey: string
  readonly oldValue: number
}

export class SetClipParamDefaultCommand implements Command<SetClipParamDefaultInverse> {
  readonly type = 'SetClipParamDefault'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #paramKey: string
  readonly #defaultValue: number

  constructor(input: SetClipParamDefaultParameters) {
    this.#clipId = input.clipId
    this.#paramKey = input.paramKey
    this.#defaultValue = input.defaultValue
    this.parameters = {
      clipId: input.clipId,
      paramKey: input.paramKey,
      defaultValue: input.defaultValue,
    }
  }

  validate(engine: Engine): void {
    const clip = engine.getClip(this.#clipId)
    const param = clip.getParam(this.#paramKey)
    if (!param) {
      throw new Error(`Clip param not found: ${this.#paramKey}`)
    }
    requireFiniteNumber(this.#defaultValue, 'Clip param default')
  }

  execute(engine: Engine): SetClipParamDefaultInverse {
    const clip = engine.getClip(this.#clipId)
    const param = clip.getParam(this.#paramKey)!
    const oldValue = param.default
    engine.setClipParamDefault(this.#clipId, this.#paramKey, this.#defaultValue)
    return { clipId: this.#clipId, paramKey: this.#paramKey, oldValue }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
