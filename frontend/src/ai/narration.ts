import { estimatePrompterDuration } from '../engine/prompter'

/**
 * Stage C narration helpers (issue #425). Client mirror of the backend
 * `app/ai/narrations.py` seam: verbatim fill, char-count estimate with slide
 * duration as the sum of parts, post-TTS adopt-and-shift that never
 * auto-stretches audio (AiCommitTtsCommand locks playbackRate to 1).
 */

export type NarrationPartStatus = 'pending' | 'ready' | 'failed'

export interface NarrationStep {
  readonly id: string
  readonly order: number
  readonly partTag: string
  readonly spokenLine: string
}

export interface NarrationPart {
  readonly stepId: string
  readonly order: number
  readonly spokenLine: string
  readonly estimatedDuration: number
  readonly audioDuration?: number | null
  readonly assetId?: string | null
  readonly status: NarrationPartStatus
  readonly stale?: boolean
  readonly voicePromptId?: string | null
  readonly error?: string | null
  readonly timelineStart: number
  readonly timelineEnd: number
}

export function estimatePartDuration(text: string, secondsPerCharacter: number): number {
  return estimatePrompterDuration(text, secondsPerCharacter)
}

function effectiveDuration(
  part: Pick<NarrationPart, 'estimatedDuration' | 'audioDuration'>,
): number {
  if (typeof part.audioDuration === 'number' && part.audioDuration > 0) return part.audioDuration
  return part.estimatedDuration
}

/** Gap-free prefix-sum layout from effective durations (adopted or estimated). */
export function layoutParts<T extends NarrationPart>(parts: readonly T[]): T[] {
  let cursor = 0
  return parts.map((part) => {
    const duration = effectiveDuration(part)
    const laid = { ...part, timelineStart: cursor, timelineEnd: cursor + duration }
    cursor = laid.timelineEnd
    return laid
  })
}

/** Slide duration is the sum of its parts. */
export function slideDurationForParts(
  parts: readonly Pick<NarrationPart, 'estimatedDuration' | 'audioDuration'>[],
): number {
  return parts.reduce((sum, part) => sum + effectiveDuration(part), 0)
}

/**
 * One narration part per middle step, spokenLine copied verbatim — never
 * re-derived (no splitChars re-parsing, no trimming, no normalization).
 * Intro/outro pregenerated references are left alone, mirroring Stage B.
 */
export function verbatimPartsFromSteps(
  steps: readonly NarrationStep[],
  secondsPerCharacter: number,
): NarrationPart[] {
  if (!(secondsPerCharacter > 0)) throw new Error('secondsPerCharacter must be > 0')
  const parts: NarrationPart[] = []
  for (const step of steps) {
    if (step.partTag !== 'middle') continue
    if (!step.id || !step.spokenLine) continue
    parts.push({
      stepId: step.id,
      order: step.order,
      spokenLine: step.spokenLine,
      estimatedDuration: estimatePartDuration(step.spokenLine, secondsPerCharacter),
      audioDuration: null,
      assetId: null,
      status: 'pending',
      stale: false,
      voicePromptId: null,
      error: null,
      timelineStart: 0,
      timelineEnd: 0,
    })
  }
  if (parts.length === 0)
    throw new Error('no middle steps with spoken lines — nothing verbatim to fill')
  return layoutParts(parts)
}

/** Pre-TTS fill proposal: one CreatePrompterPart per part, verbatim + estimate. */
export function buildFillCommands(
  parts: readonly NarrationPart[],
  slideId: string,
): ({ type: string } & Record<string, unknown>)[] {
  if (!slideId.trim()) throw new Error('slideId must be a non-empty string')
  return parts.map((part) => {
    if (!part.spokenLine) throw new Error(`part ${part.stepId} has no verbatim spoken line`)
    return {
      type: 'CreatePrompterPart',
      slideId,
      text: part.spokenLine,
      duration: effectiveDuration(part),
    }
  })
}

/**
 * Post-TTS commit proposal: one AiCommitTts per ready part, asset ids only.
 * Embed-first is enforced: parts without an assetId raise instead of
 * emitting inline audio bytes.
 */
export function buildCommitCommands(
  parts: readonly NarrationPart[],
  slideId: string,
  partIds: Readonly<Record<string, string>>,
): ({ type: string } & Record<string, unknown>)[] {
  if (!slideId.trim()) throw new Error('slideId must be a non-empty string')
  return layoutParts(parts.map((part) => ({ ...part }))).map((part) => {
    const partId = partIds[part.stepId] ?? ''
    if (!partId.trim()) throw new Error(`no PrompterPart id mapped for step ${part.stepId}`)
    if (part.status !== 'ready') {
      throw new Error(
        `part ${part.stepId} is ${part.status} — retry it and embed its WAV before committing`,
      )
    }
    if (typeof part.assetId !== 'string' || !part.assetId.trim()) {
      throw new Error(
        `part ${part.stepId} has no assetId — embed the WAV first, then reference the asset id (never inline base64)`,
      )
    }
    if (typeof part.audioDuration !== 'number' || !(part.audioDuration > 0)) {
      throw new Error(`part ${part.stepId} has no adopted TTS audio duration`)
    }
    return {
      type: 'AiCommitTts',
      slideId,
      partId,
      assetId: part.assetId.trim(),
      timelineStart: part.timelineStart,
      sourceEnd: part.audioDuration,
    }
  })
}

/** Accept-gate blockers: every part must be ready with an embedded asset id. */
export function narrationAcceptBlockers(parts: readonly NarrationPart[]): string[] {
  const blockers: string[] = []
  for (const part of parts) {
    if (part.status === 'failed') {
      blockers.push(
        `part ${part.stepId}: ${part.error || 'TTS failed'} — retry this part before accepting`,
      )
    } else if (part.status !== 'ready') {
      blockers.push(`part ${part.stepId}: TTS audio not generated yet — run the batch, then accept`)
    } else if (typeof part.assetId !== 'string' || !part.assetId.trim()) {
      blockers.push(
        `part ${part.stepId}: WAV not embedded yet — embed first so the proposal references the asset id`,
      )
    }
  }
  return blockers
}

/**
 * Match narration parts to live PrompterParts by verbatim text equality.
 * Returns the stepId -> partId map for commit proposals; unmatched steps
 * list the verbatim text so the author can run the fill proposal first.
 */
export function matchPartsByVerbatimText(
  slidePartTexts: readonly { id: string; text: string }[],
  parts: readonly NarrationPart[],
): { matched: Record<string, string>; unmatchedStepIds: string[] } {
  const matched: Record<string, string> = {}
  const unmatchedStepIds: string[] = []
  const remaining = [...slidePartTexts]
  for (const part of parts) {
    const index = remaining.findIndex((candidate) => candidate.text === part.spokenLine)
    if (index === -1) {
      unmatchedStepIds.push(part.stepId)
      continue
    }
    const [found] = remaining.splice(index, 1)
    matched[part.stepId] = (found as { id: string }).id
  }
  return { matched, unmatchedStepIds }
}
