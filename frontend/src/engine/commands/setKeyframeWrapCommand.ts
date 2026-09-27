import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'

export interface SetKeyframeWrapParameters {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly wrap: boolean
}

export interface SetKeyframeWrapInverse {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly oldWrap: boolean
}

export class SetKeyframeWrapCommand implements Command<SetKeyframeWrapInverse> {
  readonly type = 'SetKeyframeWrap'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeId: string
  readonly #wrap: boolean

  constructor(input: SetKeyframeWrapParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#wrap = input.wrap
    this.parameters = {
      target: input.target,
      keyframeId: this.#keyframeId,
      wrap: this.#wrap,
    }
  }

  validate(engine: Engine): void {
    if (typeof this.#wrap !== 'boolean') {
      throw new Error('Keyframe wrap must be a boolean')
    }
    this.#requireKeyframe(engine)
  }

  execute(engine: Engine): SetKeyframeWrapInverse {
    this.#requireKeyframe(engine)
    const oldWrap = engine.setKeyframeWrap(this.#target, this.#keyframeId, this.#wrap)
    return { target: this.#target, keyframeId: this.#keyframeId, oldWrap }
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
