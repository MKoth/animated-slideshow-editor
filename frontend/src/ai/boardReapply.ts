import type { EnginePublic } from '../engine/engine'
import { MAX_SLIDE_DURATION, MIN_SLIDE_DURATION } from '../engine/slide'
import type { Command } from '../engine/commands/command'
import type { UndoStack } from '../engine/commands/undoStack'
import { TransactionCommand } from '../engine/commands/transactionCommand'
import { SetSlideAnimationScriptCommand } from '../engine/commands/setSlideAnimationScriptCommand'
import { SetSlideDurationCommand } from '../engine/commands/setSlideDurationCommand'
import type { ScenarioStep } from '../engine/scenarioMarkdown'
import type { PlannerFraction, PlannerSlide } from './scenarioPlanner'
import { relayoutBoardSource } from './scenarioPlanner'
import type { ScenarioScriptApplyDispatcher } from './scenarioScriptApply'

export interface BoardReapplySystem {
  dispatcher: ScenarioScriptApplyDispatcher
  undoStack: UndoStack
}

export interface BoardReapplyLivePart {
  readonly duration: number
  readonly startTime: number
  readonly endTime: number
}

export interface BoardReapplyPlanInput {
  readonly planSlide: PlannerSlide
  readonly step: ScenarioStep
  readonly liveParts: readonly BoardReapplyLivePart[]
  readonly assetNameForPlaced: (slug: string) => string
  readonly html?: string
}

export interface BoardReapplyPlan {
  readonly source: string
  readonly fractions: readonly PlannerFraction[]
  readonly boardCost: number
  readonly padded: boolean
  /** Live prompts end (max part end — the variable length TTS produced). */
  readonly livePromptsEnd: number
  /** Prompt marks were proportionally redistributed because part counts changed. */
  readonly timingRedistributed: boolean
  /**
   * Slide length the re-apply writes: the prompts end plus the 1s tail
   * (board teardown included when it outruns the voice).
   */
  readonly slideDuration: number
  /** True when live parts carry gaps the prefix-sum layout cannot preserve. */
  readonly gapsCollapsed: boolean
}

export type BoardReapplyPlanResult =
  | { readonly ok: true; readonly plan: BoardReapplyPlan }
  | { readonly ok: false; readonly error: string }

/**
 * Rebuild one step's board for the live prompter timing (issue: TTS
 * re-recording changes block lengths while the applied source still carries
 * the estimate-time layout — each re-apply reads the situation as it is
 * now). Pure: reads only the inputs, never the engine.
 */
export function planBoardReapply(input: BoardReapplyPlanInput): BoardReapplyPlanResult {
  const { planSlide, step, liveParts } = input
  const plannedCount = planSlide.prompterParts.length
  if (liveParts.length === 0) {
    return {
      ok: false,
      error: `Step ${planSlide.position} has no prompt blocks — apply prompter text first. Nothing executed.`,
    }
  }
  const liveStart = Math.min(...liveParts.map((part) => part.startTime))
  const liveEnd = Math.max(...liveParts.map((part) => part.endTime))
  const liveSpan = liveEnd - liveStart
  if (
    liveParts.some(
      (part) =>
        !Number.isFinite(part.startTime) ||
        !Number.isFinite(part.endTime) ||
        part.endTime < part.startTime,
    ) ||
    !Number.isFinite(liveSpan) ||
    liveSpan <= 0
  ) {
    return {
      ok: false,
      error: `Step ${planSlide.position}: live prompt blocks have no usable time span. Nothing executed.`,
    }
  }
  const timingRedistributed = liveParts.length !== plannedCount
  const weights = timingRedistributed
    ? planSlide.prompterParts.map((part) => part.duration)
    : liveParts.map((part) => part.duration)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  if (
    weights.some((weight) => !Number.isFinite(weight) || weight < 0) ||
    !Number.isFinite(weightTotal) ||
    weightTotal <= 0
  ) {
    return {
      ok: false,
      error: `Step ${planSlide.position}: live prompt blocks have no usable duration. Nothing executed.`,
    }
  }
  // Keep known planned proportions when the user split/merged live prompt
  // blocks. Otherwise retain actual relative TTS lengths. In both cases map
  // those windows over the complete live prompt span (first start → last end).
  const durations = weights.map((weight) => (weight / weightTotal) * liveSpan)
  const built = relayoutBoardSource({
    slideName: planSlide.slideName,
    step,
    position: planSlide.position,
    basePromptBlockId: planSlide.promptBlockId,
    subBlockIds: planSlide.prompterParts.map((part) => part.promptBlockId),
    subMarkNames: planSlide.prompterParts.map((part) => part.markName),
    partDurations: durations,
    promptStartTime: liveStart,
    assetNameForPlaced: input.assetNameForPlaced,
    stepIndex: planSlide.stepIndex,
    ...(input.html !== undefined ? { html: input.html } : {}),
  })
  const livePromptsEnd = liveEnd
  const slideDuration = Math.min(
    Math.max(Math.max(livePromptsEnd, built.boardCost) + 1, MIN_SLIDE_DURATION),
    MAX_SLIDE_DURATION,
  )
  // The layout chains prefix-sum windows; live gaps (free placement) do not
  // survive the rebuild — durations rule, starts re-derive.
  let cursor = liveStart
  let gapsCollapsed = false
  for (const part of liveParts) {
    if (Math.abs(part.startTime - cursor) > 1e-6) gapsCollapsed = true
    cursor += part.duration
  }
  return {
    ok: true,
    plan: {
      source: built.source,
      fractions: built.fractions,
      boardCost: built.boardCost,
      padded: built.padded,
      livePromptsEnd,
      timingRedistributed,
      slideDuration,
      gapsCollapsed,
    },
  }
}

export type BoardReapplyRunResult = { readonly ran: boolean; readonly error: string | null }

export type BoardReapplyApplyResult =
  | {
      readonly ok: true
      readonly historyEntryId: string
      readonly slideDuration: number
      readonly livePromptsEnd: number
      readonly runRan: boolean
      readonly runError: string | null
    }
  | { readonly ok: false; readonly error: string }

/**
 * Execute a planned board re-apply: source + length as one Transaction with
 * one History entry, then the injected re-run (the caller wires the real
 * script runner, sync or async; tests inject a stub). A failed write runs
 * nothing; a failed run still leaves the source + length applied and
 * reports loudly via runRan/runError.
 */
export async function applyBoardReapply(
  system: BoardReapplySystem,
  engine: EnginePublic,
  slideId: string,
  planned: BoardReapplyPlan,
  run: (slideId: string, source: string) => BoardReapplyRunResult | Promise<BoardReapplyRunResult>,
): Promise<BoardReapplyApplyResult> {
  try {
    engine.getSlide(slideId)
  } catch {
    return { ok: false, error: `Slide not found: ${slideId}. Nothing executed.` }
  }
  const commands: Command<unknown>[] = [
    new SetSlideAnimationScriptCommand({ slideId, source: planned.source }),
    new SetSlideDurationCommand({ slideId, duration: planned.slideDuration }),
  ]
  const before = system.undoStack.entries.length
  const result = system.dispatcher.dispatch(new TransactionCommand(commands), 'ai')
  if (!result.ok) {
    return { ok: false, error: `Board re-apply failed: ${result.error.message}. Nothing applied.` }
  }
  const top = system.undoStack.entries[0]
  if (system.undoStack.entries.length !== before + 1 || top?.type !== 'Transaction') {
    return { ok: false, error: 'Board re-apply did not record exactly one History entry.' }
  }
  const runResult = await run(slideId, planned.source)
  return {
    ok: true,
    historyEntryId: top.id,
    slideDuration: planned.slideDuration,
    livePromptsEnd: planned.livePromptsEnd,
    runRan: runResult.ran,
    runError: runResult.error,
  }
}
