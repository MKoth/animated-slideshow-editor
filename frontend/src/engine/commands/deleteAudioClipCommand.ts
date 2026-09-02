import type { Engine } from '../internal'
import type { Command } from './command'
import type { AudioClip } from '../audioClip'
import type { AudioSegment } from '../prompter'

export interface DeleteAudioClipParameters {
  readonly slideId: string
  readonly clipId: string
}

export interface DeleteAudioClipInverse {
  readonly slideId: string
  readonly clip: AudioClip
  readonly index: number
  readonly clearedDirectLinks?: readonly {
    readonly partId: string
    readonly oldAudioClipId: string
    readonly oldAudioAssetId?: string
    readonly oldStatus?: string
  }[]
  readonly clearedSegments?: readonly {
    readonly partId: string
    readonly segmentId: string
    readonly segment: AudioSegment
    readonly segmentIndex: number
  }[]
}

export class DeleteAudioClipCommand implements Command<DeleteAudioClipInverse> {
  readonly type = 'DeleteAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #clipId: string

  constructor(input: DeleteAudioClipParameters) {
    this.#slideId = input.slideId
    this.#clipId = input.clipId
    this.parameters = { slideId: input.slideId, clipId: input.clipId }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    const clip = engine.getSlide(this.#slideId).audio.clips.find((c) => c.id === this.#clipId)
    if (!clip) throw new Error(`AudioClip not found: ${this.#clipId}`)
  }

  execute(engine: Engine): DeleteAudioClipInverse {
    const slide = engine.getSlide(this.#slideId)
    const index = slide.audio.clips.findIndex((c) => c.id === this.#clipId)
    // Capture direct prompter links that will be cleared for independent deletion
    const clearedDirectLinks: {
      partId: string
      oldAudioClipId: string
      oldAudioAssetId?: string
      oldStatus?: string
    }[] = []
    const clearedSegments: {
      partId: string
      segmentId: string
      segment: AudioSegment
      segmentIndex: number
    }[] = []
    if (slide.prompter) {
      for (const part of slide.prompter.parts) {
        if (part.audioClipId === this.#clipId) {
          clearedDirectLinks.push({
            partId: part.id,
            oldAudioClipId: part.audioClipId!,
            ...(part.audioAssetId ? { oldAudioAssetId: part.audioAssetId } : {}),
            ...(part.status ? { oldStatus: part.status } : {}),
          })
        }
        if (part.segments) {
          for (let i = 0; i < part.segments.length; i++) {
            const seg = part.segments[i]
            if (seg.audioClipId === this.#clipId) {
              clearedSegments.push({
                partId: part.id,
                segmentId: seg.id,
                segment: { ...seg },
                segmentIndex: i,
              })
            }
          }
        }
      }
    }
    const removed = engine.deleteAudioClip(this.#slideId, this.#clipId)
    // Clear direct links so prompter part remains but unlinked (independent deletion)
    for (const link of clearedDirectLinks) {
      const part = slide.prompter?.parts.find((p) => p.id === link.partId)
      if (part) {
        delete (part as unknown as { audioClipId?: string }).audioClipId
        delete (part as unknown as { audioAssetId?: string }).audioAssetId
        delete (part as unknown as { status?: string }).status
      }
    }
    // Clear segment links — remove the segment that owned this clip
    for (const segInfo of clearedSegments) {
      const part = slide.prompter?.parts.find((p) => p.id === segInfo.partId)
      if (part && part.segments) {
        const idx = part.segments.findIndex((s) => s.id === segInfo.segmentId)
        if (idx !== -1) part.segments.splice(idx, 1)
        if (part.segments.length === 0) delete (part as unknown as { segments?: unknown }).segments
      }
    }
    return {
      slideId: this.#slideId,
      clip: removed,
      index,
      ...(clearedDirectLinks.length > 0 ? { clearedDirectLinks } : {}),
      ...(clearedSegments.length > 0 ? { clearedSegments } : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
