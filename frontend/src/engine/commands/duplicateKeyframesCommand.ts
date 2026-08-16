import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { snapshotOf } from '../keyframe'
import type { KeyframeSnapshot } from '../keyframe'

export interface DuplicateKeyframesParameters {
  readonly target: KeyframeTarget
  readonly keyframeIds: readonly string[]
}

export interface DuplicateKeyframesInverse {
  readonly target: KeyframeTarget
  readonly keyframes: readonly KeyframeSnapshot[]
}

export class DuplicateKeyframesCommand implements Command<DuplicateKeyframesInverse> {
  readonly type = 'DuplicateKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeIds: readonly string[]

  constructor(input: DuplicateKeyframesParameters) {
    this.#target = input.target
    this.#keyframeIds = input.keyframeIds
    this.parameters = {
      target: input.target,
      keyframeIds: [...input.keyframeIds],
    }
  }

  validate(engine: Engine): void {
    engine.resolveAnimationTarget(this.#target)
    const existing = new Set(engine.getKeyframesOf(this.#target).map((keyframe) => keyframe.id))
    for (const keyframeId of this.#keyframeIds) {
      if (!existing.has(keyframeId)) {
        throw new Error(`Keyframe not found: ${keyframeId}`)
      }
    }
  }

  execute(engine: Engine): DuplicateKeyframesInverse {
    const created = engine.duplicateKeyframes(this.#target, this.#keyframeIds)
    return { target: this.#target, keyframes: created.map(snapshotOf) }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
