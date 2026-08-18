import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import {
  requireKeyframeInterpolation,
  isParametricInterpolation,
  isDiscreteMaterialKind,
} from '../keyframe'
import type { InterpolationType } from '../keyframe'

export interface SetKeyframeInterpolationParameters {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly interpolation: InterpolationType
}

export interface SetKeyframeInterpolationInverse {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly oldInterpolation: InterpolationType
}

export class SetKeyframeInterpolationCommand implements Command<SetKeyframeInterpolationInverse> {
  readonly type = 'SetKeyframeInterpolation'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeId: string
  readonly #interpolation: InterpolationType

  constructor(input: SetKeyframeInterpolationParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#interpolation = input.interpolation
    this.parameters = {
      target: input.target,
      keyframeId: this.#keyframeId,
      interpolation: this.#interpolation,
    }
  }

  validate(engine: Engine): void {
    const resolved = engine.resolveAnimationTarget(this.#target)
    requireKeyframeInterpolation(this.#interpolation)
    if (
      resolved.kind === 'parameter' &&
      resolved.kindOf !== undefined &&
      isDiscreteMaterialKind(resolved.kindOf) &&
      isParametricInterpolation(this.#interpolation)
    ) {
      throw new Error(
        `Parametric interpolation "${this.#interpolation}" is not supported on discrete material kind "${resolved.kindOf}"`,
      )
    }
    this.#requireKeyframe(engine)
  }

  execute(engine: Engine): SetKeyframeInterpolationInverse {
    this.#requireKeyframe(engine)
    const oldInterpolation = engine.setKeyframeInterpolation(
      this.#target,
      this.#keyframeId,
      this.#interpolation,
    )
    return { target: this.#target, keyframeId: this.#keyframeId, oldInterpolation }
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
