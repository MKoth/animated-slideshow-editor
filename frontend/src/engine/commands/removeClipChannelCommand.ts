import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animationProperties'
import type { ClipChannelDef } from '../clipDefinition'

export interface RemoveClipChannelParameters {
  readonly clipId: string
  readonly channel: AnimationProperty
}

export interface RemoveClipChannelInverse {
  readonly clipId: string
  readonly channelDef: ClipChannelDef
}

export class RemoveClipChannelCommand implements Command<RemoveClipChannelInverse> {
  readonly type = 'RemoveClipChannel'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #channel: AnimationProperty

  constructor(input: RemoveClipChannelParameters) {
    this.#clipId = input.clipId
    this.#channel = input.channel
    this.parameters = {
      clipId: input.clipId,
      channel: input.channel,
    }
  }

  validate(engine: Engine): void {
    const clip = engine.getClip(this.#clipId)
    if (!clip.hasChannel(this.#channel)) {
      throw new Error(`Clip channel not found: ${this.#channel}`)
    }
  }

  execute(engine: Engine): RemoveClipChannelInverse {
    const clip = engine.getClip(this.#clipId)
    const channelDef = clip.getChannel(this.#channel)!
    const snapshot: ClipChannelDef = {
      property: channelDef.property,
      ...(channelDef.paramKey !== undefined ? { paramKey: channelDef.paramKey } : {}),
      ...(channelDef.linkMode !== undefined ? { linkMode: channelDef.linkMode } : {}),
    }
    engine.removeClipChannel(this.#clipId, this.#channel)
    return { clipId: this.#clipId, channelDef: snapshot }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
