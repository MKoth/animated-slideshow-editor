import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import type { KeyframeTangent } from '../keyframe'

export interface SetClipKeyframeTangentsParameters {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

export interface SetClipKeyframeTangentsInverse {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly oldTangentIn: KeyframeTangent
  readonly oldTangentOut: KeyframeTangent
}

export class SetClipKeyframeTangentsCommand implements Command<SetClipKeyframeTangentsInverse> {
  readonly type = 'SetClipKeyframeTangents'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #keyframeId: string
  readonly #tangentIn: KeyframeTangent
  readonly #tangentOut: KeyframeTangent

  constructor(input: SetClipKeyframeTangentsParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#tangentIn = input.tangentIn
    this.#tangentOut = input.tangentOut
    this.parameters = {
      target: input.target,
      keyframeId: input.keyframeId,
      tangentIn: input.tangentIn,
      tangentOut: input.tangentOut,
    }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
  }

  execute(engine: Engine): SetClipKeyframeTangentsInverse {
    const old = engine.setClipChannelKeyframeTangents(
      this.#target.clipId,
      this.#target.channel,
      this.#keyframeId,
      this.#tangentIn,
      this.#tangentOut,
    )
    return {
      target: this.#target,
      keyframeId: this.#keyframeId,
      oldTangentIn: old.tangentIn,
      oldTangentOut: old.tangentOut,
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
