import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'

export interface MoveClipKeyframesParameters {
  readonly target: ClipChannelTarget
  readonly moves: readonly { readonly keyframeId: string; readonly newTime: number }[]
}

export interface MoveClipKeyframesInverse {
  readonly target: ClipChannelTarget
  readonly moves: readonly { readonly keyframeId: string; readonly oldTime: number }[]
}

export class MoveClipKeyframesCommand implements Command<MoveClipKeyframesInverse> {
  readonly type = 'MoveClipKeyframes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #moves: readonly { readonly keyframeId: string; readonly newTime: number }[]

  constructor(input: MoveClipKeyframesParameters) {
    this.#target = input.target
    this.#moves = input.moves
    this.parameters = {
      target: input.target,
      moves: input.moves.map((m) => ({ keyframeId: m.keyframeId, newTime: m.newTime })),
    }
  }

  validate(engine: Engine): void {
    this.#validateTarget(engine)
    if (this.#moves.length === 0) {
      throw new Error('At least one keyframe move is required')
    }
    for (const move of this.#moves) {
      if (typeof move.keyframeId !== 'string' || move.keyframeId === '') {
        throw new Error('Keyframe move keyframeId must be a non-empty string')
      }
      if (typeof move.newTime !== 'number' || !Number.isFinite(move.newTime)) {
        throw new Error('Keyframe move newTime must be a finite number')
      }
      if (move.newTime < 0 || move.newTime > 1) {
        throw new Error('Clip keyframe time must be within [0, 1]')
      }
    }
  }

  execute(engine: Engine): MoveClipKeyframesInverse {
    const result = engine.moveClipChannelKeyframes(
      this.#target.clipId,
      this.#target.channel,
      this.#moves,
    )
    return { target: this.#target, moves: result }
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
