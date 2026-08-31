import type { Engine } from '../internal'
import type { Command } from './command'
import type { EmbeddedAsset } from '../embeddedAsset'
import { requireString } from '../guards'

export interface DeleteAudioAssetParameters {
  readonly assetId: string
}

export interface DeleteAudioAssetInverse {
  readonly asset: EmbeddedAsset
}

export class DeleteAudioAssetCommand implements Command<DeleteAudioAssetInverse> {
  readonly type = 'DeleteAudioAsset'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #assetId: string

  constructor(input: DeleteAudioAssetParameters) {
    this.#assetId = input.assetId
    this.parameters = { assetId: input.assetId }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    requireString(this.#assetId, 'AudioAsset id')
    const asset = engine.getEmbeddedAsset(this.#assetId)
    if (!asset) throw new Error(`AudioAsset not found: ${this.#assetId}`)
    if (!asset.mimeType.startsWith('audio/')) throw new Error('Asset is not an audio asset')
  }

  execute(engine: Engine): DeleteAudioAssetInverse {
    const asset = engine.getEmbeddedAsset(this.#assetId)
    if (!asset) throw new Error(`AudioAsset not found: ${this.#assetId}`)
    engine.deleteEmbeddedAsset(this.#assetId)
    return { asset }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
