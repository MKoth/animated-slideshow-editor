import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'

export interface SetPrompterPartAudioParameters {
  readonly slideId: string
  readonly partId: string
  readonly audioClipId: string | null
  readonly audioAssetId: string | null
}

export interface SetPrompterPartAudioInverse {
  readonly slideId: string
  readonly partId: string
  readonly oldAudioClipId?: string
  readonly oldAudioAssetId?: string
  readonly oldStatus?: string
}

export class SetPrompterPartAudioCommand implements Command<SetPrompterPartAudioInverse> {
  readonly type = 'SetPrompterPartAudio'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #audioClipId: string | null
  readonly #audioAssetId: string | null

  constructor(input: SetPrompterPartAudioParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#audioClipId = input.audioClipId
    this.#audioAssetId = input.audioAssetId
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      audioClipId: input.audioClipId,
      audioAssetId: input.audioAssetId,
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (this.#audioClipId !== null) requireString(this.#audioClipId, 'audioClipId')
    if (this.#audioAssetId !== null) requireString(this.#audioAssetId, 'audioAssetId')
    if (this.#audioClipId !== null) {
      const clip = slide.audio.clips.find((c) => c.id === this.#audioClipId)
      if (!clip) throw new Error(`AudioClip not found: ${this.#audioClipId}`)
    }
  }

  execute(engine: Engine): SetPrompterPartAudioInverse {
    const { oldAudioClipId, oldAudioAssetId, oldStatus } = engine.setPrompterPartAudio(
      this.#slideId,
      this.#partId,
      this.#audioClipId,
      this.#audioAssetId,
    )
    return {
      slideId: this.#slideId,
      partId: this.#partId,
      ...(oldAudioClipId ? { oldAudioClipId } : {}),
      ...(oldAudioAssetId ? { oldAudioAssetId } : {}),
      ...(oldStatus ? { oldStatus } : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
