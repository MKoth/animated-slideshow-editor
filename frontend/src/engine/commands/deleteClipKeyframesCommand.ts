import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import type { KeyframeSnapshot } from '../keyframe'

export interface DeleteClipKeyframesParameters {
  readonly target: ClipChannelTarget
  readonly keyframeIds: readonly string[]
}

export interface DeleteClipKeyframesInverse {
  readonly target: ClipChannelTarget
  readonly keyframes: KeyframeSnapshot[]
}

export class DeleteClipKeyframesCommand implements Command<DeleteClipKeyframesInverse> {
  readonly type = 'DeleteClipKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #keyframeIds: readonly string[]

  constructor(input: DeleteClipKeyframesParameters) {
    this.#target = input.target
    this.#keyframeIds = input.keyframeIds
    this.parameters = { target: input.target, keyframeIds: [...input.keyframeIds] }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
    if (this.#keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
  }

  execute(engine: Engine): DeleteClipKeyframesInverse {
    const removed = engine.deleteClipChannelKeyframes(
      this.#target.clipId,
      this.#target.channel,
      this.#keyframeIds,
    )
    return {
      target: this.#target,
      keyframes: removed.map((kf) => ({
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
