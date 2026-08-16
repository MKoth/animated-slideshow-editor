import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireScaleFactor } from '../keyframeTarget'
import { requireKeyframeTime } from '../animationProperties'
import type { KeyframeMoveResult } from '../animationManager'

export interface ScaleKeyframesParameters {
  readonly target: KeyframeTarget
  readonly keyframeIds: readonly string[]
  readonly pivot: number
  readonly factor: number
}

export interface ScaleKeyframesInverse {
  readonly target: KeyframeTarget
  readonly moves: readonly KeyframeMoveResult[]
}

export class ScaleKeyframesCommand implements Command<ScaleKeyframesInverse> {
  readonly type = 'ScaleKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeIds: readonly string[]
  readonly #pivot: number
  readonly #factor: number

  constructor(input: ScaleKeyframesParameters) {
    this.#target = input.target
    this.#keyframeIds = input.keyframeIds
    this.#pivot = input.pivot
    this.#factor = input.factor
    this.parameters = {
      target: input.target,
      keyframeIds: [...input.keyframeIds],
      pivot: this.#pivot,
      factor: this.#factor,
    }
  }

  validate(engine: Engine): void {
    if (this.#keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    engine.resolveAnimationTarget(this.#target)
    const slide = engine.getSlideOfNode(this.#target.nodeId)
    requireScaleFactor(this.#factor)
    requireKeyframeTime(this.#pivot, slide.duration, 'Scale pivot')
    const keyframes = engine.getKeyframesOf(this.#target)
    const keyframeOf = new Map(keyframes.map((keyframe) => [keyframe.id, keyframe]))
    for (const keyframeId of this.#keyframeIds) {
      const keyframe = keyframeOf.get(keyframeId)
      if (!keyframe) {
        throw new Error(`Keyframe not found: ${keyframeId}`)
      }
      requireKeyframeTime(
        this.#pivot + (keyframe.time - this.#pivot) * this.#factor,
        slide.duration,
      )
    }
  }

  execute(engine: Engine): ScaleKeyframesInverse {
    const moves = engine.scaleKeyframes(this.#target, this.#keyframeIds, this.#pivot, this.#factor)
    return { target: this.#target, moves }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
