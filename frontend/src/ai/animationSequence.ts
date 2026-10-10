import type { BeatAnalysis } from './animationAnalysis'
import type { RenderedView } from './renderedViews'

/**
 * Ordered Scene Animation Sequence composition (issues #442, #443).
 *
 * Pure and read-only: every result derives from the beat analysis (#440) and
 * the labelled rendered views (#441) plus Slide identity and the explicit
 * scene-travel / transition / Frozen Pose / alignment-offset requests (#443) —
 * never from pixels alone and never by mutating its inputs. Only
 * binding-compatible reusable Clip Collections count; name-only matches without
 * rig-binding overlap are never drafted. Blocked beats stay undrafted with the
 * precise reason while independent beats proceed. Per-beat, travel, transition,
 * frozen, and full-sequence previews are always labelled with Slide, time, and
 * stable Scene Node ids before anything is applied. The retained recipe is an
 * ordinary Animation Script source that compiles to ordinary timeline data —
 * never a runtime player.
 *
 * Character-local reusable motion (`.apply(collection)`) always stays separate
 * from scene-level travel (raw `.tween({ x, y, scaleX, scaleY })` keyframes) —
 * travel is never baked into reusable motion. Placements are sequential by
 * default; lane priority decides overlaps and never crossfades. Explicit
 * transitions are authored per gap and previewed; Frozen Poses hold the
 * coordinated character state with hold interpolation before, between, and
 * after beats. Visible child-part jumps between placements name the responsible
 * semantic part. Requested Clip Collection Alignment Offsets state their shared
 * shared-definition scope and are previewed across the collection before
 * approval — shared definitions are never silently mutated.
 */

/** Boundedness contract: one sequence covers a reviewable batch of beats. */
export const SEQUENCE_LIMITS = {
  maxBeats: 12,
  maxTravelLegs: 24,
  maxTransitions: 24,
  maxFrozenPoses: 24,
  maxAlignmentOffsets: 24,
} as const

/** Default scene-travel tween duration (seconds) when the request omits it. */
export const SEQUENCE_TRAVEL_DEFAULT_DURATION = 1
/** Frozen-hold gap (seconds) for implicit between-beat holds and explicit poses. */
export const SEQUENCE_FROZEN_HOLD_DURATION = 0.5
/** Default explicit hold-transition duration (seconds). */
export const SEQUENCE_TRANSITION_HOLD_DEFAULT = 0.5
/** Default explicit move-transition duration (seconds). */
export const SEQUENCE_TRANSITION_MOVE_DEFAULT = 1

/** Ease names the retained script may emit (mirrors the Animation Script vocabulary). */
const SEQUENCE_EASE_NAMES = [
  'hold',
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'quadratic',
  'cubic',
  'quartic',
  'quintic',
  'back',
  'bounce',
  'elastic',
  'spring',
] as const

export interface SequenceSnapshotNode {
  id: string
  name: string
}

export interface SequenceSnapshot {
  slideId: string | null
  slideName: string | null
  duration: number | null
  nodes: SequenceSnapshotNode[]
}

export interface SequenceInput {
  beats: readonly BeatAnalysis[]
  views: readonly RenderedView[]
  snapshot: SequenceSnapshot
  /** Scene-level travel legs (raw position/scale waypoints), one per beat target. */
  travel?: readonly SceneTravelLeg[]
  /** Explicit authored transitions between beats; gaps without one stay sequential. */
  transitions?: readonly ExplicitTransitionRequest[]
  /** Explicit Frozen Pose holds before/after draftable beats. */
  frozenPoses?: readonly FrozenPoseRequest[]
  /** Requested Clip Collection Alignment Offset adjustments to preview. */
  alignmentOffsets?: readonly AlignmentOffsetRequest[]
  /** Reusable collection inventory for alignment scope and jump evidence. */
  collections?: readonly SequenceCollectionInventory[]
}

export interface SceneTravelDestination {
  x: number
  y: number
  scaleX?: number | null
  scaleY?: number | null
}

export interface SceneTravelLeg {
  beatId: string
  targetNodeId: string
  to: SceneTravelDestination
  duration?: number | null
  ease?: string | null
}

export type ExplicitTransitionKind = 'cut' | 'hold' | 'move'

export interface ExplicitTransitionRequest {
  fromBeatId: string
  toBeatId: string
  kind: ExplicitTransitionKind
  duration?: number | null
}

export interface FrozenPoseRequest {
  beatId: string
  edge: 'before' | 'after'
}

export interface AlignmentOffsetRequest {
  collectionName: string
  semanticName: string
  x: number
  y: number
}

export interface SequenceCollectionInventory {
  name: string
  bindings: Record<string, string>
  alignmentOffsets?: Record<string, { x: number; y: number }>
  placementCount?: number | null
}

export type SequenceBeatStatus = 'draftable' | 'blocked'

export interface BeatTravelPlan {
  targetNodeId: string
  targetName: string
  to: { x: number; y: number; scaleX?: number; scaleY?: number }
  duration: number
  ease: string
}

export interface BeatTransitionPlan {
  kind: ExplicitTransitionKind
  toBeatId: string
  duration: number
  explicit: boolean
}

export interface SequenceBeatDraft {
  beatId: string
  label: string
  order: number
  status: SequenceBeatStatus
  /** Chosen reusable collection (first binding-compatible candidate); null when blocked. */
  collectionId: string | null
  collectionName: string | null
  matchedSemantics: string[]
  targetNodeIds: string[]
  targetNames: Record<string, string>
  /** Ready rendered views whose stable ids overlap this beat's targets. */
  previewViewIds: string[]
  /** Scene-level travel legs for this beat — raw keyframes, separate from `.apply()`. */
  travel: BeatTravelPlan[]
  /** Frozen Pose holds around this beat (hold interpolation; never a pose asset). */
  frozenBefore: boolean
  frozenAfter: boolean
  /** Explicit or implicit sequential transition out of this beat; null on the last draftable. */
  transitionAfter: BeatTransitionPlan | null
  /** Visible child-part jump risks on the handoff into this beat. */
  jumps: string[]
  /** Shared-scope notes for requested alignment offsets affecting this beat's collection. */
  alignmentNotes: string[]
  dependencies: string[]
  assumptions: string[]
  warnings: string[]
  blockers: string[]
  actions: string[]
}

export type SequencePreviewKind = 'beat' | 'travel' | 'frozen' | 'transition' | 'jump' | 'sequence'

export interface SequencePreview {
  /** Null marks the full-sequence preview; otherwise the beat it previews. */
  beatId: string | null
  kind: SequencePreviewKind
  label: string
  slideId: string
  slideName: string
  time: number
  nodeIds: string[]
  nodeNames: Record<string, string>
}

export interface SequenceSummary {
  total: number
  draftable: number
  blocked: number
}

export interface SequenceTransitionPlan {
  fromBeatId: string
  toBeatId: string
  kind: ExplicitTransitionKind
  duration: number
  explicit: boolean
  label: string
}

export interface SequenceFrozenPlan {
  beatId: string
  edge: 'before' | 'after'
  time: number
  label: string
  nodeIds: string[]
  nodeNames: Record<string, string>
}

export interface SequenceAlignmentEffect {
  collectionName: string
  semanticName: string
  x: number
  y: number
  /** Shared-definition scope: every placement of the collection moves together. */
  scope: string
  affectedPlacements: number | null
  label: string
}

export interface SequenceDraft {
  beats: SequenceBeatDraft[]
  previews: SequencePreview[]
  /** Resolved sequential transitions (explicit authored + implicit sequential cuts). */
  transitions: SequenceTransitionPlan[]
  /** Resolved Frozen Pose holds (explicit before/after + implicit between-beat holds). */
  frozen: SequenceFrozenPlan[]
  /** Requested alignment-offset effects with their shared-definition scope. */
  alignmentEffects: SequenceAlignmentEffect[]
  /** Retained Animation Script recipe — compiles to ordinary timeline data. */
  scriptSource: string
  warnings: string[]
  summary: SequenceSummary
  note: string
}

export const SEQUENCE_NOTE =
  'Sequence previews complement structured project data — identity and relationships come ' +
  'from stable Scene Node ids, hierarchy, and names in the Context Snapshot, never from pixels. ' +
  'Character-local reusable motion stays separate from scene-level travel; placements are sequential ' +
  'with lane priority (never a crossfade); Frozen Poses hold with hold interpolation; ' +
  'alignment offsets are shared by their collection placements. ' +
  'The retained Animation Script compiles to ordinary timeline data; there is no runtime player.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatTravelRecord(to: {
  x: number
  y: number
  scaleX?: number
  scaleY?: number
}): string {
  const parts = [`x: ${to.x}`, `y: ${to.y}`]
  if (typeof to.scaleX === 'number') parts.push(`scaleX: ${to.scaleX}`)
  if (typeof to.scaleY === 'number') parts.push(`scaleY: ${to.scaleY}`)
  return `{ ${parts.join(', ')} }`
}

/** Bounded slice with a reviewable-batch warning when truncated. */
function capRequests<T>(
  requests: readonly T[] | undefined | null,
  limit: number,
  warning: string,
  requestWarnings: string[],
): T[] {
  const list = Array.isArray(requests) ? [...requests] : []
  const capped = list.slice(0, limit)
  if (list.length > capped.length) requestWarnings.push(warning)
  return capped
}

function formatTime(time: number): string {
  return Number(time.toFixed(2)).toString()
}

function escapeScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function toAliasBase(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = cleaned || 'target'
  return /^[0-9]/.test(base) ? `n_${base}` : base
}

function uniqueAlias(base: string, used: Set<string>): string {
  const candidate = toAliasBase(base)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  let index = 2
  while (used.has(`${candidate}_${index}`)) index += 1
  const unique = `${candidate}_${index}`
  used.add(unique)
  return unique
}

function beatTime(order: number, duration: number | null): number {
  const raw = order * 2
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
    return Math.min(raw, duration)
  }
  return raw
}

function formatNodes(nodeIds: readonly string[], names: Readonly<Record<string, string>>): string {
  if (nodeIds.length === 0) return 'no scene nodes'
  return nodeIds
    .map((id) => {
      const name = names[id]
      return typeof name === 'string' && name ? `${name} [${id}]` : `[${id}]`
    })
    .join(', ')
}

function coveringViews(targetIds: readonly string[], views: readonly RenderedView[]): string[] {
  const targets = new Set(targetIds)
  const out: string[] = []
  for (const view of views) {
    if (view.status !== 'ready') continue
    if (view.nodeIds.some((id) => targets.has(id))) {
      if (typeof view.requestId === 'string' && view.requestId) out.push(view.requestId)
    }
  }
  return [...new Set(out)]
}

function blockedReason(beat: BeatAnalysis): { blockers: string[]; actions: string[] } {
  switch (beat.status) {
    case 'needs-clarification':
      return {
        blockers: [
          beat.question
            ? `Ambiguous target — ${beat.question}`
            : 'Ambiguous target — reply with the stable Scene Node id before drafting.',
        ],
        actions: [
          'Reply with the stable Scene Node id for this beat and re-run analysis; the beat stays undrafted until the target is unambiguous.',
        ],
      }
    case 'missing-motion':
      return {
        blockers: [
          'No compatible reusable motion for this beat on the resolved target — similarly named library entries without binding overlap do not count.',
        ],
        actions:
          beat.actions.length > 0
            ? [...beat.actions]
            : ['Author new motion or approve a draft; then re-run analysis.'],
      }
    case 'missing-prerequisite':
      return {
        blockers:
          beat.prerequisites.length > 0
            ? [...beat.prerequisites]
            : ['A scene prerequisite blocks this beat.'],
        actions:
          beat.actions.length > 0
            ? [...beat.actions]
            : ['Supply the missing prerequisite in the live Project and re-run analysis.'],
      }
    case 'invalid':
    default:
      return {
        blockers: ['Invalid beat — it needs a precise fix before it can be drafted.'],
        actions:
          beat.actions.length > 0
            ? [...beat.actions]
            : ['Give this beat a label, a target Scene Node, and a described motion.'],
      }
  }
}

/**
 * Compose an ordered, previewable Scene Animation Sequence from beat analysis
 * and labelled rendered views. Read-only: inputs are only read, never written.
 */
export function composeSequence(input: SequenceInput): SequenceDraft {
  const beats = Array.isArray(input.beats) ? [...input.beats] : []
  const views = Array.isArray(input.views) ? [...input.views] : []
  const snapshot = input.snapshot
  const capped = beats.slice(0, SEQUENCE_LIMITS.maxBeats)
  const truncated = beats.length > capped.length

  const slideId = typeof snapshot?.slideId === 'string' ? snapshot.slideId : ''
  const slideName = typeof snapshot?.slideName === 'string' ? snapshot.slideName : ''
  const duration =
    typeof snapshot?.duration === 'number' && Number.isFinite(snapshot.duration)
      ? snapshot.duration
      : null
  const nameById = new Map<string, string>()
  for (const node of snapshot?.nodes ?? []) {
    if (typeof node?.id === 'string' && typeof node?.name === 'string') {
      nameById.set(node.id, node.name)
    }
  }

  if (capped.length === 0) {
    return {
      beats: [],
      previews: [],
      transitions: [],
      frozen: [],
      alignmentEffects: [],
      scriptSource: [
        'script "Scene Animation Sequence" from 0',
        '// No beats requested - nothing to draft.',
      ].join('\n'),
      warnings: [
        'No requested actions yet — describe the performance (one coherent action per beat) and each beat will be analyzed before anything is drafted.',
      ],
      summary: { total: 0, draftable: 0, blocked: 0 },
      note: SEQUENCE_NOTE,
    }
  }

  const drafts: SequenceBeatDraft[] = capped.map((beat, order) => {
    const label = trimText(beat.label) || beat.beatId
    const targetNodeIds = Array.isArray(beat.resolvedNodeIds) ? [...beat.resolvedNodeIds] : []
    const targetNames: Record<string, string> = {}
    for (const id of targetNodeIds) {
      const name = nameById.get(id)
      if (typeof name === 'string') targetNames[id] = name
    }
    const unknownIds = targetNodeIds.filter((id) => !nameById.has(id))
    const previewViewIds = coveringViews(targetNodeIds, views)

    // Stale analysis: the resolved target no longer exists in the live scene.
    if (targetNodeIds.length > 0 && unknownIds.length > 0) {
      const reason = blockedReason(beat)
      return {
        beatId: beat.beatId,
        label: beat.label,
        order,
        status: 'blocked',
        collectionId: null,
        collectionName: null,
        matchedSemantics: [],
        targetNodeIds,
        targetNames,
        previewViewIds,
        travel: [],
        frozenBefore: false,
        frozenAfter: false,
        transitionAfter: null,
        jumps: [],
        alignmentNotes: [],
        dependencies: [...beat.prerequisites],
        assumptions: [],
        warnings: [...beat.warnings],
        blockers: [
          `Stale target — ${unknownIds.map((id) => `[${id}]`).join(', ')} no longer exists in the live scene; the analysis is outdated and nothing is guessed.`,
          ...reason.blockers,
        ],
        actions: ['Re-run analysis against the live Project and review the refreshed draft.'],
        // Keep the status-specific question for disambiguation context.
      }
    }

    if (beat.status !== 'ready' || beat.reusable.length === 0) {
      const reason = blockedReason(beat)
      return {
        beatId: beat.beatId,
        label: beat.label,
        order,
        status: 'blocked',
        collectionId: null,
        collectionName: null,
        matchedSemantics: [],
        targetNodeIds,
        targetNames,
        previewViewIds,
        travel: [],
        frozenBefore: false,
        frozenAfter: false,
        transitionAfter: null,
        jumps: [],
        alignmentNotes: [],
        dependencies: [...beat.prerequisites],
        assumptions: [],
        warnings: [...beat.warnings],
        blockers: reason.blockers,
        actions: reason.actions,
      }
    }

    const chosen = beat.reusable[0]
    const warnings = [...beat.warnings]
    if (previewViewIds.length === 0) {
      const targets = targetNodeIds.length > 0 ? formatNodes(targetNodeIds, targetNames) : label
      warnings.push(
        `No labelled rendered preview yet covers ${targets} — request a focused view at the beat time before approving; binding compatibility alone is not visual proof.`,
      )
    }
    const dependencies = [...beat.prerequisites]
    if (order > 0) {
      const previous = capped[order - 1]
      const previousLabel = trimText(previous?.label) || previous?.beatId || `beat ${order}`
      dependencies.push(
        `After beat "${previousLabel}" — placements are sequential; lane priority does not crossfade.`,
      )
    }
    const assumptions = [
      'Reusable fit is binding evidence (rig Semantic Names overlap the target subtree), not a name inference.',
      previewViewIds.length > 0
        ? `Visual fit is evidenced by labelled view(s) ${previewViewIds.map((id) => `"${id}"`).join(', ')} — structured snapshot identity stays authoritative over pixels.`
        : 'Visual fit is not yet evidenced — a labelled focused preview is required before approval.',
      'Scene travel (if any) is authored as separate scene-level position/scale keyframes — never baked into character-local motion.',
      'Pauses hold the coordinated pose with hold interpolation — handoffs never reveal the default pose.',
    ]

    return {
      beatId: beat.beatId,
      label: beat.label,
      order,
      status: 'draftable',
      collectionId: chosen.collectionId,
      collectionName: chosen.collectionName,
      matchedSemantics: [...chosen.matchedSemantics],
      targetNodeIds,
      targetNames,
      previewViewIds,
      travel: [],
      frozenBefore: false,
      frozenAfter: false,
      transitionAfter: null,
      jumps: [],
      alignmentNotes: [],
      dependencies,
      assumptions,
      warnings,
      blockers: [],
      actions:
        previewViewIds.length === 0
          ? [
              `Request a focused rendered view of ${formatNodes(targetNodeIds, targetNames)} at the beat time, then approve.`,
            ]
          : [],
    }
  })

  const draftable = drafts.filter((beat) => beat.status === 'draftable')
  const draftableById = new Map(drafts.map((beat) => [beat.beatId, beat] as const))
  const total = drafts.length
  const requestWarnings: string[] = []

  // --- Scene travel (#443): raw position/scale waypoints per draftable beat. ---
  const cappedTravel = capRequests(
    input.travel,
    SEQUENCE_LIMITS.maxTravelLegs,
    `Travel covers the first ${SEQUENCE_LIMITS.maxTravelLegs} legs — describe fewer waypoints per batch so every leg stays reviewable.`,
    requestWarnings,
  )
  for (const leg of cappedTravel) {
    const beatId = trimText((leg as SceneTravelLeg | null)?.beatId)
    const targetNodeId = trimText((leg as SceneTravelLeg | null)?.targetNodeId)
    const to = (leg as SceneTravelLeg | null)?.to
    const draft = beatId ? draftableById.get(beatId) : undefined
    if (!draft || draft.status !== 'draftable') {
      requestWarnings.push(
        beatId
          ? `No travel drafted for beat "${beatId}" — it is unknown or blocked (undrafted); travel never guesses a target.`
          : 'No travel drafted — a travel leg needs a drafted beat id and a stable Scene Node id.',
      )
      continue
    }
    if (!targetNodeId || !nameById.has(targetNodeId)) {
      requestWarnings.push(
        `No travel drafted for beat "${draft.label}" — unknown Scene Node [${targetNodeId || 'none'}]; check the stable id in the Context Snapshot.`,
      )
      continue
    }
    const x = (to as SceneTravelDestination | null)?.x
    const y = (to as SceneTravelDestination | null)?.y
    const scaleX = (to as SceneTravelDestination | null)?.scaleX ?? null
    const scaleY = (to as SceneTravelDestination | null)?.scaleY ?? null
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      requestWarnings.push(
        `No travel drafted for beat "${draft.label}" — the destination needs finite x and y scene coordinates.`,
      )
      continue
    }
    if (
      (scaleX !== null && scaleX !== undefined && !isFiniteNumber(scaleX)) ||
      (scaleY !== null && scaleY !== undefined && !isFiniteNumber(scaleY))
    ) {
      requestWarnings.push(
        `No travel drafted for beat "${draft.label}" — scaleX/scaleY must be finite when provided.`,
      )
      continue
    }
    const rawDuration = (leg as SceneTravelLeg | null)?.duration
    let travelDuration = SEQUENCE_TRAVEL_DEFAULT_DURATION
    if (rawDuration === null || rawDuration === undefined) {
      travelDuration = SEQUENCE_TRAVEL_DEFAULT_DURATION
    } else if (isFiniteNumber(rawDuration) && rawDuration > 0) {
      travelDuration = rawDuration
    } else {
      requestWarnings.push(
        `Travel for beat "${draft.label}" needs a duration over 0s — using ${SEQUENCE_TRAVEL_DEFAULT_DURATION}s instead; nothing is guessed beyond the default.`,
      )
      travelDuration = SEQUENCE_TRAVEL_DEFAULT_DURATION
    }
    const rawEase = (leg as SceneTravelLeg | null)?.ease
    let ease = 'linear'
    if (rawEase === null || rawEase === undefined) {
      ease = 'linear'
    } else if (
      typeof rawEase === 'string' &&
      (SEQUENCE_EASE_NAMES as readonly string[]).includes(rawEase.trim())
    ) {
      ease = rawEase.trim()
    } else {
      requestWarnings.push(
        `Travel for beat "${draft.label}" names an unknown ease ${JSON.stringify(rawEase)} — using linear instead.`,
      )
      ease = 'linear'
    }
    if (ease === 'hold') {
      // Hold is a Frozen Pose interpolation, not travel easing: a hold-eased
      // tween would read as a jump, so travel falls back to linear.
      requestWarnings.push(
        `Travel for beat "${draft.label}" uses linear easing — hold is a Frozen Pose interpolation, not travel easing.`,
      )
      ease = 'linear'
    }
    const destination: { x: number; y: number; scaleX?: number; scaleY?: number } = { x, y }
    if (isFiniteNumber(scaleX)) destination.scaleX = scaleX
    if (isFiniteNumber(scaleY)) destination.scaleY = scaleY
    draft.travel.push({
      targetNodeId,
      targetName: nameById.get(targetNodeId) ?? targetNodeId,
      to: destination,
      duration: travelDuration,
      ease,
    })
  }

  // --- Explicit transitions (#443): authored gaps only; otherwise sequential. ---
  const cappedTransitions = capRequests(
    input.transitions,
    SEQUENCE_LIMITS.maxTransitions,
    `Transitions cover the first ${SEQUENCE_LIMITS.maxTransitions} requests — describe fewer transitions per batch so every gap stays reviewable.`,
    requestWarnings,
  )
  const explicitByPair = new Map<string, { kind: ExplicitTransitionKind; duration: number }>()
  for (const request of cappedTransitions) {
    const fromBeatId = trimText((request as ExplicitTransitionRequest | null)?.fromBeatId)
    const toBeatId = trimText((request as ExplicitTransitionRequest | null)?.toBeatId)
    const kind = (request as ExplicitTransitionRequest | null)?.kind
    const from = fromBeatId ? draftableById.get(fromBeatId) : undefined
    const to = toBeatId ? draftableById.get(toBeatId) : undefined
    if (!from || !to) {
      requestWarnings.push(
        `No transition drafted from "${fromBeatId || 'none'}" to "${toBeatId || 'none'}" — it needs two drafted beat ids; unknown or blocked beats stay unlinked.`,
      )
      continue
    }
    if (from.status !== 'draftable' || to.status !== 'draftable') {
      requestWarnings.push(
        `No transition drafted from "${from.label}" to "${to.label}" — blocked (undrafted) beats cannot transition; resolve the blocker first.`,
      )
      continue
    }
    if (fromBeatId === toBeatId) {
      requestWarnings.push(
        `No transition drafted from "${from.label}" to itself — a transition links two different beats.`,
      )
      continue
    }
    if (kind !== 'cut' && kind !== 'hold' && kind !== 'move') {
      requestWarnings.push(
        `No transition drafted from "${from.label}" to "${to.label}" — kind must be "cut", "hold", or "move"; nothing is inferred.`,
      )
      continue
    }
    const rawDuration = (request as ExplicitTransitionRequest | null)?.duration
    let transitionDuration = 0
    if (kind === 'cut') {
      transitionDuration = 0
    } else if (rawDuration === null || rawDuration === undefined) {
      transitionDuration =
        kind === 'hold' ? SEQUENCE_TRANSITION_HOLD_DEFAULT : SEQUENCE_TRANSITION_MOVE_DEFAULT
    } else if (isFiniteNumber(rawDuration) && rawDuration > 0) {
      transitionDuration = rawDuration
    } else {
      transitionDuration =
        kind === 'hold' ? SEQUENCE_TRANSITION_HOLD_DEFAULT : SEQUENCE_TRANSITION_MOVE_DEFAULT
      requestWarnings.push(
        `Transition from "${from.label}" to "${to.label}" needs a duration over 0s — using ${formatTime(transitionDuration)}s instead.`,
      )
    }
    const key = `${fromBeatId}→${toBeatId}`
    if (explicitByPair.has(key)) {
      requestWarnings.push(
        `Duplicate transition from "${from.label}" to "${to.label}" — keeping the first; describe one transition per gap.`,
      )
      continue
    }
    explicitByPair.set(key, { kind, duration: transitionDuration })
  }

  const transitions: SequenceTransitionPlan[] = []
  for (let index = 0; index + 1 < draftable.length; index += 1) {
    const from = draftable[index]
    const to = draftable[index + 1]
    const key = `${from.beatId}→${to.beatId}`
    const explicit = explicitByPair.get(key)
    if (explicit) {
      const label =
        explicit.kind === 'cut'
          ? `Explicit cut from "${from.label}" to "${to.label}" — placements are sequential; lane priority does not crossfade.`
          : explicit.kind === 'hold'
            ? `Explicit hold transition from "${from.label}" to "${to.label}" (${formatTime(explicit.duration)}s) — frozen hold with hold interpolation; lane priority does not crossfade.`
            : `Explicit move transition from "${from.label}" to "${to.label}" (${formatTime(explicit.duration)}s) — scene-level travel continues; placements are sequential and lane priority does not crossfade.`
      transitions.push({
        fromBeatId: from.beatId,
        toBeatId: to.beatId,
        kind: explicit.kind,
        duration: explicit.duration,
        explicit: true,
        label,
      })
      from.transitionAfter = {
        kind: explicit.kind,
        toBeatId: to.beatId,
        duration: explicit.duration,
        explicit: true,
      }
    } else {
      transitions.push({
        fromBeatId: from.beatId,
        toBeatId: to.beatId,
        kind: 'cut',
        duration: 0,
        explicit: false,
        label: `Sequential placement — "${from.label}" then "${to.label}"; lane priority does not crossfade.`,
      })
      from.transitionAfter = { kind: 'cut', toBeatId: to.beatId, duration: 0, explicit: false }
    }
  }

  // --- Frozen Poses (#443): explicit before/after plus implicit between-holds. ---
  const cappedFrozen = capRequests(
    input.frozenPoses,
    SEQUENCE_LIMITS.maxFrozenPoses,
    `Frozen Poses cover the first ${SEQUENCE_LIMITS.maxFrozenPoses} requests — describe fewer holds per batch so every hold stays reviewable.`,
    requestWarnings,
  )
  const frozen: SequenceFrozenPlan[] = []
  const frozenKeys = new Set<string>()
  const pushFrozen = (beat: SequenceBeatDraft, edge: 'before' | 'after'): void => {
    const key = `${beat.beatId}:${edge}`
    if (frozenKeys.has(key)) return
    frozenKeys.add(key)
    if (edge === 'before') beat.frozenBefore = true
    else beat.frozenAfter = true
    const time = beatTime(beat.order, duration)
    const edgeWord = edge === 'before' ? 'before' : 'after'
    frozen.push({
      beatId: beat.beatId,
      edge,
      time,
      label:
        `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — ` +
        `frozen pose ${edgeWord} beat ${beat.order + 1}/${total} "${beat.label}" ` +
        `(nodes: ${formatNodes(beat.targetNodeIds, beat.targetNames)}) with hold interpolation`,
      nodeIds: [...beat.targetNodeIds],
      nodeNames: { ...beat.targetNames },
    })
  }
  // Implicit between-beat holds: one frozen entry per consecutive draftable gap,
  // except behind an explicit cut — a hard cut carries no hold by definition.
  for (let index = 0; index + 1 < draftable.length; index += 1) {
    const from = draftable[index]
    const to = draftable[index + 1]
    if (explicitByPair.get(`${from.beatId}→${to.beatId}`)?.kind === 'cut') continue
    from.frozenAfter = true
    to.frozenBefore = true
    const key = `${to.beatId}:before`
    if (!frozenKeys.has(key)) {
      frozenKeys.add(key)
      const time = beatTime(to.order, duration)
      frozen.push({
        beatId: to.beatId,
        edge: 'before',
        time,
        label:
          `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — ` +
          `frozen pose before beat ${to.order + 1}/${total} "${to.label}" ` +
          `(nodes: ${formatNodes(to.targetNodeIds, to.targetNames)}) with hold interpolation`,
        nodeIds: [...to.targetNodeIds],
        nodeNames: { ...to.targetNames },
      })
    }
  }
  for (const request of cappedFrozen) {
    const beatId = trimText((request as FrozenPoseRequest | null)?.beatId)
    const edge = (request as FrozenPoseRequest | null)?.edge
    const draft = beatId ? draftableById.get(beatId) : undefined
    if (!draft || draft.status !== 'draftable') {
      requestWarnings.push(
        beatId
          ? `No Frozen Pose drafted for beat "${beatId}" — it is unknown or blocked (undrafted); holds never guess a target.`
          : 'No Frozen Pose drafted — a hold needs a drafted beat id and an edge ("before" or "after").',
      )
      continue
    }
    if (edge !== 'before' && edge !== 'after') {
      requestWarnings.push(
        `No Frozen Pose drafted for beat "${draft.label}" — edge must be "before" or "after".`,
      )
      continue
    }
    pushFrozen(draft, edge)
  }

  // --- Visible child-part jumps (#443): same rig, different collections. ---
  const jumpWarnings: string[] = []
  for (let index = 0; index + 1 < draftable.length; index += 1) {
    const from = draftable[index]
    const to = draftable[index + 1]
    if (!from.collectionName || !to.collectionName) continue
    if (from.collectionName === to.collectionName) continue
    const overlap = from.targetNodeIds.filter((id) => to.targetNodeIds.includes(id))
    if (overlap.length === 0) continue
    const lower = (values: readonly string[]): Set<string> =>
      new Set(values.map((value) => value.toLowerCase()))
    const fromLower = lower(from.matchedSemantics)
    const toLower = lower(to.matchedSemantics)
    const shared = [...toLower].filter((value) => fromLower.has(value))
    let responsible: string[]
    if (shared.length > 0) {
      // Display with the incoming beat's spelling when available.
      responsible = shared.map((value) => {
        const original = to.matchedSemantics.find((entry) => entry.toLowerCase() === value)
        return original ?? value
      })
    } else {
      const union = [...new Set([...from.matchedSemantics, ...to.matchedSemantics])]
      if (union.length === 0) continue
      responsible = union
    }
    responsible = [...new Set(responsible)].sort((a, b) => a.localeCompare(b))
    const parts = responsible.map((part) => `"${part}"`).join(', ')
    const message =
      `Visible child-part jump risk on ${parts} between "${from.collectionName}" and ` +
      `"${to.collectionName}" — placements are sequential with lane priority (no crossfade); ` +
      `review the responsible semantic part ${parts} and hold a Frozen Pose or request a ` +
      `Clip Collection Alignment Offset before approving.`
    to.jumps.push(message)
    to.warnings.push(message)
    to.actions.push(
      `Inspect the handoff on ${parts} between "${from.label}" and "${to.label}" before approving; add a Frozen Pose hold or request a Clip Collection Alignment Offset if the handoff jumps.`,
    )
    jumpWarnings.push(message)
  }

  // --- Clip Collection Alignment Offsets (#443): shared scope, previewed. ---
  const cappedOffsets = capRequests(
    input.alignmentOffsets,
    SEQUENCE_LIMITS.maxAlignmentOffsets,
    `Alignment offsets cover the first ${SEQUENCE_LIMITS.maxAlignmentOffsets} requests — describe fewer offsets per batch so every shared effect stays reviewable.`,
    requestWarnings,
  )
  const inventory = Array.isArray(input.collections) ? [...input.collections] : []
  const inventoryByName = new Map<string, SequenceCollectionInventory>()
  const inventoryByLower = new Map<string, SequenceCollectionInventory>()
  for (const entry of inventory) {
    const name = trimText((entry as SequenceCollectionInventory | null)?.name)
    if (!name || inventoryByName.has(name)) continue
    inventoryByName.set(name, entry as SequenceCollectionInventory)
    const lowered = name.toLowerCase()
    if (!inventoryByLower.has(lowered))
      inventoryByLower.set(lowered, entry as SequenceCollectionInventory)
  }
  const draftCountByCollection = new Map<string, number>()
  const canonicalByLower = new Map<string, string>()
  for (const beat of draftable) {
    if (!beat.collectionName) continue
    draftCountByCollection.set(
      beat.collectionName,
      (draftCountByCollection.get(beat.collectionName) ?? 0) + 1,
    )
    const lowered = beat.collectionName.toLowerCase()
    if (!canonicalByLower.has(lowered)) canonicalByLower.set(lowered, beat.collectionName)
  }
  const alignmentEffects: SequenceAlignmentEffect[] = []
  for (const request of cappedOffsets) {
    const collectionName = trimText((request as AlignmentOffsetRequest | null)?.collectionName)
    const semanticName = trimText((request as AlignmentOffsetRequest | null)?.semanticName)
    const x = (request as AlignmentOffsetRequest | null)?.x
    const y = (request as AlignmentOffsetRequest | null)?.y
    if (!collectionName || !semanticName) {
      requestWarnings.push(
        'No alignment offset drafted — each request needs a collection name and a semantic part name; shared definitions are never guessed.',
      )
      continue
    }
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      requestWarnings.push(
        `No alignment offset drafted for collection "${collectionName}" semantic "${semanticName}" — x and y must be finite scene units.`,
      )
      continue
    }
    const canonical =
      inventoryByName.get(collectionName)?.name ??
      inventoryByLower.get(collectionName.toLowerCase())?.name ??
      (draftCountByCollection.has(collectionName)
        ? collectionName
        : (canonicalByLower.get(collectionName.toLowerCase()) ?? null))
    if (canonical === null) {
      requestWarnings.push(
        `No alignment offset drafted — unknown collection "${collectionName}"; check the reusable collection name before previewing a shared change.`,
      )
      continue
    }
    const bindings: Record<string, string> =
      inventoryByName.get(canonical)?.bindings ??
      inventoryByLower.get(canonical.toLowerCase())?.bindings ??
      {}
    const bindingKeys = Object.keys(bindings)
    if (bindingKeys.length > 0) {
      const bound =
        bindingKeys.includes(semanticName) ||
        bindingKeys.some((key) => key.toLowerCase() === semanticName.toLowerCase())
      if (!bound) {
        requestWarnings.push(
          `Alignment offset for collection "${canonical}" semantic "${semanticName}" is not bound in that collection (bindings: ${bindingKeys.join(', ')}) — confirm the responsible semantic part before approving.`,
        )
      }
    }
    const inventoryCountRaw =
      inventoryByName.get(canonical)?.placementCount ??
      inventoryByLower.get(canonical.toLowerCase())?.placementCount ??
      null
    const inventoryCount =
      isFiniteNumber(inventoryCountRaw) && (inventoryCountRaw as number) >= 0
        ? Math.floor(inventoryCountRaw as number)
        : 0
    const draftCount = draftCountByCollection.get(canonical) ?? 0
    const affected = inventoryCount + draftCount
    const scope =
      `Shared Clip Collection definition — every placement of collection "${canonical}" ` +
      `moves together (${draftCount} in this draft plus existing timeline placements); ` +
      `never silently mutated — preview across the collection before approval via ` +
      `SetClipCollectionAlignmentOffsets.`
    const effect: SequenceAlignmentEffect = {
      collectionName: canonical,
      semanticName,
      x: x as number,
      y: y as number,
      scope,
      affectedPlacements: affected,
      label:
        `Alignment offset preview for collection "${canonical}" semantic "${semanticName}": ` +
        `(${x}, ${y}) — shared by every placement (${draftCount} in this draft plus existing ` +
        `timeline placements); preview across the collection before approval.`,
    }
    alignmentEffects.push(effect)
    const note =
      `Proposed Clip Collection Alignment Offset for collection "${canonical}" semantic ` +
      `"${semanticName}" (${x}, ${y}) is shared by all placements of "${canonical}" — preview ` +
      `across the collection before approval; shared definitions are never silently mutated.`
    for (const beat of draftable) {
      if (beat.collectionName === canonical) beat.alignmentNotes.push(note)
    }
  }

  // Labelled previews — available before anything is applied.
  const previews: SequencePreview[] = []
  if (slideId) {
    for (const beat of drafts) {
      const time = beatTime(beat.order, duration)
      const label =
        `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — ` +
        `beat ${beat.order + 1}/${total} "${beat.label}" preview ` +
        `(nodes: ${formatNodes(beat.targetNodeIds, beat.targetNames)})`
      previews.push({
        beatId: beat.beatId,
        kind: 'beat',
        label,
        slideId,
        slideName,
        time,
        nodeIds: [...beat.targetNodeIds],
        nodeNames: { ...beat.targetNames },
      })
    }
    // Travel previews: scene-level waypoints around character-local motion.
    for (const beat of draftable) {
      for (const leg of beat.travel) {
        const time = beatTime(beat.order, duration)
        const names: Record<string, string> = {}
        const legName = nameById.get(leg.targetNodeId)
        if (typeof legName === 'string') names[leg.targetNodeId] = legName
        const destination =
          `to (${leg.to.x}, ${leg.to.y}` +
          (typeof leg.to.scaleX === 'number' ? `, scale ${leg.to.scaleX}` : '') +
          (typeof leg.to.scaleY === 'number' ? ` × ${leg.to.scaleY}` : '') +
          ` over ${formatTime(leg.duration)}s)`
        previews.push({
          beatId: beat.beatId,
          kind: 'travel',
          label:
            `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — ` +
            `travel preview for beat ${beat.order + 1}/${total} "${beat.label}" ` +
            `(nodes: ${formatNodes([leg.targetNodeId], names)}) ${destination} — ` +
            `scene-level, separate from character-local motion`,
          slideId,
          slideName,
          time,
          nodeIds: [leg.targetNodeId],
          nodeNames: names,
        })
      }
    }
    // Frozen Pose previews: holds before, between, and after beats.
    for (const hold of frozen) {
      previews.push({
        beatId: hold.beatId,
        kind: 'frozen',
        label: `${hold.label} — preview before approval`,
        slideId,
        slideName,
        time: hold.time,
        nodeIds: [...hold.nodeIds],
        nodeNames: { ...hold.nodeNames },
      })
    }
    // Explicit transition previews: authored gaps only, never assumed crossfades.
    for (const entry of transitions) {
      if (!entry.explicit) continue
      const toBeat = draftableById.get(entry.toBeatId)
      const nodeIds = toBeat ? [...toBeat.targetNodeIds] : []
      const nodeNames = toBeat ? { ...toBeat.targetNames } : {}
      const time = toBeat ? beatTime(toBeat.order, duration) : 0
      previews.push({
        beatId: entry.toBeatId,
        kind: 'transition',
        label:
          `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — ` +
          `transition preview: ${entry.label} (nodes: ${formatNodes(nodeIds, nodeNames)})`,
        slideId,
        slideName,
        time,
        nodeIds,
        nodeNames,
      })
    }
    // Child-part jump previews: handoffs that may visibly jump, with the part.
    for (const beat of draftable) {
      if (beat.jumps.length === 0) continue
      const time = beatTime(beat.order, duration)
      for (const jump of beat.jumps) {
        previews.push({
          beatId: beat.beatId,
          kind: 'jump',
          label:
            `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — ` +
            `child-part jump preview for beat ${beat.order + 1}/${total} "${beat.label}" ` +
            `(nodes: ${formatNodes(beat.targetNodeIds, beat.targetNames)}): ${jump}`,
          slideId,
          slideName,
          time,
          nodeIds: [...beat.targetNodeIds],
          nodeNames: { ...beat.targetNames },
        })
      }
    }
    const sequenceNodeIds = [...new Set(draftable.flatMap((beat) => beat.targetNodeIds))]
    const sequenceNames: Record<string, string> = {}
    for (const id of sequenceNodeIds) {
      const name = nameById.get(id)
      if (typeof name === 'string') sequenceNames[id] = name
    }
    previews.push({
      beatId: null,
      kind: 'sequence',
      label:
        `Slide "${slideName}" [${slideId}] @ ${formatTime(0)}s — ` +
        `full sequence preview (${draftable.length} of ${total} beats, ` +
        `nodes: ${formatNodes(sequenceNodeIds, sequenceNames)})`,
      slideId,
      slideName,
      time: 0,
      nodeIds: sequenceNodeIds,
      nodeNames: sequenceNames,
    })
  }

  // Retained Animation Script recipe — ordinary timeline data on Run.
  const lines: string[] = []
  lines.push('script "Scene Animation Sequence" from 0')
  lines.push(
    '// Retained recipe - compiles to ordinary timeline keyframes, clip instances, and placements.',
  )
  lines.push(
    '// Beat order is the approval order - placements are sequential; lane priority does not crossfade.',
  )
  lines.push(
    '// Character-local motion comes from reusable Clip Collections; scene travel stays as separate scene-level raw keyframes.',
  )
  lines.push(
    '// Frozen holds use hold interpolation between beats - pauses never reveal the default pose.',
  )
  const usedAliases = new Set<string>()
  const targetAliasById = new Map<string, string>()
  const collectionAliasByName = new Map<string, string>()
  const travelNameById = new Map<string, string>()
  for (const beat of draftable) {
    for (const leg of beat.travel) {
      if (!travelNameById.has(leg.targetNodeId))
        travelNameById.set(leg.targetNodeId, leg.targetName)
    }
  }
  const ensureTargetAlias = (id: string): string => {
    const existing = targetAliasById.get(id)
    if (existing) return existing
    const sameBeat = draftable.find((beat) => beat.targetNodeIds.includes(id))
    const baseName = sameBeat?.targetNames[id] ?? travelNameById.get(id) ?? nameById.get(id) ?? id
    const alias = uniqueAlias(`target_${baseName}`, usedAliases)
    targetAliasById.set(id, alias)
    return alias
  }
  for (const beat of draftable) {
    for (const id of beat.targetNodeIds) ensureTargetAlias(id)
    for (const leg of beat.travel) ensureTargetAlias(leg.targetNodeId)
    const collectionName = beat.collectionName ?? ''
    if (collectionName && !collectionAliasByName.has(collectionName)) {
      collectionAliasByName.set(
        collectionName,
        uniqueAlias(`motion_${collectionName}`, usedAliases),
      )
    }
  }
  for (const [id, alias] of targetAliasById) {
    const name = nameById.get(id) ?? id
    lines.push(`bind ${alias} = node("${escapeScriptString(name)}")`)
  }
  for (const [name, alias] of collectionAliasByName) {
    lines.push(`bind ${alias} = collection("${escapeScriptString(name)}")`)
  }
  const explicitTransitionByPair = new Map<string, SequenceTransitionPlan>(
    transitions
      .filter((entry) => entry.explicit)
      .map((entry) => [`${entry.fromBeatId}→${entry.toBeatId}`, entry]),
  )
  const jumpByBeatId = new Map<string, string[]>()
  for (const beat of draftable) {
    if (beat.jumps.length > 0) jumpByBeatId.set(beat.beatId, [...beat.jumps])
  }
  const draftableIds = new Set(draftable.map((beat) => beat.beatId))
  let previousDraftable: SequenceBeatDraft | null = null
  drafts.forEach((beat, index) => {
    const position = `Beat ${index + 1}/${total} "${beat.label}"`
    if (beat.status !== 'draftable' || beat.collectionName === null) {
      const reason = beat.blockers[0] ?? `blocked (${beat.beatId})`
      lines.push(`// ${position} omitted - blocked: ${reason}`)
      for (const action of beat.actions) lines.push(`// Next step: ${action}`)
      return
    }
    // Gap before this beat: explicit authored transition or implicit frozen hold.
    if (previousDraftable !== null) {
      const key = `${previousDraftable.beatId}→${beat.beatId}`
      const explicit = explicitTransitionByPair.get(key)
      if (explicit) {
        if (explicit.kind === 'cut') {
          lines.push(
            `// explicit cut from "${previousDraftable.label}" to "${beat.label}" — placements are sequential; lane priority does not crossfade`,
          )
        } else if (explicit.kind === 'hold') {
          lines.push(
            `wait(${formatTime(explicit.duration)}s) // explicit hold transition from "${previousDraftable.label}" to "${beat.label}" — frozen hold with hold interpolation; lane priority does not crossfade`,
          )
        } else {
          lines.push(
            `wait(${formatTime(explicit.duration)}s) // explicit move transition from "${previousDraftable.label}" to "${beat.label}" — scene-level travel continues; placements are sequential and lane priority does not crossfade`,
          )
        }
      } else if (draftableIds.has(beat.beatId) && draftableIds.has(previousDraftable.beatId)) {
        lines.push('wait(0.5s) // frozen hold - coordinated pose holds before the next beat')
      }
      for (const jump of jumpByBeatId.get(beat.beatId) ?? []) {
        lines.push(`// ${jump}`)
      }
    } else if (beat.frozenBefore) {
      // Explicit frozen hold before the first drafted beat.
      lines.push(
        `wait(${formatTime(SEQUENCE_FROZEN_HOLD_DURATION)}s) // frozen pose hold before beat "${beat.label}" — coordinated pose holds with hold interpolation`,
      )
    }
    const collectionAlias = collectionAliasByName.get(beat.collectionName) ?? 'motion'
    const bindings =
      beat.matchedSemantics.length > 0 ? ` (bindings: ${beat.matchedSemantics.join(', ')})` : ''
    const targets = formatNodes(beat.targetNodeIds, beat.targetNames)
    lines.push(`// ${position} - reusable ${beat.collectionName} on ${targets}${bindings}`)
    for (const targetId of beat.targetNodeIds) {
      const targetAlias = targetAliasById.get(targetId)
      if (targetAlias) lines.push(`${targetAlias}.apply(${collectionAlias})`)
    }
    for (const leg of beat.travel) {
      const travelAlias = targetAliasById.get(leg.targetNodeId)
      if (!travelAlias) continue
      lines.push(
        `${travelAlias}.tween(${formatTravelRecord(leg.to)}, ${formatTime(leg.duration)}, ${leg.ease}) // scene-level travel for beat "${beat.label}" — separate from character-local "${beat.collectionName}"; never baked into reusable motion`,
      )
    }
    const isLastDraftable =
      draftable.length > 0 && draftable[draftable.length - 1].beatId === beat.beatId
    if (isLastDraftable && beat.frozenAfter) {
      lines.push(
        `wait(${formatTime(SEQUENCE_FROZEN_HOLD_DURATION)}s) // frozen pose hold after beat "${beat.label}" — coordinated pose holds with hold interpolation`,
      )
    }
    previousDraftable = beat
  })
  for (const effect of alignmentEffects) {
    lines.push(
      `// Proposed alignment offset for collection "${effect.collectionName}" semantic "${effect.semanticName}": (${effect.x}, ${effect.y}) — shared by all placements of "${effect.collectionName}" (${effect.affectedPlacements} in this draft plus existing timeline placements); preview across the collection before approval via SetClipCollectionAlignmentOffsets; never silently mutated.`,
    )
  }

  const warnings: string[] = [...requestWarnings]
  if (truncated) {
    warnings.push(
      `Draft covers the first ${SEQUENCE_LIMITS.maxBeats} beats — describe fewer beats per batch so every beat stays reviewable.`,
    )
  }
  if (draftable.length > 0) {
    warnings.push(
      'Clip Collection Alignment Offsets are shared by placements — any proposed offset adjustment needs a preview across the collection before approval; shared definitions are never silently mutated.',
    )
  }
  for (const message of jumpWarnings) warnings.push(message)
  for (const effect of alignmentEffects) {
    warnings.push(
      `Proposed Clip Collection Alignment Offset for collection "${effect.collectionName}" semantic "${effect.semanticName}" (${effect.x}, ${effect.y}) is shared by all placements of "${effect.collectionName}" — preview across the collection before approval; shared definitions are never silently mutated.`,
    )
  }
  const unverified = draftable.filter((beat) => beat.previewViewIds.length === 0)
  if (unverified.length > 0) {
    warnings.push(
      `Visual fit is unverified for ${unverified.length} draftable beat(s) (${unverified.map((beat) => `"${beat.label}"`).join(', ')}) — request a focused rendered view per beat before approving; binding compatibility alone is not visual proof.`,
    )
  }

  return {
    beats: drafts,
    previews,
    transitions,
    frozen,
    alignmentEffects,
    scriptSource: lines.join('\n'),
    warnings,
    summary: {
      total: drafts.length,
      draftable: draftable.length,
      blocked: drafts.length - draftable.length,
    },
    note: SEQUENCE_NOTE,
  }
}
