import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireKeyframeTangent } from '../keyframe'
import type { KeyframeTangent } from '../keyframe'

export interface SetKeyframeTangentsParameters {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

export interface SetKeyframeTangentsInverse {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly oldTangentIn: KeyframeTangent
  readonly oldTangentOut: KeyframeTangent
}

export class SetKeyframeTangentsCommand implements Command<SetKeyframeTangentsInverse> {
  readonly type = 'SetKeyframeTangents'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeId: string
  readonly #tangentIn: KeyframeTangent
  readonly #tangentOut: KeyframeTangent

  constructor(input: SetKeyframeTangentsParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#tangentIn = input.tangentIn
    this.#tangentOut = input.tangentOut
    this.parameters = {
      target: input.target,
      keyframeId: this.#keyframeId,
      tangentIn: { ...input.tangentIn },
      tangentOut: { ...input.tangentOut },
    }
  }

  validate(engine: Engine): void {
    const resolved = engine.resolveAnimationTarget(this.#target)
    if (resolved.kind === 'visible') {
      throw new Error('Visible track does not support tangents')
    }
    requireKeyframeTangent(this.#tangentIn, 'Keyframe tangent in')
    requireKeyframeTangent(this.#tangentOut, 'Keyframe tangent out')
    this.#requireKeyframe(engine)
  }

  execute(engine: Engine): SetKeyframeTangentsInverse {
    this.#requireKeyframe(engine)
    const old = engine.setKeyframeTangents(
      this.#target,
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
