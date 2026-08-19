import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipChannelDef } from '../clipDefinition'

export interface AddClipChannelParameters {
  readonly clipId: string
  readonly channel: ClipChannelDef
}

export interface AddClipChannelInverse {
  readonly clipId: string
  readonly channelDef: ClipChannelDef
}

export class AddClipChannelCommand implements Command<AddClipChannelInverse> {
  readonly type = 'AddClipChannel'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string
  readonly #channel: ClipChannelDef

  constructor(input: AddClipChannelParameters) {
    this.#clipId = input.clipId
    this.#channel = input.channel
    this.parameters = {
      clipId: input.clipId,
      channel: { ...input.channel },
    }
  }

  validate(engine: Engine): void {
    const clip = engine.getClip(this.#clipId)
    if (clip.hasChannel(this.#channel.property)) {
      throw new Error(`Clip channel "${this.#channel.property}" already exists`)
    }
  }

  execute(engine: Engine): AddClipChannelInverse {
    engine.addClipChannel(this.#clipId, this.#channel)
    return { clipId: this.#clipId, channelDef: { ...this.#channel } }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
