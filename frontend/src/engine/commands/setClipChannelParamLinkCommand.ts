import type { Engine } from '../internal'
import type { Command } from './command'
import type { AnimationProperty } from '../animationProperties'
import { requireAnimationProperty } from '../animationProperties'
import { requireString } from '../guards'

export interface SetClipChannelParamLinkParameters {
  readonly clipId: string
  readonly channel: AnimationProperty
  readonly paramKey: string | null
}

export interface SetClipChannelParamLinkInverse {
  readonly clipId: string
  readonly channel: AnimationProperty
  readonly oldParamKey: string | null
}

export class SetClipChannelParamLinkCommand implements Command<SetClipChannelParamLinkInverse> {
  readonly type = 'SetClipChannelParamLink'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #channel: AnimationProperty
  readonly #paramKey: string | null

  constructor(input: SetClipChannelParamLinkParameters) {
    this.#clipId = input.clipId
    this.#channel = input.channel
    this.#paramKey = input.paramKey
    this.parameters = {
      clipId: input.clipId,
      channel: input.channel,
      paramKey: input.paramKey,
    }
  }

  validate(engine: Engine): void {
    const clip = engine.getClip(this.#clipId)
    requireAnimationProperty(this.#channel)
    const channelDef = clip.getChannel(this.#channel)
    if (!channelDef) {
      throw new Error(`Clip channel not found: ${this.#channel}`)
    }
    if (this.#paramKey !== null) {
      requireString(this.#paramKey, 'Clip channel param key')
      const param = clip.getParam(this.#paramKey)
      if (!param) {
        throw new Error(`Clip param not found: ${this.#paramKey}`)
      }
    }
  }

  execute(engine: Engine): SetClipChannelParamLinkInverse {
    const clip = engine.getClip(this.#clipId)
    const channelDef = clip.getChannel(this.#channel)!
    const oldParamKey = channelDef.paramKey ?? null
    engine.setClipChannelParamLink(this.#clipId, this.#channel, this.#paramKey)
    return { clipId: this.#clipId, channel: this.#channel, oldParamKey }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
