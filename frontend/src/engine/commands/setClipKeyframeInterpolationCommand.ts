import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import type { InterpolationType } from '../keyframe'
import { requireKeyframeInterpolation } from '../keyframe'

export interface SetClipKeyframeInterpolationParameters {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly interpolation: InterpolationType
}

export interface SetClipKeyframeInterpolationInverse {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly oldInterpolation: InterpolationType
}

export class SetClipKeyframeInterpolationCommand implements Command<SetClipKeyframeInterpolationInverse> {
  readonly type = 'SetClipKeyframeInterpolation'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #keyframeId: string
  readonly #interpolation: InterpolationType

  constructor(input: SetClipKeyframeInterpolationParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#interpolation = input.interpolation
    this.parameters = {
      target: input.target,
      keyframeId: input.keyframeId,
      interpolation: input.interpolation,
    }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
    requireKeyframeInterpolation(this.#interpolation)
  }

  execute(engine: Engine): SetClipKeyframeInterpolationInverse {
    const oldInterpolation = engine.setClipChannelKeyframeInterpolation(
      this.#target.clipId,
      this.#target.channel,
      this.#keyframeId,
      this.#interpolation,
    )
    return { target: this.#target, keyframeId: this.#keyframeId, oldInterpolation }
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
