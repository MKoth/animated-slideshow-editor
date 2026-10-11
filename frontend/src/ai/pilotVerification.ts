import type { AnalysisResult, BeatAnalysis, RequestedBeat } from './animationAnalysis'
import type { RenderedView } from './renderedViews'
import type { SequenceDraft } from './animationSequence'
import type { ShapeDraftResult } from './shapeDrafts'
import type { RevalidationResult } from './animationRevalidation'
import type { AnimationApplyPlan } from './animationApply'

/**
 * Pilot verification and supported-conditions evidence (issue #447).
 *
 * Pure and read-only: every result derives from the six-beat pilot request
 * plus the stage outputs of the integrated assistant seam — beat analysis
 * (#440), labelled rendered views (#441), the composed sequence (#442–#443),
 * Shape drafts (#444), revalidation (#445), and the atomic apply plan (#446)
 * — and never mutates its inputs. The complete cat-on-sofa-to-blackboard
 * route is exercised end to end: sleep, wake/stretch, get-down, room travel,
 * turn/move toward camera, and sit.
 *
 * Candidate walk/turn/sit reuse counts only on rig-binding compatibility plus
 * labelled-preview visual fit — names alone never count. Absent sleep, wake,
 * stretch, and get-down motion, missing camera setup, and missing pose
 * geometry stay explicit as gaps and prerequisites. The verification records
 * successes, blockers, and limitations per beat so equivalent rigs and scenes
 * can run the same evidence shape; anything beyond the pilot requires a later
 * human evidence review before any broader support claim is made.
 */

/** Canonical pilot beat ids in route order. */
export const PILOT_BEAT_IDS = [
  'pilot-sleep',
  'pilot-wake',
  'pilot-get-down',
  'pilot-travel',
  'pilot-camera',
  'pilot-sit',
] as const

export type PilotBeatId = (typeof PILOT_BEAT_IDS)[number]

/** Coherent performance kind each pilot beat exercises. */
export type PilotBeatKind =
  'sleep' | 'wake-stretch' | 'get-down' | 'room-travel' | 'toward-camera' | 'sit'

const PILOT_KIND_BY_ID: Record<PilotBeatId, PilotBeatKind> = {
  'pilot-sleep': 'sleep',
  'pilot-wake': 'wake-stretch',
  'pilot-get-down': 'get-down',
  'pilot-travel': 'room-travel',
  'pilot-camera': 'toward-camera',
  'pilot-sit': 'sit',
}

/**
 * Stable scene targets for one pilot run. Ids are caller-supplied so
 * equivalent rigs and scenes substitute their own nodes — the route is never
 * hard-coded to one named cat and room.
 */
export interface PilotTargets {
  /** Character node the six beats animate (stable Scene Node id). */
  catNodeId: string
  /** Resting landmark the route starts from (stable Scene Node id). */
  sofaNodeId?: string | null
  /** Destination landmark the route ends near (stable Scene Node id). */
  blackboardNodeId?: string | null
}

export interface PilotVerificationInput {
  requested: readonly RequestedBeat[]
  analysis: AnalysisResult
  views: readonly RenderedView[]
  draft: SequenceDraft
  shapes: ShapeDraftResult
  revalidation: RevalidationResult
  applyPlan: AnimationApplyPlan
}

export interface PilotBeatEvidence {
  beatId: string
  kind: PilotBeatKind
  label: string
  status: BeatAnalysis['status']
  targetNodeIds: string[]
  reusableNames: string[]
  nameOnlyNames: string[]
  geometryState: BeatAnalysis['geometry']['state']
  prerequisites: string[]
  /** Labels of the rendered views evidencing this beat's visual fit. */
  previewLabels: string[]
  /** True once visual fit is evidenced by at least one labelled view. */
  visuallyVerified: boolean
  affected: boolean
  appliable: boolean
  blockers: string[]
  actions: string[]
}

export interface PilotSummary {
  total: number
  ready: number
  draftable: number
  blocked: number
  visuallyVerified: number
  missingMotion: number
  missingPrerequisite: number
  needsClarification: number
  invalid: number
  affected: number
  appliable: number
}

export interface PilotVerification {
  beats: PilotBeatEvidence[]
  summary: PilotSummary
  /** True when all six canonical pilot beats were requested. */
  coversAllSix: boolean
  successes: string[]
  blockers: string[]
  limitations: string[]
  note: string
}

export interface SupportedConditions {
  /** The six pilot beat labels in route order. */
  route: string[]
  demonstrated: string[]
  prerequisites: string[]
  limitations: string[]
  /** Expansion beyond the pilot always requires a later human evidence review. */
  requiresHumanEvidenceReview: boolean
  /** Bounded support claim for this run — failures narrow it, never broaden it. */
  claim: string
}

export const PILOT_NOTE =
  'Pilot verification is read-only evidence over the integrated assistant seam — analysis, ' +
  'labelled rendered views, the composed sequence, Shape drafts, revalidation, and the apply ' +
  'plan. Structured project data (stable Scene Node ids, hierarchy, names) stays authoritative ' +
  'over pixels; reusable motion counts only on rig-binding overlap confirmed by a labelled ' +
  'preview. Nothing here changes the project; only explicitly approved, valid beats apply ' +
  'through the existing proposal lifecycle.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pilotLabel(targets: PilotTargets, kind: PilotBeatKind): string {
  void targets
  switch (kind) {
    case 'sleep':
      return 'Sleep on the sofa'
    case 'wake-stretch':
      return 'Wake and stretch'
    case 'get-down':
      return 'Get down from the sofa'
    case 'room-travel':
      return 'Walk across the room'
    case 'toward-camera':
      return 'Turn and move toward the camera'
    case 'sit':
      return 'Sit near the blackboard'
  }
}

/**
 * Build the six-beat pilot request from caller-supplied stable Scene Node
 * ids. Read-only: the targets are only read, never written.
 */
export function buildPilotBeats(targets: PilotTargets): RequestedBeat[] {
  const catNodeId = trimText(targets?.catNodeId)
  const motion: Record<PilotBeatId, string> = {
    'pilot-sleep': 'sleep',
    'pilot-wake': 'stretch',
    'pilot-get-down': 'get-down',
    'pilot-travel': 'walk',
    'pilot-camera': 'turn',
    'pilot-sit': 'sit',
  }
  return PILOT_BEAT_IDS.map((id) => ({
    id,
    label: pilotLabel(targets, PILOT_KIND_BY_ID[id]),
    target: { nodeId: catNodeId },
    motion: motion[id],
    requiresCamera: id === 'pilot-camera',
  }))
}

function emptyEvidence(beatId: string, label: string): PilotBeatEvidence {
  return {
    beatId,
    kind: PILOT_KIND_BY_ID[beatId as PilotBeatId] ?? 'room-travel',
    label,
    status: 'invalid',
    targetNodeIds: [],
    reusableNames: [],
    nameOnlyNames: [],
    geometryState: 'not-checked',
    prerequisites: [],
    previewLabels: [],
    visuallyVerified: false,
    affected: false,
    appliable: false,
    blockers: ['Pilot beat was not requested — describe the six-beat route before verifying.'],
    actions: [
      'Request all six pilot beats (sleep, wake/stretch, get-down, travel, toward-camera, sit) and re-run.',
    ],
  }
}

/**
 * Verify the pilot route end to end across the assistant seam.
 * Read-only: every input is only read, never written.
 */
export function verifyPilot(input: PilotVerificationInput): PilotVerification {
  const requested = Array.isArray(input.requested) ? [...input.requested] : []
  const requestedById = new Map(requested.map((beat) => [beat.id, beat] as const))
  const analysisById = new Map(
    (Array.isArray(input.analysis?.beats) ? input.analysis.beats : []).map(
      (beat) => [beat.beatId, beat] as const,
    ),
  )
  const draftById = new Map(
    (Array.isArray(input.draft?.beats) ? input.draft.beats : []).map(
      (beat) => [beat.beatId, beat] as const,
    ),
  )
  const revalidatedById = new Map(
    (Array.isArray(input.revalidation?.beats) ? input.revalidation.beats : []).map(
      (beat) => [beat.beatId, beat] as const,
    ),
  )
  const appliable = new Set(
    Array.isArray(input.applyPlan?.appliableBeatIds) ? input.applyPlan.appliableBeatIds : [],
  )
  const viewsByRequestId = new Map(
    (Array.isArray(input.views) ? input.views : []).map((view) => [view.requestId, view] as const),
  )
  const sequencePreviews = Array.isArray(input.draft?.previews) ? input.draft.previews : []

  const coversAllSix = PILOT_BEAT_IDS.every((id) => requestedById.has(id))

  const beats: PilotBeatEvidence[] = PILOT_BEAT_IDS.map((beatId) => {
    const requestedBeat = requestedById.get(beatId)
    const analyzed = analysisById.get(beatId)
    if (!requestedBeat || !analyzed) {
      return emptyEvidence(beatId, requestedBeat?.label ?? analyzed?.label ?? beatId)
    }
    const drafted = draftById.get(beatId)
    const revalidated = revalidatedById.get(beatId)
    const reusableNames = analyzed.reusable.map((candidate) => candidate.collectionName)
    const nameOnlyNames = [
      ...analyzed.nameOnly.collections.map((entry) => entry.name),
      ...(analyzed.reusable.length === 0 ? analyzed.nameOnly.clips.map((entry) => entry.name) : []),
    ]
    const previewViewIds = drafted?.previewViewIds ?? []
    const previewLabels: string[] = []
    for (const viewId of previewViewIds) {
      const view = viewsByRequestId.get(viewId)
      if (view && view.status === 'ready') previewLabels.push(view.label)
    }
    const sequencePreview = sequencePreviews.find((preview) => preview.beatId === beatId)
    if (sequencePreview) previewLabels.push(sequencePreview.label)
    const visuallyVerified = previewViewIds.length > 0
    const blockers: string[] = [...(drafted?.blockers ?? [])]
    if (!drafted) {
      blockers.push(
        `No sequence draft for "${analyzed.label}" — status ${analyzed.status}; resolve it before drafting.`,
      )
    }
    if (analyzed.status === 'missing-motion') {
      blockers.push(
        `No compatible reusable motion for "${analyzed.label}" on the resolved target — similarly named library entries without binding overlap do not count.`,
      )
    }
    if (drafted && drafted.status !== 'draftable' && drafted.blockers.length === 0) {
      blockers.push(`Blocked — ${analyzed.label} stays undrafted.`)
    }
    const actions: string[] = [...new Set([...analyzed.actions, ...(drafted?.actions ?? [])])]
    return {
      beatId,
      kind: PILOT_KIND_BY_ID[beatId],
      label: analyzed.label,
      status: analyzed.status,
      targetNodeIds: [...analyzed.resolvedNodeIds],
      reusableNames,
      nameOnlyNames,
      geometryState: analyzed.geometry.state,
      prerequisites: [...analyzed.prerequisites],
      previewLabels,
      visuallyVerified,
      affected: revalidated?.affected === true,
      appliable: appliable.has(beatId),
      blockers,
      actions,
    }
  })

  const summary: PilotSummary = {
    total: beats.length,
    ready: 0,
    draftable: 0,
    blocked: 0,
    visuallyVerified: 0,
    missingMotion: 0,
    missingPrerequisite: 0,
    needsClarification: 0,
    invalid: 0,
    affected: 0,
    appliable: 0,
  }
  const draftableIds = new Set(
    (Array.isArray(input.draft?.beats) ? input.draft.beats : [])
      .filter((beat) => beat?.status === 'draftable')
      .map((beat) => beat.beatId),
  )
  for (const beat of beats) {
    if (beat.status === 'ready') summary.ready += 1
    else summary.blocked += 1
    if (draftableIds.has(beat.beatId)) summary.draftable += 1
    if (beat.visuallyVerified) summary.visuallyVerified += 1
    if (beat.status === 'missing-motion') summary.missingMotion += 1
    else if (beat.status === 'missing-prerequisite') summary.missingPrerequisite += 1
    else if (beat.status === 'needs-clarification') summary.needsClarification += 1
    else if (beat.status === 'invalid') summary.invalid += 1
    if (beat.affected) summary.affected += 1
    if (beat.appliable) summary.appliable += 1
  }

  const successes: string[] = []
  for (const beat of beats) {
    if (!draftableIds.has(beat.beatId) || beat.reusableNames.length === 0) continue
    const names = beat.reusableNames.map((name) => `"${name}"`).join(', ')
    successes.push(
      `"${beat.label}" reuses binding-compatible motion (${names})` +
        (beat.visuallyVerified
          ? ` verified by labelled view(s): ${beat.previewLabels
              .slice(0, 2)
              .map((label) => `"${label}"`)
              .join(', ')}`
          : ' — visual fit still unverified, request a focused rendered view before approving'),
    )
  }

  const blockers: string[] = []
  for (const beat of beats) {
    if (beat.blockers.length === 0 && !beat.affected) continue
    const reason =
      beat.blockers[0] ??
      'Affected by a live Project change — refresh analysis and previews, then review again.'
    blockers.push(
      `"${beat.label}" blocked: ${reason}` +
        (beat.actions[0] ? ` Next step: ${beat.actions[0]}` : ''),
    )
  }

  const limitations: string[] = []
  const missing = beats.filter((beat) => beat.status === 'missing-motion')
  if (missing.length > 0) {
    limitations.push(
      `Absent motion stays a gap — ${missing.map((beat) => `"${beat.label}"`).join(', ')} ` +
        `have no compatible reusable motion; author new motion or approve a Shape draft. ` +
        `Similarly named library entries without binding overlap never count.`,
    )
  }
  const cameraBeats = beats.filter((beat) =>
    beat.prerequisites.some((prerequisite) => /camera/i.test(prerequisite)),
  )
  if (cameraBeats.length > 0) {
    limitations.push(
      `Camera setup is a human-authored prerequisite — ${cameraBeats.map((beat) => `"${beat.label}"`).join(', ')} ` +
        `stay blocked until the live Project supplies a usable camera context; framing is never fabricated from transforms alone.`,
    )
  }
  const unverified = beats.filter((beat) => draftableIds.has(beat.beatId) && !beat.visuallyVerified)
  if (unverified.length > 0) {
    limitations.push(
      `Visual fit is unverified for ${unverified.map((beat) => `"${beat.label}"`).join(', ')} — ` +
        `binding compatibility alone is not visual proof; request a focused rendered view per beat before approving.`,
    )
  }
  const affected = beats.filter((beat) => beat.affected)
  if (affected.length > 0) {
    limitations.push(
      `Stale pilot work stays unapplied — ${affected.map((beat) => `"${beat.label}"`).join(', ')} ` +
        `changed underneath the validated draft; refresh analysis and previews and review again before approval.`,
    )
  }

  return { beats, summary, coversAllSix, successes, blockers, limitations, note: PILOT_NOTE }
}

/**
 * Describe the bounded supported conditions evidenced by a pilot run.
 * Read-only: the verification is only read, never written. Failures narrow
 * the claim — broader production support always requires a later human
 * evidence review and is never inferred from the pilot alone.
 */
export function describeSupportedConditions(verification: PilotVerification): SupportedConditions {
  const beats = Array.isArray(verification?.beats) ? verification.beats : []
  const route = PILOT_BEAT_IDS.map((id) => beats.find((beat) => beat.beatId === id)?.label ?? id)
  const demonstrated = [
    'Reusable walk, turn, and sit motion applies only after rig-binding compatibility and labelled-preview visual-fit checks — never from collection names alone.',
    'Scene-level position and scale keyframes express room travel and toward-camera movement separately from character-local reusable motion.',
    'Sequential placements with lane priority (no crossfade), explicit transitions, and Frozen Pose holds carry pauses and handoffs.',
    'Missing sleep, wake, stretch, and get-down motion is reported as a gap with a closest-fit Shape draft or an artist-authored-geometry request; sources are never mutated.',
    'Stale proposals block affected beats until analysis and previews are refreshed and reviewed again; approved batches apply as one Transaction with one undo entry.',
  ]
  const prerequisites = [
    'Pilot targets resolve by stable Scene Node id, hierarchy, existing Unique Names, Semantic Names, and asset metadata — ambiguous targets ask the artist instead of guessing.',
    'The toward-camera beat needs human-authored camera setup in the live Project unless a usable camera context already exists.',
    'Missing poses need either an approved closest-fit Shape draft or artist-authored geometry before the beat can draft.',
    'Approval requires reviewed labelled previews per beat and the full-sequence preview; refreshed work requires renewed review.',
  ]
  const limitations = [...verification.limitations]
  if (verification.summary.affected > 0) {
    limitations.push(
      'This run observed stale pilot work — the claim below covers only refreshed and reviewed beats.',
    )
  }
  limitations.push(
    'Equivalent rigs and scenes need their own pilot evidence run with their stable node ids — this verification does not transfer without re-running.',
  )

  const draftable = verification.summary.draftable
  const blocked = verification.summary.blocked
  const claim =
    `Pilot support: the six-beat sofa-to-blackboard route (sleep, wake/stretch, get-down, room travel, ` +
    `turn/move toward camera, sit) with ${draftable} draftable and ${blocked} blocked beat(s) in this run, ` +
    `subject to the prerequisites and limitations above; broader production support requires a later ` +
    `human evidence review — no broader claim is made from the pilot alone.`

  return {
    route,
    demonstrated,
    prerequisites,
    limitations,
    requiresHumanEvidenceReview: true,
    claim,
  }
}
