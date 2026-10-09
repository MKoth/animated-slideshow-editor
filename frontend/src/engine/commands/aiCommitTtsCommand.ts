import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber, requireString } from '../guards'
import { newId } from '../ids'
import { PROMPTER_DURATION_TOLERANCE } from '../prompter'

export interface AiCommitTtsParameters {
  readonly slideId: string
  readonly partId: string
  /** Already-embedded audio asset id — never inline base64 in proposals. */
  readonly assetId: string
  readonly timelineStart: number
  readonly sourceEnd: number
}

export interface AiCommitTtsInverse {
  readonly clipId: string
  readonly oldAudioClipId?: string
  readonly oldAudioAssetId?: string
  readonly oldStatus?: string
  readonly deletedOldClip?: { clip: import('../audioClip').AudioClip; index: number }
  readonly oldDuration: number
  readonly oldStartTime: number
  readonly oldEndTime: number
  readonly shiftedParts: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
  readonly shiftedClips: readonly { id: string; oldTimelineStart: number }[]
}

/**
 * Stage C TTS commit (issue #425): binds an already-embedded voice asset to
 * a PrompterPart, adopts the TTS audio duration, and shifts downstream
 * gap-free. Audio is never auto-stretched — playbackRate is locked to 1 and
 * the text bounds move to fit the audio, not the reverse. Rerecord stays
 * manual via the existing TTS/record/word-level/Waveform Editor modals.
 */
export class AiCommitTtsCommand implements Command<AiCommitTtsInverse> {
  readonly type = 'AiCommitTts'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #assetId: string
  readonly #timelineStart: number
  readonly #sourceEnd: number

  constructor(input: AiCommitTtsParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#assetId = input.assetId
    this.#timelineStart = input.timelineStart
    this.#sourceEnd = input.sourceEnd
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      assetId: input.assetId,
      timelineStart: input.timelineStart,
      sourceEnd: input.sourceEnd,
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    requireString(this.#assetId, 'assetId')
    const asset = engine.getEmbeddedAsset(this.#assetId)
    if (!asset) throw new Error(`embedded audio asset not found: ${this.#assetId}`)
    if (!asset.mimeType.startsWith('audio/')) throw new Error('asset mimeType must be audio/*')
    requireFiniteNumber(this.#timelineStart, 'timelineStart', (v) => v >= 0)
    requireFiniteNumber(this.#sourceEnd, 'sourceEnd', (v) => v > 0)
    // Gap-free alignment: the voice clip belongs at the part's start. A
    // mismatched start means the layout moved since validation — re-validate
    // (stale-blocking at approval catches the drift) instead of diverging.
    if (Math.abs(this.#timelineStart - part.startTime) > PROMPTER_DURATION_TOLERANCE) {
      throw new Error(
        `AiCommitTts timelineStart ${this.#timelineStart} does not match PrompterPart start ${part.startTime} — re-run the dry-run against the live engine`,
      )
    }
  }

  execute(engine: Engine): AiCommitTtsInverse {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter!.parts.find((p) => p.id === this.#partId)!
    const oldAudioClipId = part.audioClipId
    const oldAudioAssetId = part.audioAssetId
    const oldStatus = (part as unknown as { status?: string }).status
    const oldDuration = part.duration
    const oldStartTime = part.startTime
    const oldEndTime = part.endTime

    let deletedOldClip: { clip: import('../audioClip').AudioClip; index: number } | undefined
    if (oldAudioClipId) {
      const idx = slide.audio.clips.findIndex((c) => c.id === oldAudioClipId)
      if (idx !== -1) {
        const clip = engine.deleteAudioClip(this.#slideId, oldAudioClipId)
        deletedOldClip = { clip, index: idx }
      }
    }

    const clipId = newId('audio-clip')
    engine.createAudioClip(this.#slideId, {
      id: clipId,
      assetId: this.#assetId,
      trackId: 'voice',
      timelineStart: this.#timelineStart,
      sourceStart: 0,
      sourceEnd: this.#sourceEnd,
      // Never auto-stretched: rate 1 keeps pitch and duration of the take.
      playbackRate: 1,
    })

    engine.setPrompterPartAudio(this.#slideId, this.#partId, clipId, this.#assetId)

    // Adopt the TTS audio duration and shift downstream gap-free.
    const res = engine.updatePrompterPart(this.#slideId, this.#partId, {
      duration: this.#sourceEnd,
      shiftDownstream: true,
    })

    return {
      clipId,
      ...(oldAudioClipId ? { oldAudioClipId } : {}),
      ...(oldAudioAssetId ? { oldAudioAssetId } : {}),
      ...(oldStatus ? { oldStatus } : {}),
      ...(deletedOldClip ? { deletedOldClip } : {}),
      oldDuration,
      oldStartTime,
      oldEndTime,
      shiftedParts: res.shiftedParts,
      shiftedClips: res.shiftedClips,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
