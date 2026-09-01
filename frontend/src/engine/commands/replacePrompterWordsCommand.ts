import type { Engine } from '../internal'
import type { Command } from './command'
import type { AudioClip } from '../audioClip'
import type { PrompterPart } from '../prompter'
import { newId } from '../ids'
import type { EmbeddedAsset } from '../embeddedAsset'

export interface ReplacePrompterWordsParameters {
  readonly slideId: string
  readonly partId: string
  readonly startWordIndex: number
  readonly endWordIndex: number
  readonly ttsAssetId?: string
  readonly ttsData?: {
    readonly name?: string
    readonly data: string
    readonly mimeType?: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }
}

export interface ReplacePrompterWordsInverse {
  readonly oldPart: PrompterPart
  readonly oldClip?: AudioClip
  readonly oldIndex: number
  readonly newPartIds: readonly string[]
  readonly newClipIds: readonly string[]
  readonly deletedClipId?: string
  readonly createdAssetId?: string
  readonly ttsAssetId: string
}

export class ReplacePrompterWordsCommand implements Command<ReplacePrompterWordsInverse> {
  readonly type = 'ReplacePrompterWords'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #startWordIndex: number
  readonly #endWordIndex: number
  readonly #ttsAssetId: string | undefined
  readonly #ttsData: ReplacePrompterWordsParameters['ttsData']

  constructor(input: ReplacePrompterWordsParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#startWordIndex = input.startWordIndex
    this.#endWordIndex = input.endWordIndex
    this.#ttsAssetId = input.ttsAssetId
    this.#ttsData = input.ttsData
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      startWordIndex: input.startWordIndex,
      endWordIndex: input.endWordIndex,
      ...(input.ttsAssetId ? { ttsAssetId: input.ttsAssetId } : {}),
      ...(input.ttsData ? { ttsData: input.ttsData } : {}),
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    if (!Number.isInteger(this.#startWordIndex) || this.#startWordIndex < 0)
      throw new Error('startWordIndex must be a non-negative integer')
    if (!Number.isInteger(this.#endWordIndex) || this.#endWordIndex < 0)
      throw new Error('endWordIndex must be a non-negative integer')
    if (this.#endWordIndex < this.#startWordIndex) throw new Error('endWordIndex must be >= startWordIndex')
    const words = part.text.match(/\S+/g) ?? []
    if (this.#startWordIndex >= words.length) throw new Error(`startWordIndex out of bounds: ${this.#startWordIndex} >= ${words.length}`)
    if (this.#endWordIndex >= words.length) throw new Error(`endWordIndex out of bounds: ${this.#endWordIndex} >= ${words.length}`)
    if (!this.#ttsAssetId && !this.#ttsData) throw new Error('Either ttsAssetId or ttsData must be provided')
    if (this.#ttsAssetId) {
      const asset = engine.getEmbeddedAsset(this.#ttsAssetId)
      if (!asset) throw new Error(`TTS AudioAsset not found: ${this.#ttsAssetId}`)
    } else if (this.#ttsData) {
      if (typeof this.#ttsData.data !== 'string' || this.#ttsData.data === '') throw new Error('ttsData.data must be a non-empty string')
    }
  }

  execute(engine: Engine): ReplacePrompterWordsInverse {
    let ttsAssetId = this.#ttsAssetId
    let createdAssetId: string | undefined
    if (!ttsAssetId && this.#ttsData) {
      const id = newId('audio-asset')
      const asset: EmbeddedAsset = {
        id,
        name: this.#ttsData.name ?? `TTS ${this.#partId}`,
        data: this.#ttsData.data,
        mimeType: this.#ttsData.mimeType ?? 'audio/wav',
        ...(this.#ttsData.metadata ? { metadata: this.#ttsData.metadata } : {}),
      }
      engine.embedAsset(asset)
      ttsAssetId = id
      createdAssetId = id
    }
    if (!ttsAssetId) throw new Error('TTS asset id could not be determined')
    const result = engine.replacePrompterPartWordRange(
      this.#slideId,
      this.#partId,
      this.#startWordIndex,
      this.#endWordIndex,
      ttsAssetId,
    )
    return {
      oldPart: result.oldPart,
      ...(result.oldClip ? { oldClip: result.oldClip } : {}),
      oldIndex: result.oldIndex,
      newPartIds: result.newPartIds,
      newClipIds: result.newClipIds,
      ...(result.deletedClipId ? { deletedClipId: result.deletedClipId } : {}),
      ...(createdAssetId ? { createdAssetId } : {}),
      ttsAssetId,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
