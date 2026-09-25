import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireNodeTarget, requireTrackKeyframeValue } from '../keyframeTarget'
import { requireKeyframeTime } from '../animationProperties'
import { requireKeyframeInterpolation, requireKeyframeTangent, snapshotOf } from '../keyframe'
import type { InterpolationType, KeyframeSnapshot, KeyframeTangent } from '../keyframe'

export interface AddKeyframeParameters {
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: unknown
  /** Optional explicit ease; defaults to the previous keyframe's interpolation. */
  readonly interpolation?: InterpolationType
  readonly tangentIn?: KeyframeTangent
  readonly tangentOut?: KeyframeTangent
}

export interface AddKeyframeInverse {
  readonly target: KeyframeTarget
  readonly keyframe: KeyframeSnapshot
}

export class AddKeyframeCommand implements Command<AddKeyframeInverse> {
  readonly type = 'AddKeyframe'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #time: number
  readonly #value: unknown
  readonly #interpolation?: InterpolationType
  readonly #tangentIn?: KeyframeTangent
  readonly #tangentOut?: KeyframeTangent

  constructor(input: AddKeyframeParameters) {
    this.#target = input.target
    this.#time = input.time
    this.#value = input.value
    this.#interpolation = input.interpolation
    this.#tangentIn = input.tangentIn
    this.#tangentOut = input.tangentOut
    this.parameters = {
      target: input.target,
      time: this.#time,
      value: this.#value,
      ...(input.interpolation !== undefined ? { interpolation: input.interpolation } : {}),
      ...(input.tangentIn !== undefined ? { tangentIn: { ...input.tangentIn } } : {}),
      ...(input.tangentOut !== undefined ? { tangentOut: { ...input.tangentOut } } : {}),
    }
  }

  validate(engine: Engine): void {
    const nodeTarget = requireNodeTarget(this.#target)
    const track = engine.resolveAnimationTarget(this.#target)
    const slide = engine.getSlideOfNode(nodeTarget.nodeId)
    requireKeyframeTime(this.#time, slide.duration)
    requireTrackKeyframeValue(track, this.#value)
    if (this.#interpolation !== undefined) {
      requireKeyframeInterpolation(this.#interpolation)
    }
    const hasTangents = this.#tangentIn !== undefined || this.#tangentOut !== undefined
    if (hasTangents && (this.#tangentIn === undefined || this.#tangentOut === undefined)) {
      throw new Error('Keyframe tangents must be provided together')
    }
    if (this.#tangentIn !== undefined) {
      requireKeyframeTangent(this.#tangentIn, 'Keyframe tangent in')
    }
    if (this.#tangentOut !== undefined) {
      requireKeyframeTangent(this.#tangentOut, 'Keyframe tangent out')
    }
  }

  execute(engine: Engine): AddKeyframeInverse {
    const keyframe = engine.addKeyframe(this.#target, this.#time, this.#value, {
      ...(this.#interpolation !== undefined ? { interpolation: this.#interpolation } : {}),
      ...(this.#tangentIn !== undefined ? { tangentIn: this.#tangentIn } : {}),
      ...(this.#tangentOut !== undefined ? { tangentOut: this.#tangentOut } : {}),
    })
    return { target: this.#target, keyframe: snapshotOf(keyframe) }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
