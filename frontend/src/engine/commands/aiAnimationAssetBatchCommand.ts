import type { LessonJSON } from '../json'
import type { Engine } from '../internal'
import { createEngineInternal } from '../internal'
import {
  applyAnimationAssetOperations,
  type AnimationAssetOperation,
} from '../../ai/animationAssetOperations'
import type { Command } from './command'

export interface AiAnimationAssetBatchParameters {
  readonly operations: readonly AnimationAssetOperation[]
}

export interface AiAnimationAssetBatchInverse {
  readonly before: LessonJSON
  readonly after: LessonJSON
  readonly activeSlideId: string | null
}

/**
 * Applies one explicitly approved batch of animation asset operations. A full
 * LessonJSON inverse keeps create/update/delete atomic and exactly undoable,
 * while previews and validation use the same pure JSON transformation.
 */
export class AiAnimationAssetBatchCommand implements Command<AiAnimationAssetBatchInverse> {
  readonly type = 'AiAnimationAssetBatch'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #operations: readonly AnimationAssetOperation[]

  constructor(input: AiAnimationAssetBatchParameters) {
    this.#operations = structuredClone(input.operations)
    this.parameters = { operations: this.#operations }
  }

  validate(engine: Engine): void {
    const candidate = applyAnimationAssetOperations(engine.toJSON(), this.#operations)
    const validator = createEngineInternal()
    validator.restoreFromJSON(candidate)
  }

  execute(engine: Engine): AiAnimationAssetBatchInverse {
    const before = structuredClone(engine.toJSON())
    const activeSlideId = engine.activeSlideId
    const after = applyAnimationAssetOperations(before, this.#operations)
    engine.applyLessonSnapshot(after, activeSlideId)
    return { before, after, activeSlideId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
