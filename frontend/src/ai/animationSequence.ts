import type { BeatAnalysis } from './animationAnalysis'
import type { RenderedView } from './renderedViews'

/**
 * Ordered Scene Animation Sequence composition (issue #442).
 *
 * Pure and read-only: every result derives from the beat analysis (#440) and
 * the labelled rendered views (#441) plus Slide identity — never from pixels
 * alone and never by mutating its inputs. Only binding-compatible reusable
 * Clip Collections count; name-only matches without rig-binding overlap are
 * never drafted. Blocked beats stay undrafted with the precise reason while
 * independent beats proceed. Per-beat and full-sequence previews are always
 * labelled with Slide, time, and stable Scene Node ids before anything is
 * applied. The retained recipe is an ordinary Animation Script source that
 * compiles to ordinary timeline data — never a runtime player.
 */

/** Boundedness contract: one sequence covers a reviewable batch of beats. */
export const SEQUENCE_LIMITS = {
  maxBeats: 12,
} as const

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
}

export type SequenceBeatStatus = 'draftable' | 'blocked'

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
  dependencies: string[]
  assumptions: string[]
  warnings: string[]
  blockers: string[]
  actions: string[]
}

export interface SequencePreview {
  /** Null marks the full-sequence preview; otherwise the beat it previews. */
  beatId: string | null
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

export interface SequenceDraft {
  beats: SequenceBeatDraft[]
  previews: SequencePreview[]
  /** Retained Animation Script recipe — compiles to ordinary timeline data. */
  scriptSource: string
  warnings: string[]
  summary: SequenceSummary
  note: string
}

export const SEQUENCE_NOTE =
  'Sequence previews complement structured project data — identity and relationships come ' +
  'from stable Scene Node ids, hierarchy, and names in the Context Snapshot, never from pixels. ' +
  'The retained Animation Script compiles to ordinary timeline data; there is no runtime player.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
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
  const total = drafts.length

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
        label,
        slideId,
        slideName,
        time,
        nodeIds: [...beat.targetNodeIds],
        nodeNames: { ...beat.targetNames },
      })
    }
    const sequenceNodeIds = [...new Set(draftable.flatMap((beat) => beat.targetNodeIds))]
    const sequenceNames: Record<string, string> = {}
    for (const id of sequenceNodeIds) {
      const name = nameById.get(id)
      if (typeof name === 'string') sequenceNames[id] = name
    }
    previews.push({
      beatId: null,
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
  for (const beat of draftable) {
    for (const id of beat.targetNodeIds) {
      if (!targetAliasById.has(id)) {
        const name = beat.targetNames[id] ?? id
        targetAliasById.set(id, uniqueAlias(`target_${name}`, usedAliases))
      }
    }
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
  drafts.forEach((beat, index) => {
    const position = `Beat ${index + 1}/${total} "${beat.label}"`
    if (beat.status !== 'draftable' || beat.collectionName === null) {
      const reason = beat.blockers[0] ?? `blocked (${beat.beatId})`
      lines.push(`// ${position} omitted - blocked: ${reason}`)
      for (const action of beat.actions) lines.push(`// Next step: ${action}`)
      return
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
    const isLastDraftable =
      draftable.length > 0 && draftable[draftable.length - 1].beatId === beat.beatId
    if (!isLastDraftable) {
      lines.push('wait(0.5s) // frozen hold - coordinated pose holds before the next beat')
    }
  })

  const warnings: string[] = []
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
  const unverified = draftable.filter((beat) => beat.previewViewIds.length === 0)
  if (unverified.length > 0) {
    warnings.push(
      `Visual fit is unverified for ${unverified.length} draftable beat(s) (${unverified.map((beat) => `"${beat.label}"`).join(', ')}) — request a focused rendered view per beat before approving; binding compatibility alone is not visual proof.`,
    )
  }

  return {
    beats: drafts,
    previews,
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
