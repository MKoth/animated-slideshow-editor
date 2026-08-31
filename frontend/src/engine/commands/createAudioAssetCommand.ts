import type { Engine } from '../internal'
import type { Command } from './command'
import type { EmbeddedAsset } from '../embeddedAsset'
import { requireString } from '../guards'
import { newId } from '../ids'

export interface CreateAudioAssetParameters {
  readonly name: string
  readonly data: string
  readonly mimeType?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface CreateAudioAssetInverse {
  readonly assetId: string
}

export class CreateAudioAssetCommand implements Command<CreateAudioAssetInverse> {
  readonly type = 'CreateAudioAsset'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string
  readonly #data: string
  readonly #mimeType: string
  readonly #metadata: Readonly<Record<string, unknown>> | undefined

  constructor(input: CreateAudioAssetParameters) {
    this.#name = input.name
    this.#data = input.data
    this.#mimeType = input.mimeType ?? 'audio/wav'
    this.#metadata = input.metadata
    this.parameters = { name: input.name, data: input.data, mimeType: this.#mimeType, ...(input.metadata ? { metadata: input.metadata } : {}) }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    requireString(this.#name, 'AudioAsset name')
    requireString(this.#data, 'AudioAsset data')
    requireString(this.#mimeType, 'AudioAsset mimeType')
    if (!this.#mimeType.startsWith('audio/')) throw new Error('AudioAsset mimeType must start with audio/')
  }

  execute(engine: Engine): CreateAudioAssetInverse {
    const asset: EmbeddedAsset = {
      id: newId('audio-asset'),
      name: this.#name,
      data: this.#data,
      mimeType: this.#mimeType,
      ...(this.#metadata ? { metadata: this.#metadata } : {}),
    }
    engine.embedAsset(asset)
    return { assetId: asset.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
