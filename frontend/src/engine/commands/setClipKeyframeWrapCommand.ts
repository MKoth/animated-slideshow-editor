import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelTarget } from '../keyframeTarget'

export interface SetClipKeyframeWrapParameters {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly wrap: boolean
}

export interface SetClipKeyframeWrapInverse {
  readonly target: ClipChannelTarget
  readonly keyframeId: string
  readonly oldWrap: boolean
}

export class SetClipKeyframeWrapCommand implements Command<SetClipKeyframeWrapInverse> {
  readonly type = 'SetClipKeyframeWrap'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: ClipChannelTarget
  readonly #keyframeId: string
  readonly #wrap: boolean

  constructor(input: SetClipKeyframeWrapParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#wrap = input.wrap
    this.parameters = {
      target: input.target,
      keyframeId: input.keyframeId,
      wrap: input.wrap,
    }
  }

  validate(engine: Engine): void {
    if (typeof this.#wrap !== 'boolean') {
      throw new Error('Keyframe wrap must be a boolean')
    }
    this.#validateTarget(engine)
  }

  execute(engine: Engine): SetClipKeyframeWrapInverse {
    const oldWrap = engine.setClipChannelKeyframeWrap(
      this.#target.clipId,
      this.#target.channel,
      this.#keyframeId,
      this.#wrap,
    )
    return { target: this.#target, keyframeId: this.#keyframeId, oldWrap }
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
