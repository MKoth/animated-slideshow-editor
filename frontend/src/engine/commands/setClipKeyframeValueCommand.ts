import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import { requireFiniteNumber } from '../guards'

export interface SetClipKeyframeValueParameters {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly newValue: number
}

export interface SetClipKeyframeValueInverse {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly oldValue: number
}

export class SetClipKeyframeValueCommand implements Command<SetClipKeyframeValueInverse> {
  readonly type = 'SetClipKeyframeValue'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #keyframeId: string
  readonly #newValue: number

  constructor(input: SetClipKeyframeValueParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#newValue = input.newValue
    this.parameters = {
      target: input.target,
      keyframeId: input.keyframeId,
      newValue: input.newValue,
    }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
    requireFiniteNumber(this.#newValue, 'Clip keyframe value')
  }

  execute(engine: Engine): SetClipKeyframeValueInverse {
    const oldValue = engine.setClipChannelKeyframeValue(
      this.#target.clipId,
      this.#target.channel,
      this.#keyframeId,
      this.#newValue,
    )
    return { target: this.#target, keyframeId: this.#keyframeId, oldValue }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }

  #validateTarget(engine: Engine): void {
    const clip = engine.getClip(this.#target.clipId)
    if (!clip.hasChannel(this.#target.channel)) {
      throw new Error(`Clip channel not found: ${this.#target.channel}`)
    }
  }
}
