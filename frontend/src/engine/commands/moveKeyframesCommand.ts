import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireKeyframeTime } from '../animationProperties'
import type { KeyframeMove, KeyframeMoveResult } from '../animationManager'

export interface MoveKeyframesParameters {
  readonly target: KeyframeTarget
  readonly moves: readonly KeyframeMove[]
}

export interface MoveKeyframesInverse {
  readonly target: KeyframeTarget
  readonly moves: readonly KeyframeMoveResult[]
}

export class MoveKeyframesCommand implements Command<MoveKeyframesInverse> {
  readonly type = 'MoveKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #moves: readonly KeyframeMove[]

  constructor(input: MoveKeyframesParameters) {
    this.#target = input.target
    this.#moves = input.moves
    this.parameters = {
      target: input.target,
      moves: input.moves.map((move) => ({ ...move })),
    }
  }

  validate(engine: Engine): void {
    engine.resolveAnimationTarget(this.#target)
    if (this.#moves.length === 0) {
      throw new Error('At least one keyframe move is required')
    }
    const slide = engine.getSlideOfNode(this.#target.nodeId)
    const existing = new Set(engine.getKeyframesOf(this.#target).map((keyframe) => keyframe.id))
    for (const move of this.#moves) {
      requireKeyframeTime(move.newTime, slide.duration)
      if (!existing.has(move.keyframeId)) {
        throw new Error(`Keyframe not found: ${move.keyframeId}`)
      }
    }
  }

  execute(engine: Engine): MoveKeyframesInverse {
    const results = engine.moveKeyframes(this.#target, this.#moves)
    return { target: this.#target, moves: results }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
