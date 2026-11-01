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
  readonly deletedSegmentClips?: readonly {
    clip: import('../audioClip').AudioClip
    index: number
  }[]
  readonly oldSegments?: readonly import('../prompter').AudioSegment[]
  readonly deletedOldAssets?: readonly EmbeddedAsset[]
  readonly shiftedParts?: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
  readonly shiftedClips?: readonly { id: string; oldTimelineStart: number }[]
  readonly oldDuration?: number
  readonly oldStartTime?: number
  readonly oldEndTime?: number
}

function isAudioAssetReferenced(engine: Engine, assetId: string): boolean {
  const project = engine.project
  if (!project) return false
  for (const slide of project.slides) {
    for (const clip of slide.audio.clips) {
      if (clip.assetId === assetId) return true
    }
    const prompter = slide.prompter
    if (!prompter) continue
    for (const part of prompter.parts) {
      if (part.audioAssetId === assetId) return true
      if (part.segments) {
        for (const seg of part.segments) {
          if (seg.audioAssetId === assetId) return true
        }
      }
    }
  }
  return false
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
    const oldSegments = part.segments ? part.segments.map((s) => ({ ...s })) : undefined

    // Snapshot old assets (part + segments) so undo can restore them after
    // we delete the unreferenced ones. Regenerate replaces — no pile-up.
    const oldAssetIds = new Set<string>()
    if (oldAudioAssetId) oldAssetIds.add(oldAudioAssetId)
    if (oldSegments) {
      for (const seg of oldSegments) {
        if (seg.audioAssetId) oldAssetIds.add(seg.audioAssetId)
      }
    }
    const oldAssetSnapshots = new Map<string, EmbeddedAsset>()
    for (const assetId of oldAssetIds) {
      const existing = engine.getEmbeddedAsset(assetId)
      if (existing) {
        oldAssetSnapshots.set(assetId, {
          id: existing.id,
          name: existing.name,
          data: existing.data,
          mimeType: existing.mimeType,
          metadata: { ...(existing.metadata as Record<string, unknown>) },
        })
      }
    }

    let deletedOldClip: { clip: import('../audioClip').AudioClip; index: number } | undefined
    if (oldAudioClipId) {
      const idx = slide.audio.clips.findIndex((c) => c.id === oldAudioClipId)
      if (idx !== -1) {
        const clip = engine.deleteAudioClip(this.#slideId, oldAudioClipId)
        deletedOldClip = { clip, index: idx }
      }
    }

    // Word-level leftovers: segment clips belong to this part's old take.
    // A whole-part regenerate replaces them — delete them too, otherwise the
    // old voice keeps playing alongside the new clip.
    const deletedSegmentClips: { clip: import('../audioClip').AudioClip; index: number }[] = []
    if (oldSegments) {
      for (const seg of oldSegments) {
        const idx = slide.audio.clips.findIndex((c) => c.id === seg.audioClipId)
        if (idx !== -1) {
          try {
            const clip = engine.deleteAudioClip(this.#slideId, seg.audioClipId)
            deletedSegmentClips.push({ clip, index: idx })
          } catch {
            void 0
          }
        }
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
    // Whole-part take supersedes word-level segments — clear them so only the
    // new voice remains bound to this part.
    const livePart = engine
      .getSlide(this.#slideId)
      .prompter!.parts.find((p) => p.id === this.#partId)!
    if ((livePart as unknown as { segments?: unknown }).segments !== undefined) {
      delete (livePart as unknown as { segments?: unknown }).segments
    }

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

    // Delete old assets when nothing else references them — regenerate
    // replaces, it must not pile up orphan WAVs.
    const deletedOldAssets: EmbeddedAsset[] = []
    for (const [assetId, snapshot] of oldAssetSnapshots) {
      if (assetId === asset.id) continue
      if (!isAudioAssetReferenced(engine, assetId)) {
        try {
          engine.deleteEmbeddedAsset(assetId)
          deletedOldAssets.push(snapshot)
        } catch {
          void 0
        }
      }
    }

    return {
      assetId: asset.id,
      clipId,
      ...(oldAudioClipId ? { oldAudioClipId } : {}),
      ...(oldAudioAssetId ? { oldAudioAssetId } : {}),
      ...(oldStatus ? { oldStatus } : {}),
      ...(deletedOldClip ? { deletedOldClip } : {}),
      ...(deletedSegmentClips.length > 0 ? { deletedSegmentClips } : {}),
      ...(oldSegments ? { oldSegments } : {}),
      ...(deletedOldAssets.length > 0 ? { deletedOldAssets } : {}),
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
