import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'

export interface SetKeyframeDisabledParameters {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly disabled: boolean
}

export interface SetKeyframeDisabledInverse {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly oldDisabled: boolean
}

export class SetKeyframeDisabledCommand implements Command<SetKeyframeDisabledInverse> {
  readonly type = 'SetKeyframeDisabled'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeId: string
  readonly #disabled: boolean

  constructor(input: SetKeyframeDisabledParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#disabled = input.disabled
    this.parameters = {
      target: input.target,
      keyframeId: this.#keyframeId,
      disabled: this.#disabled,
    }
  }

  validate(engine: Engine): void {
    if (typeof this.#disabled !== 'boolean') {
      throw new Error('Keyframe disabled must be a boolean')
    }
    this.#requireKeyframe(engine)
  }

  execute(engine: Engine): SetKeyframeDisabledInverse {
    this.#requireKeyframe(engine)
    const oldDisabled = engine.setKeyframeDisabled(this.#target, this.#keyframeId, this.#disabled)
    return { target: this.#target, keyframeId: this.#keyframeId, oldDisabled }
  }

  #requireKeyframe(engine: Engine): void {
    const exists = engine
      .getKeyframesOf(this.#target)
      .some((keyframe) => keyframe.id === this.#keyframeId)
    if (!exists) {
      throw new Error(`Keyframe not found: ${this.#keyframeId}`)
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
