import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { snapshotOf } from '../keyframe'
import type { KeyframeSnapshot } from '../keyframe'

export interface DeleteKeyframesParameters {
  readonly target: KeyframeTarget
  readonly keyframeIds: readonly string[]
}

export interface DeleteKeyframesInverse {
  readonly target: KeyframeTarget
  readonly keyframes: readonly KeyframeSnapshot[]
}

export class DeleteKeyframesCommand implements Command<DeleteKeyframesInverse> {
  readonly type = 'DeleteKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeIds: readonly string[]

  constructor(input: DeleteKeyframesParameters) {
    this.#target = input.target
    this.#keyframeIds = input.keyframeIds
    this.parameters = {
      target: input.target,
      keyframeIds: [...input.keyframeIds],
    }
  }

  validate(engine: Engine): void {
    engine.resolveAnimationTarget(this.#target)
    this.#requireIds(engine)
  }

  execute(engine: Engine): DeleteKeyframesInverse {
    const removed = engine.deleteKeyframes(this.#target, this.#keyframeIds)
    return { target: this.#target, keyframes: removed.map(snapshotOf) }
  }

  #requireIds(engine: Engine): void {
    const existing = new Set(engine.getKeyframesOf(this.#target).map((keyframe) => keyframe.id))
    for (const keyframeId of this.#keyframeIds) {
      if (!existing.has(keyframeId)) {
        throw new Error(`Keyframe not found: ${keyframeId}`)
      }
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
