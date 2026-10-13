import type { SequenceDraft, SequenceBeatDraft } from './animationSequence'
import { buildAnimationSequenceRecipe } from './animationScriptRecipe'
import type { ShapeDraft, ShapeDraftResult } from './shapeDrafts'
import type { RevalidationResult } from './animationRevalidation'
import type { EnginePublic } from '../engine/engine'
import type { Command } from '../engine/commands/command'
import type { CommandSystem } from '../engine/commands/dispatcher'
import { TransactionCommand } from '../engine/commands/transactionCommand'
import { DuplicateShapeCommand } from '../engine/commands/duplicateShapeCommand'
import { SetSlideAnimationScriptCommand } from '../engine/commands/setSlideAnimationScriptCommand'
import { SetSlideAnimationScriptFootprintCommand } from '../engine/commands/setSlideAnimationScriptFootprintCommand'
import { SetSlideSceneEffectsCommand } from '../engine/commands/setSlideSceneEffectsCommand'
import { CreateAudioClipCommand } from '../engine/commands/createAudioClipCommand'
import { DeleteAudioClipCommand } from '../engine/commands/deleteAudioClipCommand'
import { animationScriptClearCommands } from '../engine/animationScriptClear'
import { checkAnimationScript } from '../engine/animationScriptCheck'
import { compiledFootprintToJSON } from '../engine/compiledFootprint'
import { computeProjectFingerprint } from './proposals'

/**
 * Atomic apply of selected approved beats (issue #446).
 *
 * Pure planning plus the existing-commands execution seam: the artist selects
 * explicitly approved beats and approved Shape drafts, and one approved batch
 * applies to the active Project as one Transaction and one undoable History
 * Entry. Blocked, rejected, stale, or dependency-incomplete work remains
 * unapplied; persistence uses the existing Save flow (apply mutates the active
 * Project in memory and never saves implicitly).
 *
 * Planning is read-only: every result derives from the validated Sequence
 * draft (#442–#443), the reviewed Shape drafts (#444), and the revalidation
 * (#445) plus the explicit approval lists — inputs are only read, never
 * written. Execution rides the existing command/Transaction/undo
 * infrastructure: approved Shape drafts duplicate via the existing
 * `DuplicateShape` command (source unchanged, topology preserved per ADR
 * 0007) and approved beats run through the retained Animation Script, whose
 * compile emits ordinary timeline data plus replace-by-footprint bookkeeping —
 * all as children of a single `Transaction` dispatched with source `'ai'`.
 */

/** Boundedness contract: one approved batch covers a reviewable set of beats and drafts. */
export const APPLY_LIMITS = {
  maxBeats: 12,
  maxDrafts: 12,
} as const

export interface AnimationApplyInput {
  draft: SequenceDraft
  shapes: ShapeDraftResult
  revalidation: RevalidationResult
  /** Explicitly approved beat ids — nothing applies without appearing here. */
  approvedBeatIds: readonly string[]
  /** Explicitly approved Shape draft ids — nothing duplicates without appearing here. */
  approvedDraftIds: readonly string[]
}

export interface ApplySkippedBeat {
  beatId: string
  label: string
  order: number
  reason: string
  action: string
}

export interface ApplySkippedDraft {
  draftId: string
  beatId: string
  reason: string
  action: string
}

export interface AnimationApplySummary {
  totalBeats: number
  appliableBeats: number
  skippedBeats: number
  totalDrafts: number
  appliableDrafts: number
  skippedDrafts: number
}

export interface AnimationApplyPlan {
  appliableBeats: SequenceBeatDraft[]
  appliableBeatIds: string[]
  skippedBeats: ApplySkippedBeat[]
  appliableDrafts: ShapeDraft[]
  appliableDraftIds: string[]
  skippedDrafts: ApplySkippedDraft[]
  /** Retained Animation Script recipe filtered to the appliable beats. */
  subsetScriptSource: string
  warnings: string[]
  summary: AnimationApplySummary
  /** True when the batch carries any appliable work. */
  appliable: boolean
  /** True when relevant live changes block the underlying proposal. */
  blocked: boolean
  /** True until the refreshed draft and previews are reviewed again. */
  needsReview: boolean
  /** Ready for the one-Transaction execution: relevant-current, reviewed, non-empty. */
  approvable: boolean
  note: string
}

export const APPLY_NOTE =
  'One approved batch applies as one Transaction with one undo entry — approved valid beats ' +
  'run through the retained Animation Script (ordinary timeline data, replace-by-footprint) and ' +
  'approved Shape drafts duplicate via the existing DuplicateShape command (source unchanged, ' +
  'topology preserved). Blocked, rejected, stale, or dependency-incomplete work remains ' +
  'unapplied. Applying changes the active Project in memory; persistence uses the existing ' +
  'Save flow — nothing is saved implicitly.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Plan one approved batch: which beats and Shape drafts apply, which remain
 * unapplied and why. Read-only: all inputs are only read, never written.
 */
export function planAnimationApply(input: AnimationApplyInput): AnimationApplyPlan {
  const draft = input.draft
  const shapes = input.shapes
  const revalidation = input.revalidation

  const beats = Array.isArray(draft?.beats) ? draft.beats.slice(0, APPLY_LIMITS.maxBeats) : []
  const truncatedBeats = Array.isArray(draft?.beats) && draft.beats.length > beats.length
  const drafts = Array.isArray(shapes?.drafts) ? shapes.drafts.slice(0, APPLY_LIMITS.maxDrafts) : []
  const truncatedDrafts = Array.isArray(shapes?.drafts) && shapes.drafts.length > drafts.length

  const warnings: string[] = []
  if (truncatedBeats) {
    warnings.push(
      `Apply covers the first ${APPLY_LIMITS.maxBeats} beats — approve fewer beats per batch so every beat stays reviewable.`,
    )
  }
  if (truncatedDrafts) {
    warnings.push(
      `Apply covers the first ${APPLY_LIMITS.maxDrafts} Shape drafts — approve fewer drafts per batch so every copy stays reviewable.`,
    )
  }

  const approvedBeats = new Set(
    (Array.isArray(input.approvedBeatIds) ? input.approvedBeatIds : []).filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    ),
  )
  const approvedDrafts = new Set(
    (Array.isArray(input.approvedDraftIds) ? input.approvedDraftIds : []).filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    ),
  )

  const revalidatedById = new Map(
    (Array.isArray(revalidation?.beats) ? revalidation.beats : []).map(
      (beat) => [beat.beatId, beat] as const,
    ),
  )
  const needsReview = revalidation?.needsReview === true
  const blocked = revalidation?.blocked === true
  const revalidationApprovable = revalidation?.approvable === true

  const appliableBeats: SequenceBeatDraft[] = []
  const skippedBeats: ApplySkippedBeat[] = []
  const appliableBeatIds: string[] = []
  // Previous *draftable* beat in draft order — placements are sequential, so an
  // approved beat whose predecessor draftable beat is not in this batch is
  // dependency-incomplete. Blocked (undrafted) beats never gate independents.
  let previousDraftableId: string | null = null
  const appliableSet = new Set<string>()

  for (const beat of beats) {
    const skip = (reason: string, action: string): void => {
      skippedBeats.push({
        beatId: beat.beatId,
        label: beat.label,
        order: beat.order,
        reason,
        action,
      })
    }
    if (beat?.status !== 'draftable') {
      const blocker = (Array.isArray(beat?.blockers) && beat.blockers[0]) || 'blocked (undrafted)'
      skip(
        `Blocked — ${blocker} Remains unapplied.`,
        (Array.isArray(beat?.actions) && beat.actions[0]) ||
          'Resolve the blocker and re-run analysis; the beat stays undrafted until then.',
      )
      continue
    }
    if (!approvedBeats.has(beat.beatId)) {
      skip(
        'Not explicitly approved — nothing applies without explicit approval. Remains unapplied.',
        'Approve this beat explicitly to include it in the batch.',
      )
      previousDraftableId = beat.beatId
      continue
    }
    const revalidated = revalidatedById.get(beat.beatId)
    if (revalidated?.affected === true) {
      const detail =
        (Array.isArray(revalidated.reasons) && revalidated.reasons.join('; ')) || 'stale'
      const action =
        (Array.isArray(revalidated.actions) && revalidated.actions[0]) ||
        'Re-run analysis against the live Project and review the refreshed draft and previews.'
      skip(`Stale — ${detail} Remains unapplied until refreshed and reviewed again.`, action)
      previousDraftableId = beat.beatId
      continue
    }
    if (needsReview) {
      skip(
        blocked
          ? 'Stale proposal — relevant live changes block this batch until analysis and previews are refreshed and reviewed again. Remains unapplied.'
          : 'Requires renewed review — review the refreshed draft, dependencies, replacement scope, and labelled previews before approving. Remains unapplied.',
        'Review the refreshed draft and previews, then approve again.',
      )
      previousDraftableId = beat.beatId
      continue
    }
    if (previousDraftableId !== null && !appliableSet.has(previousDraftableId)) {
      const previous = beats.find((entry) => entry.beatId === previousDraftableId)
      const previousLabel = previous
        ? `"${trimText(previous.label) || previous.beatId}"`
        : 'the previous beat'
      skip(
        `Dependency-incomplete — this beat follows ${previousLabel} and placements are sequential (lane priority does not crossfade). ${previousLabel} is not in this batch, so this beat remains unapplied.`,
        `Approve ${previousLabel} together with this beat, or apply this beat once its predecessor is applied.`,
      )
      previousDraftableId = beat.beatId
      continue
    }
    appliableBeats.push(beat)
    appliableBeatIds.push(beat.beatId)
    appliableSet.add(beat.beatId)
    previousDraftableId = beat.beatId
  }

  const appliableDrafts: ShapeDraft[] = []
  const skippedDrafts: ApplySkippedDraft[] = []
  const appliableDraftIds: string[] = []
  const affectedBeats = new Set(revalidation?.affectedBeatIds ?? [])

  for (const draftEntry of drafts) {
    const skip = (reason: string, action: string): void => {
      skippedDrafts.push({ draftId: draftEntry.draftId, beatId: draftEntry.beatId, reason, action })
    }
    if (!approvedDrafts.has(draftEntry.draftId)) {
      skip(
        'Not explicitly approved — nothing duplicates without explicit approval. Remains unapplied.',
        'Approve this Shape draft explicitly to include it in the batch.',
      )
      continue
    }
    if (draftEntry.status === 'rejected') {
      skip(
        `Rejected — ${draftEntry.feedback ?? 'the artist rejected this copy.'} The source Shape is unchanged; remains unapplied.`,
        'Re-propose the draft to revisit it; rejected work never applies.',
      )
      continue
    }
    if (draftEntry.status === 'needs-artist-geometry') {
      skip(
        'Needs artist-authored geometry — existing topology cannot express the pose, so there is no review copy to duplicate. Remains unapplied.',
        'Author the missing pose as your own Shape on the target mesh, then re-run analysis.',
      )
      continue
    }
    if (draftEntry.status === 'proposed') {
      skip(
        'Not yet approved — a proposed copy needs artist review first. Remains unapplied until accepted.',
        'Inspect the copy against its source, sculpt or rename it to fit, then accept the draft.',
      )
      continue
    }
    if (affectedBeats.has(draftEntry.beatId)) {
      skip(
        'Stale — the beat this draft belongs to changed underneath the validated draft. Remains unapplied until refreshed and reviewed again.',
        'Re-run analysis against the live Project and review the refreshed draft and previews.',
      )
      continue
    }
    if (needsReview) {
      skip(
        blocked
          ? 'Stale proposal — relevant live changes block this batch until analysis and previews are refreshed and reviewed again. Remains unapplied.'
          : 'Requires renewed review — review the refreshed draft and previews before approving. Remains unapplied.',
        'Review the refreshed draft and previews, then approve again.',
      )
      continue
    }
    appliableDrafts.push(draftEntry)
    appliableDraftIds.push(draftEntry.draftId)
  }

  const subsetScriptSource = buildAnimationSequenceRecipe(draft, appliableBeatIds)

  if (blocked) {
    warnings.push(
      'Stale proposal — relevant live changes block stale work until analysis and previews are refreshed and reviewed again; blocked beats stay unapplied.',
    )
  }
  if (needsReview) {
    warnings.push('Refreshed analysis and previews require renewed review before approval.')
  }
  if (appliableBeats.length > 0 || appliableDrafts.length > 0) {
    warnings.push(
      'One approved batch is one Transaction with one undo entry; persistence uses the existing Save flow — nothing is saved implicitly.',
    )
  } else {
    warnings.push(
      'Nothing appliable in this batch — blocked, rejected, stale, or dependency-incomplete work remains unapplied and unapproved work is never included.',
    )
  }

  const appliable = appliableBeats.length > 0 || appliableDrafts.length > 0
  return {
    appliableBeats,
    appliableBeatIds,
    skippedBeats,
    appliableDrafts,
    appliableDraftIds,
    skippedDrafts,
    subsetScriptSource,
    warnings,
    summary: {
      totalBeats: beats.length,
      appliableBeats: appliableBeats.length,
      skippedBeats: skippedBeats.length,
      totalDrafts: drafts.length,
      appliableDrafts: appliableDrafts.length,
      skippedDrafts: skippedDrafts.length,
    },
    appliable,
    blocked,
    needsReview,
    approvable: revalidationApprovable && appliable,
    note: APPLY_NOTE,
  }
}

export interface AnimationApplyDryRunError {
  readonly beatId?: string
  readonly draftId?: string
  readonly message: string
}

export interface AnimationApplyDryRunResult {
  readonly ok: boolean
  readonly errors: readonly AnimationApplyDryRunError[]
  readonly fingerprint: string
}

function resolveDraftShapeId(
  engine: EnginePublic,
  draftEntry: ShapeDraft,
): { shapeId: string | null; error: string | null } {
  let shapes: readonly { id: string; name: string }[]
  try {
    shapes = engine.getShapes(draftEntry.nodeId)
  } catch {
    return {
      shapeId: null,
      error:
        `Shape draft "${draftEntry.draftId}" is stale — target [${draftEntry.nodeId}] no longer exists in the live Project. ` +
        'Re-run analysis and review again; stale work remains unapplied.',
    }
  }
  const hit = shapes.find((shape) => shape.name === draftEntry.sourceShapeName)
  if (!hit) {
    return {
      shapeId: null,
      error:
        `Shape draft "${draftEntry.draftId}" is stale — closest-fit Shape "${draftEntry.sourceShapeName ?? 'none'}" ` +
        'no longer exists on the live target. Re-run analysis and review again; stale work remains unapplied.',
    }
  }
  return { shapeId: hit.id, error: null }
}

/**
 * Client dry-run: validate the approved batch against the live engine without
 * mutating it — duplicate validations in order plus the retained-script Check.
 */
export function dryRunAnimationApply(
  engine: EnginePublic,
  slideId: string,
  plan: AnimationApplyPlan,
): AnimationApplyDryRunResult {
  const fingerprint = computeProjectFingerprint(engine)
  const errors: AnimationApplyDryRunError[] = []
  if (!plan.appliable) {
    errors.push({
      message:
        'Nothing appliable in this batch — approve at least one valid beat or accepted Shape draft; ' +
        'blocked, rejected, stale, or dependency-incomplete work remains unapplied. Fix the selection and re-validate before anything executes.',
    })
    return { ok: false, errors, fingerprint }
  }
  if (!plan.approvable) {
    errors.push({
      message: plan.blocked
        ? 'Stale proposal — relevant live changes block this batch until analysis and previews are refreshed and reviewed again. ' +
          'Refresh, review again, then re-validate before anything executes.'
        : 'Renewed review required — review the refreshed draft, dependencies, replacement scope, and labelled previews, ' +
          'then approve again. Nothing executes before review.',
    })
    return { ok: false, errors, fingerprint }
  }

  const internal = engine as unknown as import('../engine/internal').Engine
  for (const draftEntry of plan.appliableDrafts) {
    const resolved = resolveDraftShapeId(engine, draftEntry)
    if (resolved.shapeId === null) {
      errors.push({ draftId: draftEntry.draftId, message: resolved.error ?? 'Stale Shape draft.' })
      continue
    }
    try {
      new DuplicateShapeCommand({ nodeId: draftEntry.nodeId, shapeId: resolved.shapeId }).validate(
        internal,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({
        draftId: draftEntry.draftId,
        message:
          `Shape draft "${draftEntry.draftId}" failed dry-run validate(): ${message} ` +
          'Fix it and re-validate before anything executes.',
      })
    }
  }

  if (plan.appliableBeatIds.length > 0) {
    let compiled: ReturnType<typeof checkAnimationScript> | null = null
    try {
      compiled = checkAnimationScript(engine, slideId, plan.subsetScriptSource)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({
        message:
          `Approved beats failed script Check: ${message} ` +
          'Fix the proposal and re-validate before anything executes.',
      })
      return { ok: false, errors, fingerprint }
    }
    const diagnostics = compiled.diagnostics.filter((entry) => entry.severity === 'error')
    for (const diagnostic of diagnostics) {
      errors.push({ message: `Approved beats failed script Check: ${diagnostic.message}` })
    }
    if (!compiled.runnable) {
      errors.push({
        message:
          'Approved beats are not runnable — the retained script Check blocked the compile. ' +
          'Fix the proposal and re-validate before anything executes.',
      })
    }
    if (
      compiled.creations.nodes.some((created) => (created as { mesh?: unknown }).mesh !== undefined)
    ) {
      errors.push({
        message:
          'This batch generates meshes — run it with the async mesh path. ' +
          'Nothing executes on this path before that.',
      })
    }
  }

  return { ok: errors.length === 0, errors, fingerprint }
}

export interface AnimationApplyExecutionResult {
  readonly ok: boolean
  readonly appliedBeatIds: readonly string[]
  readonly appliedDraftIds: readonly string[]
  readonly skippedBeatIds: readonly string[]
  readonly skippedDraftIds: readonly string[]
  readonly historyEntryId?: string
  readonly error?: string
}

type ApplySystem = Pick<CommandSystem, 'dispatcher' | 'undoStack'> & { engine: EnginePublic }

/**
 * Execute the approved batch as one Transaction with one History Entry
 * (source `'ai'`). A failed batch rolls back fully with no partial history.
 * The active Project changes in memory; persistence uses the existing Save
 * flow — this never saves implicitly.
 */
export function applyAnimationBatch(
  system: ApplySystem,
  slideId: string,
  plan: AnimationApplyPlan,
): AnimationApplyExecutionResult {
  const skippedBeatIds = plan.skippedBeats.map((entry) => entry.beatId)
  const skippedDraftIds = plan.skippedDrafts.map((entry) => entry.draftId)
  if (!plan.appliable || !plan.approvable) {
    const error = plan.blocked
      ? 'Stale proposal — relevant live changes block this batch until analysis and previews are refreshed and reviewed again. Nothing executed; blocked work remains unapplied.'
      : plan.needsReview
        ? 'Renewed review required — review the refreshed draft and previews, then approve again. Nothing executed.'
        : 'Nothing appliable in this batch — approve at least one valid beat or accepted Shape draft. Nothing executed; unapproved work is never included.'
    return {
      ok: false,
      appliedBeatIds: [],
      appliedDraftIds: [],
      skippedBeatIds,
      skippedDraftIds,
      error,
    }
  }

  // Live validation immediately before execution — mirrors the dry-run gate so
  // a project edit between review and approval cannot silently apply.
  const dryRun = dryRunAnimationApply(system.engine, slideId, plan)
  if (!dryRun.ok) {
    const error = dryRun.errors[0]?.message ?? 'Dry-run validation failed. Nothing executed.'
    return {
      ok: false,
      appliedBeatIds: [],
      appliedDraftIds: [],
      skippedBeatIds,
      skippedDraftIds,
      error,
    }
  }

  const duplicates: DuplicateShapeCommand[] = []
  for (const draftEntry of plan.appliableDrafts) {
    const resolved = resolveDraftShapeId(system.engine, draftEntry)
    if (resolved.shapeId === null) {
      return {
        ok: false,
        appliedBeatIds: [],
        appliedDraftIds: [],
        skippedBeatIds,
        skippedDraftIds,
        error: resolved.error ?? 'Stale Shape draft. Nothing executed.',
      }
    }
    duplicates.push(
      new DuplicateShapeCommand({ nodeId: draftEntry.nodeId, shapeId: resolved.shapeId }),
    )
  }

  const commands: Command<unknown>[] = [...duplicates]
  if (plan.appliableBeatIds.length > 0) {
    const compiled = checkAnimationScript(system.engine, slideId, plan.subsetScriptSource)
    if (!compiled.runnable) {
      return {
        ok: false,
        appliedBeatIds: [],
        appliedDraftIds: [],
        skippedBeatIds,
        skippedDraftIds,
        error:
          'Approved beats are not runnable — the retained script Check blocked the compile. Nothing executed.',
      }
    }
    const previousFootprint = system.engine.getSlide(slideId).animationScript?.lastCompiled ?? null
    const replacedEffectIds = new Set([
      ...(previousFootprint?.effectIds ?? []),
      ...(compiled.footprint.effectIds ?? []),
    ])
    const replacedAudioClipIds = new Set([
      ...(previousFootprint?.audioClipIds ?? []),
      ...(compiled.footprint.audioClipIds ?? []),
    ])
    const existingClipIds = new Set(
      system.engine.getSlide(slideId).audio.clips.map((clip) => clip.id),
    )
    const deleteAudioCommands: Command<unknown>[] = []
    for (const clipId of replacedAudioClipIds) {
      if (!existingClipIds.has(clipId)) continue
      deleteAudioCommands.push(new DeleteAudioClipCommand({ slideId, clipId }))
    }
    const createAudioCommands: Command<unknown>[] = compiled.audioClips.map(
      (clip) =>
        new CreateAudioClipCommand({
          id: clip.id,
          slideId,
          assetId: clip.assetId,
          trackId: 'sfx',
          timelineStart: clip.timelineStart,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          playbackRate: 1,
        }) as Command<unknown>,
    )
    commands.push(
      new SetSlideAnimationScriptCommand({ slideId, source: plan.subsetScriptSource }),
      ...animationScriptClearCommands(system.engine, previousFootprint, compiled.footprint),
      ...deleteAudioCommands,
      ...createAudioCommands,
      ...compiled.commands,
      new SetSlideSceneEffectsCommand({
        slideId,
        effects: [
          ...system.engine
            .getSlide(slideId)
            .effects.filter((effect) => !replacedEffectIds.has(effect.id)),
          ...compiled.effects,
        ],
      }),
      new SetSlideAnimationScriptFootprintCommand({
        slideId,
        footprint: compiledFootprintToJSON(compiled.footprint),
      }),
    )
  }

  if (commands.length === 0) {
    return {
      ok: false,
      appliedBeatIds: [],
      appliedDraftIds: [],
      skippedBeatIds,
      skippedDraftIds,
      error: 'Nothing appliable in this batch. Nothing executed.',
    }
  }

  const before = system.undoStack.entries.length
  const result = system.dispatcher.dispatch(new TransactionCommand(commands), 'ai')
  if (result.ok) {
    const top = system.undoStack.entries[0]
    const expected = before + 1
    if (system.undoStack.entries.length !== expected || top?.type !== 'Transaction') {
      return {
        ok: false,
        appliedBeatIds: [],
        appliedDraftIds: [],
        skippedBeatIds,
        skippedDraftIds,
        error: 'Execution did not record exactly one History Entry.',
      }
    }
    return {
      ok: true,
      appliedBeatIds: [...plan.appliableBeatIds],
      appliedDraftIds: [...plan.appliableDraftIds],
      skippedBeatIds,
      skippedDraftIds,
      historyEntryId: top.id,
    }
  }
  return {
    ok: false,
    appliedBeatIds: [],
    appliedDraftIds: [],
    skippedBeatIds,
    skippedDraftIds,
    error: result.error.message,
  }
}
