import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import { requireFiniteNumber } from '../guards'
import { requireScaleFactor } from '../keyframeTarget'

export interface ScaleClipKeyframesParameters {
  readonly target: ClipChannelTarget
  readonly keyframeIds: readonly string[]
  readonly pivot: number
  readonly factor: number
}

export interface ScaleClipKeyframesInverse {
  readonly target: ClipChannelTarget
  readonly moves: readonly { readonly keyframeId: string; readonly oldTime: number }[]
}

export class ScaleClipKeyframesCommand implements Command<ScaleClipKeyframesInverse> {
  readonly type = 'ScaleClipKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #keyframeIds: readonly string[]
  readonly #pivot: number
  readonly #factor: number

  constructor(input: ScaleClipKeyframesParameters) {
    this.#target = input.target
    this.#keyframeIds = input.keyframeIds
    this.#pivot = input.pivot
    this.#factor = input.factor
    this.parameters = {
      target: input.target,
      keyframeIds: [...input.keyframeIds],
      pivot: input.pivot,
      factor: input.factor,
    }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
    if (this.#keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    requireFiniteNumber(this.#pivot, 'Scale pivot')
    if (this.#pivot < 0 || this.#pivot > 1) {
      throw new Error('Scale pivot must be within [0, 1]')
    }
    requireScaleFactor(this.#factor)
  }

  execute(engine: Engine): ScaleClipKeyframesInverse {
    const result = engine.scaleClipChannelKeyframes(
      this.#target.clipId,
      this.#target.channel,
      this.#keyframeIds,
      this.#pivot,
      this.#factor,
    )
    return { target: this.#target, moves: result }
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
