import type { Command, CommandResult } from '../engine/commands/command'
import type { UndoStack } from '../engine/commands/undoStack'
import { TransactionCommand } from '../engine/commands/transactionCommand'
import { CreateSlideCommand } from '../engine/commands/createSlideCommand'
import { DeleteSlideCommand } from '../engine/commands/deleteSlideCommand'
import { RenameSlideCommand } from '../engine/commands/renameSlideCommand'
import { CreatePrompterPartCommand } from '../engine/commands/createPrompterPartCommand'
import { DeletePrompterPartCommand } from '../engine/commands/deletePrompterPartCommand'
import { SetSlideDurationCommand } from '../engine/commands/setSlideDurationCommand'
import { SetSlideAnimationScriptCommand } from '../engine/commands/setSlideAnimationScriptCommand'
import { newId } from '../engine/ids'
import type { PlannerResult, PlannerSlide } from './scenarioPlanner'

/**
 * Atomic apply of a scenario script draft (issue #471).
 *
 * Pure command builder plus the one-Transaction execution seam: given the
 * deterministic planner result and the live slide list, converge slides
 * positionally (keeps renamed, surplus deleted, missing created), replace
 * each target slide's prompter with its single verbatim part (prior parts
 * deleted, which drops their stale audio links), set the slide duration to
 * the sum of parts, and write the board script source — all as one
 * Transaction with one undoable History entry. Re-runs converge without
 * duplicates: keeps are positional prefix matches, so a second apply only
 * rewrites content.
 *
 * Gating lives with the caller (the modal refuses without an accepted
 * snapshot and the Apply button stays disabled while the plan is blocked);
 * this seam additionally refuses blocked or empty plans so no partial write
 * can execute.
 */

export interface ScenarioScriptApplySlide {
  readonly id: string
  readonly name: string
  /** Live prompter part ids (empty when the slide has no prompter parts). */
  readonly partIds: readonly string[]
}

/**
 * Project a live slide list into the apply snapshot shape. Lives here (not
 * in the modal) so Generate-time and Apply-time reads share one projection.
 */
export function snapshotScenarioScriptSlides(
  slides: readonly {
    readonly id: string
    readonly name: string
    readonly prompter?: { readonly parts: readonly { readonly id: string }[] } | null
  }[],
): ScenarioScriptApplySlide[] {
  return slides.map((slide) => ({
    id: slide.id,
    name: slide.name,
    partIds: slide.prompter?.parts.map((part) => part.id) ?? [],
  }))
}

export interface ScenarioScriptApplyInput {
  readonly plan: PlannerResult
  /** Live project slides in order (all treated as draft middles). */
  readonly existingSlides: readonly ScenarioScriptApplySlide[]
}

export interface ScenarioScriptApplyPlan {
  readonly commands: Command<unknown>[]
  /** Slide ids in desired order after the Transaction executes. */
  readonly targetSlideIds: readonly string[]
}

export interface ScenarioScriptApplyResult {
  readonly ok: boolean
  readonly targetSlideIds: readonly string[]
  readonly historyEntryId?: string
  readonly error?: string
}

function slideContentCommands(
  slideId: string,
  draft: PlannerSlide,
  livePartIds: readonly string[],
): Command<unknown>[] {
  const commands: Command<unknown>[] = []
  // Delete prior parts (last-to-first so downstream shifts stay minimal).
  // Deleting drops each part's linked audio clips/segments — stale voice
  // links never survive the draft; re-commit rides the existing voice path.
  for (let i = livePartIds.length - 1; i >= 0; i -= 1) {
    commands.push(new DeletePrompterPartCommand({ slideId, partId: livePartIds[i]! }))
  }
  // One verbatim part: text is the step narrator, duration is the planned
  // slide length (padded when table budgets overflowed the estimate).
  commands.push(
    new CreatePrompterPartCommand({
      slideId,
      text: draft.prompterText,
      duration: draft.duration,
    }),
  )
  // Slide length stays the sum of parts: single part, so both match.
  commands.push(new SetSlideDurationCommand({ slideId, duration: draft.duration }))
  commands.push(new SetSlideAnimationScriptCommand({ slideId, source: draft.source }))
  return commands
}

/**
 * Build the apply Transaction children. Pure: reads only the plan and the
 * live slide snapshot, never the engine. New slides get pre-generated ids
 * (`CreateSlideCommand` `slideId`) so later children of the same
 * Transaction can configure them — no forward references, no second
 * dispatch, one History entry.
 */
export function buildScenarioScriptApplyCommands(
  input: ScenarioScriptApplyInput,
): ScenarioScriptApplyPlan {
  const { plan, existingSlides } = input
  const commands: Command<unknown>[] = []
  const targetSlideIds: string[] = []

  const keepCount = Math.min(existingSlides.length, plan.slides.length)

  // Renames for positional keeps whose display name drifted.
  for (let i = 0; i < keepCount; i += 1) {
    const existing = existingSlides[i]!
    const desired = plan.slides[i]!
    targetSlideIds.push(existing.id)
    if (existing.name !== desired.slideName) {
      commands.push(new RenameSlideCommand({ slideId: existing.id, name: desired.slideName }))
    }
  }

  // Surplus slides deleted last-to-first (index-stable, id-addressed anyway).
  for (let i = existingSlides.length - 1; i >= plan.slides.length; i -= 1) {
    commands.push(new DeleteSlideCommand({ slideId: existingSlides[i]!.id }))
  }

  // Missing slides created (appended, in desired order) with pre-generated
  // ids so content commands below can target them in the same Transaction.
  const createdIds: string[] = []
  for (let i = existingSlides.length; i < plan.slides.length; i += 1) {
    const desired = plan.slides[i]!
    const slideId = newId('slide')
    createdIds.push(slideId)
    targetSlideIds.push(slideId)
    commands.push(new CreateSlideCommand({ name: desired.slideName, slideId }))
  }

  // Content per target slide, in desired order (creates precede their
  // content since all structure above runs first).
  for (let i = 0; i < plan.slides.length; i += 1) {
    const desired = plan.slides[i]!
    const slideId = targetSlideIds[i]!
    const livePartIds = i < existingSlides.length ? (existingSlides[i]!.partIds ?? []) : []
    commands.push(...slideContentCommands(slideId, desired, livePartIds))
  }

  return { commands, targetSlideIds }
}

export interface ScenarioScriptApplyDispatcher {
  dispatch<Inverse>(command: Command<Inverse>, source?: 'user' | 'ai'): CommandResult<Inverse>
}

type ApplySystem = {
  dispatcher: ScenarioScriptApplyDispatcher
  undoStack: UndoStack
}

/**
 * Execute the draft apply as one Transaction with one History entry.
 * Refuses blocked plans (hard errors) and empty plans (nothing to converge
 * to — and converging to zero slides would hit the last-slide guard).
 * Child validation plus the Transaction rollback keep failures atomic with
 * no partial history.
 */
export function applyScenarioScript(
  system: ApplySystem,
  input: ScenarioScriptApplyInput,
): ScenarioScriptApplyResult {
  const { plan } = input
  if (plan.blocked) {
    const first = plan.diagnostics.find((d) => d.severity === 'error')
    return {
      ok: false,
      targetSlideIds: [],
      error: first
        ? `Draft has blocking errors — ${first.message} Fix the accepted scenario and re-run Generate. Nothing executed.`
        : 'Draft has blocking errors — fix the accepted scenario and re-run Generate. Nothing executed.',
    }
  }
  if (plan.slides.length === 0) {
    return {
      ok: false,
      targetSlideIds: [],
      error: 'Draft has no slides — the accepted scenario defines no steps. Nothing executed.',
    }
  }

  const { commands, targetSlideIds } = buildScenarioScriptApplyCommands(input)
  const before = system.undoStack.entries.length
  const result = system.dispatcher.dispatch(new TransactionCommand(commands), 'ai')
  if (!result.ok) {
    return { ok: false, targetSlideIds: [], error: result.error.message }
  }
  const top = system.undoStack.entries[0]
  const expected = before + 1
  if (system.undoStack.entries.length !== expected || top?.type !== 'Transaction') {
    return {
      ok: false,
      targetSlideIds: [],
      error: 'Execution did not record exactly one History entry.',
    }
  }
  return { ok: true, targetSlideIds, historyEntryId: top.id }
}
