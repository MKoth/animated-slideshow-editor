import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireTrackKeyframeValue } from '../keyframeTarget'
import { requireKeyframeTime } from '../animationProperties'
import { snapshotOf } from '../keyframe'
import type { KeyframeSnapshot } from '../keyframe'

export interface AddKeyframeParameters {
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: unknown
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

  constructor(input: AddKeyframeParameters) {
    this.#target = input.target
    this.#time = input.time
    this.#value = input.value
    this.parameters = {
      target: input.target,
      time: this.#time,
      value: this.#value,
    }
  }

  validate(engine: Engine): void {
    const track = engine.resolveAnimationTarget(this.#target)
    const slide = engine.getSlideOfNode(this.#target.nodeId)
    requireKeyframeTime(this.#time, slide.duration)
    requireTrackKeyframeValue(track, this.#value)
  }

  execute(engine: Engine): AddKeyframeInverse {
    const keyframe = engine.addKeyframe(this.#target, this.#time, this.#value)
    return { target: this.#target, keyframe: snapshotOf(keyframe) }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
