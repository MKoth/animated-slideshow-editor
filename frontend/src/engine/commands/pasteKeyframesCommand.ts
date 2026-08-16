import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireTrackKeyframeValue } from '../keyframeTarget'
import { requireKeyframeTime } from '../animationProperties'
import { requireFiniteNumber } from '../guards'
import { requireKeyframeInterpolation, requireKeyframeTangent } from '../keyframe'
import { snapshotOf } from '../keyframe'
import type { KeyframeSnapshot } from '../keyframe'
import type { PastePayload } from '../animationManager'

export interface PasteKeyframesParameters {
  readonly target: KeyframeTarget
  readonly payload: PastePayload
  readonly atTime: number
}

export interface PasteKeyframesInverse {
  readonly target: KeyframeTarget
  readonly keyframes: readonly KeyframeSnapshot[]
}

export class PasteKeyframesCommand implements Command<PasteKeyframesInverse> {
  readonly type = 'PasteKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #payload: PastePayload
  readonly #atTime: number

  constructor(input: PasteKeyframesParameters) {
    this.#target = input.target
    this.#payload = input.payload
    this.#atTime = input.atTime
    this.parameters = {
      target: input.target,
      payload: {
        keyframes: input.payload.keyframes.map((keyframe) => ({ ...keyframe })),
      },
      atTime: this.#atTime,
    }
  }

  validate(engine: Engine): void {
    const track = engine.resolveAnimationTarget(this.#target)
    const slide = engine.getSlideOfNode(this.#target.nodeId)
    requireKeyframeTime(this.#atTime, slide.duration, 'Paste time')
    if (this.#payload.keyframes.length === 0) {
      throw new Error('At least one keyframe is required to paste')
    }
    for (const keyframe of this.#payload.keyframes) {
      requireFiniteNumber(
        keyframe.time,
        'Paste payload time',
        (value) => value >= 0,
        'a non-negative finite number',
      )
      requireTrackKeyframeValue(track, keyframe.value)
      requireKeyframeInterpolation(keyframe.interpolation)
      requireKeyframeTangent(keyframe.tangentIn, 'Keyframe tangent in')
      requireKeyframeTangent(keyframe.tangentOut, 'Keyframe tangent out')
    }
  }

  execute(engine: Engine): PasteKeyframesInverse {
    const created = engine.pasteKeyframes(this.#target, this.#payload, this.#atTime)
    return { target: this.#target, keyframes: created.map(snapshotOf) }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
