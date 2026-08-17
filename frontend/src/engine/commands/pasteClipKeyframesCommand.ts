import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import type { InterpolationType, KeyframeTangent } from '../keyframe'
import type { KeyframeSnapshot } from '../keyframe'

export interface PasteClipKeyframesParameters {
  readonly target: ClipChannelTarget
  readonly payload: {
    readonly keyframes: readonly {
      readonly time: number
      readonly value: number
      readonly interpolation: InterpolationType
      readonly tangentIn: KeyframeTangent
      readonly tangentOut: KeyframeTangent
    }[]
  }
  readonly atTime: number
}

export interface PasteClipKeyframesInverse {
  readonly target: ClipChannelTarget
  readonly keyframes: KeyframeSnapshot[]
}

export class PasteClipKeyframesCommand implements Command<PasteClipKeyframesInverse> {
  readonly type = 'PasteClipKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #payload: PasteClipKeyframesParameters['payload']
  readonly #atTime: number

  constructor(input: PasteClipKeyframesParameters) {
    this.#target = input.target
    this.#payload = input.payload
    this.#atTime = input.atTime
    this.parameters = {
      target: input.target,
      payload: input.payload,
      atTime: input.atTime,
    }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
    if (this.#payload.keyframes.length === 0) {
      throw new Error('At least one keyframe is required to paste')
    }
  }

  execute(engine: Engine): PasteClipKeyframesInverse {
    const created = engine.pasteClipChannelKeyframes(
      this.#target.clipId,
      this.#target.channel,
      this.#payload,
      this.#atTime,
    )
    return {
      target: this.#target,
      keyframes: created.map((kf) => ({
        keyframeId: kf.id,
        time: kf.time,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: { time: kf.tangentIn.time, value: kf.tangentIn.value },
        tangentOut: { time: kf.tangentOut.time, value: kf.tangentOut.value },
      })),
    }
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
