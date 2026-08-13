import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animation'
import { requireAnimatableForNode, requireKeyframeTime } from '../animation'
import type { KeyframeMove } from '../animation'

export interface BatchMoveKeyframesParameters {
  readonly moves: readonly KeyframeMove[]
}

export interface BatchMoveKeyframesInverseMove {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly oldTime: number
}

export interface BatchMoveKeyframesInverse {
  readonly moves: readonly BatchMoveKeyframesInverseMove[]
}

export class BatchMoveKeyframesCommand implements Command<BatchMoveKeyframesInverse> {
  readonly type = 'BatchMoveKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #moves: readonly KeyframeMove[]

  constructor(input: BatchMoveKeyframesParameters) {
    this.#moves = input.moves
    this.parameters = { moves: input.moves }
  }

  validate(engine: Engine): void {
    if (this.#moves.length === 0) {
      throw new Error('At least one keyframe move is required')
    }
    for (const move of this.#moves) {
      const node = engine.getNode(move.nodeId)
      requireAnimatableForNode(node, move.property)
      const slide = engine.getSlideOfNode(move.nodeId)
      requireKeyframeTime(move.newTime, slide.duration)
      if (!engine.getKeyframe(move.nodeId, move.property, move.keyframeId)) {
        throw new Error(`Keyframe not found: ${move.keyframeId} on property ${move.property}`)
      }
    }
  }

  execute(engine: Engine): BatchMoveKeyframesInverse {
    const results = engine.moveKeyframes(this.#moves)
    return {
      moves: results.map((result) => ({
        nodeId: result.nodeId,
        property: result.property,
        keyframeId: result.keyframeId,
        oldTime: result.oldTime,
      })),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
