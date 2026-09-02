import type { Engine } from '../internal'
import type { Command } from './command'
import type { EmbeddedAsset } from '../embeddedAsset'
import type { AudioTrackId } from '../audioClip'
import { requireString, requireFiniteNumber } from '../guards'
import { newId } from '../ids'

export interface CommitTtsParameters {
  readonly slideId: string
  readonly partId: string
  readonly asset: {
    readonly id: string
    readonly name: string
    readonly data: string
    readonly mimeType: string
    readonly metadata: Readonly<Record<string, unknown>>
  }
  readonly trackId: AudioTrackId
  readonly timelineStart: number
  readonly sourceEnd: number
  readonly playbackRate: number
  readonly fitTextToClip?: {
    readonly duration: number
    readonly shiftDownstream: boolean
  }
}

export interface CommitTtsInverse {
  readonly assetId: string
  readonly clipId: string
  readonly oldAudioClipId?: string
  readonly oldAudioAssetId?: string
  readonly oldStatus?: string
  readonly deletedOldClip?: { clip: import('../audioClip').AudioClip; index: number }
  readonly shiftedParts?: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
  readonly shiftedClips?: readonly { id: string; oldTimelineStart: number }[]
  readonly oldDuration?: number
  readonly oldStartTime?: number
  readonly oldEndTime?: number
}

export class CommitTtsCommand implements Command<CommitTtsInverse> {
  readonly type = 'CommitTts'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #asset: CommitTtsParameters['asset']
  readonly #trackId: AudioTrackId
  readonly #timelineStart: number
  readonly #sourceEnd: number
  readonly #playbackRate: number
  readonly #fitTextToClip?: CommitTtsParameters['fitTextToClip']

  constructor(input: CommitTtsParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#asset = input.asset
    this.#trackId = input.trackId
    this.#timelineStart = input.timelineStart
    this.#sourceEnd = input.sourceEnd
    this.#playbackRate = input.playbackRate
    this.#fitTextToClip = input.fitTextToClip
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      asset: input.asset,
      trackId: input.trackId,
      timelineStart: input.timelineStart,
      sourceEnd: input.sourceEnd,
      playbackRate: input.playbackRate,
      ...(input.fitTextToClip ? { fitTextToClip: input.fitTextToClip } : {}),
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    requireString(this.#asset.id, 'asset.id')
    requireString(this.#asset.name, 'asset.name')
    requireString(this.#asset.data, 'asset.data')
    requireString(this.#asset.mimeType, 'asset.mimeType')
    if (!this.#asset.mimeType.startsWith('audio/'))
      throw new Error('asset mimeType must be audio/*')
    requireFiniteNumber(this.#timelineStart, 'timelineStart', (v) => v >= 0)
    requireFiniteNumber(this.#sourceEnd, 'sourceEnd', (v) => v > 0)
    requireFiniteNumber(this.#playbackRate, 'playbackRate', (v) => v > 0)
    if (this.#fitTextToClip) {
      requireFiniteNumber(this.#fitTextToClip.duration, 'fitTextToClip.duration', (v) => v >= 0)
    }
  }

  execute(engine: Engine): CommitTtsInverse {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter!.parts.find((p) => p.id === this.#partId)!
    const oldAudioClipId = part.audioClipId
    const oldAudioAssetId = part.audioAssetId
    const oldStatus = (part as unknown as { status?: string }).status

    let deletedOldClip: { clip: import('../audioClip').AudioClip; index: number } | undefined
    if (oldAudioClipId) {
      const idx = slide.audio.clips.findIndex((c) => c.id === oldAudioClipId)
      if (idx !== -1) {
        const clip = engine.deleteAudioClip(this.#slideId, oldAudioClipId)
        deletedOldClip = { clip, index: idx }
      }
    }

    const asset: EmbeddedAsset = {
      id: this.#asset.id,
      name: this.#asset.name,
      data: this.#asset.data,
      mimeType: this.#asset.mimeType,
      metadata: this.#asset.metadata as Record<string, unknown>,
    }
    engine.embedAsset(asset)

    const clipId = newId('audio-clip')
    // Create clip at given timelineStart with sourceEnd and playbackRate
    engine.createAudioClip(this.#slideId, {
      id: clipId,
      assetId: asset.id,
      trackId: this.#trackId,
      timelineStart: this.#timelineStart,
      sourceStart: 0,
      sourceEnd: this.#sourceEnd,
      playbackRate: this.#playbackRate,
    })

    engine.setPrompterPartAudio(this.#slideId, this.#partId, clipId, asset.id)

    let shiftInverse:
      | {
          shiftedParts: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
          shiftedClips: readonly { id: string; oldTimelineStart: number }[]
          oldDuration: number
          oldStartTime: number
          oldEndTime: number
        }
      | undefined
    if (this.#fitTextToClip) {
      const res = engine.updatePrompterPart(this.#slideId, this.#partId, {
        duration: this.#fitTextToClip.duration,
        shiftDownstream: this.#fitTextToClip.shiftDownstream,
      })
      shiftInverse = {
        shiftedParts: res.shiftedParts,
        shiftedClips: res.shiftedClips,
        oldDuration: res.oldDuration,
        oldStartTime: res.oldStartTime,
        oldEndTime: res.oldEndTime,
      }
    }

    return {
      assetId: asset.id,
      clipId,
      ...(oldAudioClipId ? { oldAudioClipId } : {}),
      ...(oldAudioAssetId ? { oldAudioAssetId } : {}),
      ...(oldStatus ? { oldStatus } : {}),
      ...(deletedOldClip ? { deletedOldClip } : {}),
      ...(shiftInverse
        ? {
            shiftedParts: shiftInverse.shiftedParts,
            shiftedClips: shiftInverse.shiftedClips,
            oldDuration: shiftInverse.oldDuration,
            oldStartTime: shiftInverse.oldStartTime,
            oldEndTime: shiftInverse.oldEndTime,
          }
        : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
