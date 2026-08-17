import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'
import { requireFiniteNumber } from '../guards'
import { snapshotOf } from '../keyframe'
import type { KeyframeSnapshot } from '../keyframe'

export interface AddClipKeyframeParameters {
  readonly target: ClipChannelTarget
  readonly time: number
  readonly value: number
}

export interface AddClipKeyframeInverse {
  readonly target: ClipChannelTarget
  readonly keyframe: KeyframeSnapshot
}

export class AddClipKeyframeCommand implements Command<AddClipKeyframeInverse> {
  readonly type = 'AddClipKeyframe'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #time: number
  readonly #value: number

  constructor(input: AddClipKeyframeParameters) {
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
    this.#validateTarget(engine)
    requireFiniteNumber(this.#time, 'Clip keyframe time')
    if (this.#time < 0 || this.#time > 1) {
      throw new Error('Clip keyframe time must be within [0, 1]')
    }
    requireFiniteNumber(this.#value, 'Clip keyframe value')
  }

  execute(engine: Engine): AddClipKeyframeInverse {
    const keyframe = engine.addClipChannelKeyframe(
      this.#target.clipId,
      this.#target.channel,
      this.#time,
      this.#value,
    )
    return { target: this.#target, keyframe: snapshotOf(keyframe) }
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
