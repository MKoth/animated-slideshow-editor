import type { Command } from '../engine/commands/command'
import type { UndoStack } from '../engine/commands/undoStack'
import { TransactionCommand } from '../engine/commands/transactionCommand'
import { CommitTtsCommand } from '../engine/commands/commitTtsCommand'
import type { ScenarioScriptApplyDispatcher } from './scenarioScriptApply'
import {
  computePlaybackRate,
  getPrompterMismatchThreshold,
  shouldShowMismatchDialog,
} from '../engine/prompter'
import type { AudioTrackId } from '../engine/audioClip'
import type { TTSProvider } from '../engine/ttsProvider'

export interface ScenarioTtsBatchTarget {
  readonly slideId: string
  /** 1-based slide position in the snapshot order. */
  readonly position: number
  readonly partId: string
  readonly text: string
  readonly plannedDuration: number
  readonly startTime: number
}

export interface ScenarioTtsBatchSnapshot {
  readonly slides: readonly {
    readonly id: string
    readonly prompter?: {
      readonly parts: readonly {
        readonly id: string
        readonly text: string
        readonly duration: number
        readonly startTime: number
      }[]
    } | null
  }[]
  readonly settings: unknown
}

/**
 * Project live slides into ordered batch targets (slide order, part order).
 * Pure: no engine access.
 */
export function collectScenarioTtsTargets(
  snapshot: Pick<ScenarioTtsBatchSnapshot, 'slides'>,
): ScenarioTtsBatchTarget[] {
  const out: ScenarioTtsBatchTarget[] = []
  for (let slideIndex = 0; slideIndex < snapshot.slides.length; slideIndex += 1) {
    const slide = snapshot.slides[slideIndex]!
    for (const part of slide.prompter?.parts ?? []) {
      if (part.text.trim() === '') continue
      out.push({
        slideId: slide.id,
        position: slideIndex + 1,
        partId: part.id,
        text: part.text,
        plannedDuration: part.duration,
        startTime: part.startTime,
      })
    }
  }
  return out
}

export type ScenarioTtsMismatchMode = 'stretch' | 'trim'

/**
 * Default narration language: the batch always sends English unless a
 * block is a carved-out foreign word (see `resolveTtsLanguage`).
 */
export const DEFAULT_TTS_LANGUAGE = 'en'
/**
 * What "foreign" means for now: foreign-word blocks isolated by the
 * planner (from `<strong class="foreign">` HTML highlights) are spoken in
 * Spanish. Later this becomes a dropdown; a single constant keeps the
 * switchover to one edit.
 */
export const FOREIGN_TTS_LANGUAGE = 'es'

function normalizeTtsText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Resolve the TTS language for one prompter block: blocks carved out of
 * the narrator as foreign words/phrases (exact normalized match against
 * the foreign list) use the foreign language, everything else uses the
 * default. Mirrors the planner's isolation (`splitNarratorToPromptParts`
 * emits foreign spans verbatim), so sentence blocks never match by
 * accident. Pure.
 */
export function resolveTtsLanguage(
  text: string,
  foreignWords: readonly string[] | undefined,
  defaultLanguage: string = DEFAULT_TTS_LANGUAGE,
  foreignLanguage: string = FOREIGN_TTS_LANGUAGE,
): string {
  if (Array.isArray(foreignWords) && foreignWords.length > 0) {
    const needle = normalizeTtsText(text)
    if (needle !== '') {
      for (const raw of foreignWords) {
        if (typeof raw !== 'string') continue
        if (normalizeTtsText(raw) === needle) return foreignLanguage
      }
    }
  }
  return defaultLanguage
}

export interface ScenarioTtsCommitPlan {
  readonly target: ScenarioTtsBatchTarget
  readonly asset: {
    readonly id: string
    readonly name: string
    readonly data: string
    readonly mimeType: string
    readonly metadata: Readonly<Record<string, unknown>>
  }
  readonly recordedDuration: number
  readonly playbackRate: number
  readonly fitTextToClip?: { readonly duration: number; readonly shiftDownstream: boolean }
  /** Clip placement accounting for earlier trim deltas on the same slide. */
  readonly timelineStart: number
}

/**
 * Decide per-part commit params from the recorded duration and the saved
 * voice preference (no dialogs in batch). `stretch` fits the clip to the
 * text via playbackRate (prompter timing untouched, board stays aligned);
 * `trim` fits the text to the clip (part duration becomes the recorded
 * length, downstream shifted). Parts without a mismatch commit verbatim.
 *
 * Timeline starts are pre-corrected for cumulative trim deltas on the same
 * slide so one Transaction stays exact while each trim shifts downstream
 * parts (matching `updatePrompterPart` shift semantics).
 */
export function planScenarioTtsCommits(
  targets: readonly ScenarioTtsBatchTarget[],
  recordedDurations: ReadonlyMap<string, number> | readonly number[],
  assets: readonly ScenarioTtsCommitPlan['asset'][],
  settings: unknown,
  mode: ScenarioTtsMismatchMode,
): ScenarioTtsCommitPlan[] {
  const threshold = getPrompterMismatchThreshold(settings)
  const durations: number[] = Array.isArray(recordedDurations)
    ? [...(recordedDurations as readonly number[])]
    : targets.map(
        (t) =>
          (recordedDurations as ReadonlyMap<string, number>).get(t.partId) ?? t.plannedDuration,
      )
  const deltaBySlide = new Map<string, number>()
  return targets.map((target, index) => {
    const recorded = durations[index] ?? target.plannedDuration
    const asset = assets[index]!
    const shift = deltaBySlide.get(target.slideId) ?? 0
    const timelineStart = target.startTime + shift
    const mismatch = shouldShowMismatchDialog(recorded, target.plannedDuration, threshold)
    if (!mismatch) {
      return { target, asset, recordedDuration: recorded, playbackRate: 1, timelineStart }
    }
    if (mode === 'stretch') {
      return {
        target,
        asset,
        recordedDuration: recorded,
        playbackRate: computePlaybackRate(target.plannedDuration, recorded),
        timelineStart,
      }
    }
    deltaBySlide.set(target.slideId, shift + (recorded - target.plannedDuration))
    return {
      target,
      asset,
      recordedDuration: recorded,
      playbackRate: 1,
      fitTextToClip: { duration: recorded, shiftDownstream: true },
      timelineStart,
    }
  })
}

export function buildScenarioTtsCommands(
  plans: readonly ScenarioTtsCommitPlan[],
  trackId: AudioTrackId = 'voice',
): Command<unknown>[] {
  return plans.map(
    (p) =>
      new CommitTtsCommand({
        slideId: p.target.slideId,
        partId: p.target.partId,
        asset: {
          id: p.asset.id,
          name: p.asset.name,
          data: p.asset.data,
          mimeType: p.asset.mimeType,
          metadata: p.asset.metadata as Record<string, unknown>,
        },
        trackId,
        timelineStart: p.timelineStart,
        sourceEnd: p.recordedDuration,
        playbackRate: p.playbackRate,
        ...(p.fitTextToClip
          ? { fitTextToClip: { ...p.fitTextToClip, shiftDownstream: true } }
          : {}),
      }),
  )
}

export interface ScenarioTtsBatchSystem {
  dispatcher: ScenarioScriptApplyDispatcher
  undoStack: UndoStack
}

export interface ScenarioTtsBatchOptions {
  readonly modelId?: string
  readonly provider?: string
  readonly mode: ScenarioTtsMismatchMode
  readonly trackId?: AudioTrackId
  /** Restrict to 1-based slide positions (per-step generation). Omit for all. */
  readonly positions?: readonly number[]
  /**
   * Foreign vocabulary (planner `<strong class="foreign">` highlights):
   * matching blocks are synthesized in `foreignLanguage`, the rest in
   * `defaultLanguage` (English). Omit for engine auto-detect.
   */
  readonly foreignWords?: readonly string[]
  readonly defaultLanguage?: string
  readonly foreignLanguage?: string
  /**
   * Spanish (foreign) voice for foreign-language blocks (Base voice-clone):
   * reference asset cloned instead of the default speaker. English blocks
   * never receive it. CustomVoice models ignore reference audio.
   */
  readonly foreignReferenceAssetId?: string
  /** Exact transcript of the foreign reference recording (word-for-word). */
  readonly foreignRefText?: string
  readonly onProgress?: (done: number, total: number) => void
}

/**
 * Sequential batch: generate TTS per prompter block one request at a time
 * (progress `done/total` after each generation), then commit all clips in
 * one Transaction with one History entry. Generation failures abort before
 * anything is written (atomic); commit failures report without partial
 * history. With `positions`, only those slides' blocks are synthesized
 * (per-step generation, one Transaction per step).
 */
export async function runScenarioTtsBatch(
  system: ScenarioTtsBatchSystem,
  snapshot: ScenarioTtsBatchSnapshot,
  tts: TTSProvider,
  options: ScenarioTtsBatchOptions,
): Promise<
  | { ok: true; count: number; foreignCount: number; historyEntryId: string }
  | { ok: false; error: string; done: number; total: number }
> {
  const allTargets = collectScenarioTtsTargets(snapshot)
  const targets =
    options.positions === undefined
      ? allTargets
      : allTargets.filter((t) => options.positions!.includes(t.position))
  const total = targets.length
  if (total === 0) {
    return {
      ok: false,
      error: 'No prompter blocks to synthesize — apply prompter text first.',
      done: 0,
      total: 0,
    }
  }
  const trackId = options.trackId ?? 'voice'
  const defaultLanguage = options.defaultLanguage ?? DEFAULT_TTS_LANGUAGE
  const foreignLanguage = options.foreignLanguage ?? FOREIGN_TTS_LANGUAGE
  const assets: ScenarioTtsCommitPlan['asset'][] = []
  const recorded: number[] = []
  let foreignCount = 0
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!
    // English by default; blocks carved out as foreign words (planner
    // `<strong class="foreign">` highlights, foreign = Spanish for now)
    // are synthesized in the foreign language instead of auto-detect.
    const language = resolveTtsLanguage(
      target.text,
      options.foreignWords,
      defaultLanguage,
      foreignLanguage,
    )
    // Spanish blocks clone the configured Spanish reference (Base); English
    // blocks always use the default voice.
    const useForeignVoice =
      language === foreignLanguage &&
      typeof options.foreignReferenceAssetId === 'string' &&
      options.foreignReferenceAssetId.trim() !== ''
    if (language === foreignLanguage) foreignCount += 1
    let asset
    try {
      asset = await tts.generate({
        text: target.text,
        language,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(useForeignVoice ? { referenceAssetId: options.foreignReferenceAssetId!.trim() } : {}),
        ...(useForeignVoice &&
        typeof options.foreignRefText === 'string' &&
        options.foreignRefText.trim() !== ''
          ? { refText: options.foreignRefText.trim() }
          : {}),
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const detail = (e as { detail?: string })?.detail ?? message
      return {
        ok: false,
        error: `TTS failed on block ${i + 1} of ${total}: ${detail}`,
        done: i,
        total,
      }
    }
    const metadata = asset.metadata as Record<string, unknown> | undefined
    const duration =
      typeof metadata?.duration === 'number' && Number.isFinite(metadata.duration)
        ? (metadata.duration as number)
        : target.plannedDuration
    assets.push({
      id: asset.id,
      name: asset.name || `TTS ${target.text.slice(0, 20)}`,
      data: asset.data,
      mimeType: asset.mimeType ?? 'audio/wav',
      metadata: (asset.metadata ?? {}) as Record<string, unknown>,
    })
    recorded.push(duration)
    options.onProgress?.(i + 1, total)
  }
  const plans = planScenarioTtsCommits(targets, recorded, assets, snapshot.settings, options.mode)
  const commands = buildScenarioTtsCommands(plans, trackId)
  const before = system.undoStack.entries.length
  const result = system.dispatcher.dispatch(new TransactionCommand(commands), 'ai')
  if (!result.ok) {
    return { ok: false, error: result.error.message, done: total, total }
  }
  const top = system.undoStack.entries[0]
  if (system.undoStack.entries.length !== before + 1 || top?.type !== 'Transaction') {
    return {
      ok: false,
      error: 'Execution did not record exactly one History entry.',
      done: total,
      total,
    }
  }
  return { ok: true, count: total, foreignCount, historyEntryId: top.id }
}
