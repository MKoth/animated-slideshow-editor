import type { SequenceDraft } from './animationSequence'
import type { CompiledFootprint } from '../engine/compiledFootprint'
import type { AnimationAssistantSnapshot } from './contextSnapshot'

/**
 * Proposal revalidation and replacement/staleness (issue #445).
 *
 * Pure and read-only: every result derives from the validated Sequence draft
 * (#442–#443) plus a validated live-project snapshot and the current live
 * snapshot — stable Scene Node identity, Unique Names, collection bindings,
 * camera presence, and the Animation Script Compiled Footprint — and never
 * mutates its inputs. Before approval, the artist sees affected beats, their
 * dependencies, the exact script-created output a rerun would replace, and
 * any stale-project changes. Relevant live Project changes block stale work
 * until its analysis/previews are refreshed and reviewed again.
 *
 * Staleness is relevant-aware: only live changes touching the draft's beats,
 * dependencies, labelled previews, or script footprint block approval and
 * identify affected work. Unrelated project changes (e.g. an added prop node)
 * warn through the fingerprint without blocking. A refreshed draft still
 * requires renewed review (`reviewed`) before approval — approval rides the
 * existing AI Edit Proposal lifecycle (schema, dry-run, fingerprint gate,
 * one Transaction, one undo entry, Save flow).
 */

/** Boundedness contract: one revalidation covers a reviewable batch of beats. */
export const REVALIDATION_LIMITS = {
  maxBeats: 12,
} as const

export interface RevalidationNode {
  id: string
  name: string
}

export interface RevalidationCollection {
  name: string
  bindings: Record<string, string>
}

export interface RevalidationSnapshot {
  slideId: string | null
  nodes: readonly RevalidationNode[]
  collections: readonly RevalidationCollection[]
  hasCamera: boolean
  footprint: CompiledFootprint | null
  fingerprint: string | null
}

export interface RevalidationInput {
  draft: SequenceDraft
  validated: RevalidationSnapshot
  live: RevalidationSnapshot
  /** True once the artist has reviewed the refreshed draft and previews. */
  reviewed: boolean
}

export interface ReplacementTrack {
  nodeId: string
  target: string
}

export interface ReplacementScope {
  /** Draftable beats the run would apply. */
  beatIds: string[]
  tracks: ReplacementTrack[]
  placementParents: string[]
  instanceNodes: string[]
  createdNodes: string[]
  createdDataSources: string[]
  effectIds: string[]
  audioClipIds: string[]
  isFirstRun: boolean
  label: string
  /** Replacement requires approval; manual edits inside created subtrees are lost. */
  warning: string
  requiresApproval: boolean
}

export interface RevalidatedBeat {
  beatId: string
  label: string
  order: number
  draftStatus: 'draftable' | 'blocked'
  affected: boolean
  reasons: string[]
  actions: string[]
  dependencies: string[]
}

export interface RevalidationSummary {
  total: number
  draftable: number
  affected: number
  blocked: number
}

export interface RevalidationResult {
  /** Any project movement since validation (fingerprint or relevant). */
  stale: boolean
  /** Relevant movement touching this draft — approval is blocked. */
  blocked: boolean
  /** True once the refreshed draft and previews have been reviewed. */
  needsReview: boolean
  /** Ready for the existing approval lifecycle: relevant-current and reviewed. */
  approvable: boolean
  beats: RevalidatedBeat[]
  affectedBeatIds: string[]
  replacement: ReplacementScope
  warnings: string[]
  summary: RevalidationSummary
  note: string
}

export const REVALIDATION_NOTE =
  'Revalidation compares the validated draft against the live Project — stable Scene Node ids, ' +
  'Unique Names, Clip Collection bindings, camera presence, labelled previews, and the Animation ' +
  'Script Compiled Footprint. Relevant live changes block stale work until analysis and previews ' +
  'are refreshed and reviewed again. Replacement rides replace-by-footprint: a rerun deletes the ' +
  'listed script-created output before recreating it, so manual edits inside script-created ' +
  'subtrees are lost. Approval applies coherent valid beats through the existing AI Edit Proposal ' +
  'lifecycle — one Transaction, one undo entry, Save flow for persistence.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function lowerText(value: string): string {
  return value.toLowerCase()
}

function footprintKey(footprint: CompiledFootprint | null): string {
  if (footprint === null) return 'null'
  try {
    return JSON.stringify(footprint)
  } catch {
    return 'unserializable'
  }
}

function footprintNodeIds(footprint: CompiledFootprint | null): Set<string> {
  const out = new Set<string>()
  if (footprint === null) return out
  for (const track of footprint.tracks ?? []) {
    if (typeof track?.nodeId === 'string' && track.nodeId) out.add(track.nodeId)
  }
  for (const id of footprint.placementParents ?? []) if (typeof id === 'string') out.add(id)
  for (const id of footprint.instanceNodes ?? []) if (typeof id === 'string') out.add(id)
  for (const id of footprint.createdNodes ?? []) if (typeof id === 'string') out.add(id)
  return out
}

function formatIdList(ids: readonly string[]): string {
  if (ids.length === 0) return 'none'
  return ids.map((id) => `[${id}]`).join(', ')
}

/**
 * Describe the exact script-created output a run of the draft would replace.
 * Read-only: the footprint and draft are only read, never written.
 */
export function describeReplacement(
  footprint: CompiledFootprint | null,
  draft: SequenceDraft,
): ReplacementScope {
  const beats = Array.isArray(draft?.beats) ? [...draft.beats] : []
  const draftable = beats.filter((beat) => beat?.status === 'draftable')
  const beatIds = draftable.map((beat) => beat.beatId)
  if (footprint === null) {
    const count = draftable.length
    return {
      beatIds,
      tracks: [],
      placementParents: [],
      instanceNodes: [],
      createdNodes: [],
      createdDataSources: [],
      effectIds: [],
      audioClipIds: [],
      isFirstRun: true,
      label:
        `First run — no script-created output to replace. ` +
        `Running the retained Animation Script would apply ${count} draftable beat(s) ` +
        `(${beatIds.length > 0 ? beatIds.map((id) => `"${id}"`).join(', ') : 'none'}) ` +
        `as ordinary timeline data.`,
      warning:
        'Replacement requires approval before anything is applied — review the affected beats, ' +
        'their dependencies, and the labelled previews; a rerun later replaces by footprint and ' +
        'manual edits inside script-created subtrees are lost.',
      requiresApproval: count > 0,
    }
  }
  const tracks: ReplacementTrack[] = (footprint.tracks ?? []).map((track) => ({
    nodeId: track.nodeId,
    target: summariseTarget(track.target),
  }))
  const placementParents = [...(footprint.placementParents ?? [])]
  const instanceNodes = [...(footprint.instanceNodes ?? [])]
  const createdNodes = [...(footprint.createdNodes ?? [])]
  const createdDataSources = [...(footprint.createdDataSources ?? [])]
  const effectIds = [...(footprint.effectIds ?? [])]
  const audioClipIds = [...(footprint.audioClipIds ?? [])]
  const parts: string[] = []
  parts.push(
    `${tracks.length} track(s)${tracks.length > 0 ? ` on ${formatIdList(tracks.map((t) => t.nodeId))}` : ''}`,
  )
  parts.push(`${placementParents.length + instanceNodes.length} placement(s)`)
  parts.push(
    `${createdNodes.length} created node(s)${createdNodes.length > 0 ? ` ${formatIdList(createdNodes)}` : ''}`,
  )
  parts.push(`${createdDataSources.length} created data source(s)`)
  if (effectIds.length > 0) parts.push(`${effectIds.length} effect(s)`)
  if (audioClipIds.length > 0) parts.push(`${audioClipIds.length} audio clip(s)`)
  return {
    beatIds,
    tracks,
    placementParents,
    instanceNodes,
    createdNodes,
    createdDataSources,
    effectIds,
    audioClipIds,
    isFirstRun: false,
    label:
      `Rerun replaces the exact script-created output: ${parts.join(', ')} ` +
      `for ${beatIds.length} draftable beat(s) ` +
      `(${beatIds.length > 0 ? beatIds.map((id) => `"${id}"`).join(', ') : 'none'}). ` +
      `Replace-by-footprint deletes these subtrees and data sources before recreating them.`,
    warning:
      'Replacement requires approval — manual edits inside script-created subtrees are lost on ' +
      're-run. Review the affected beats, their dependencies, and the refreshed previews before approving.',
    requiresApproval: beatIds.length > 0,
  }
}

function summariseTarget(target: unknown): string {
  if (typeof target === 'string') return target
  if (target !== null && typeof target === 'object') {
    const record = target as Record<string, unknown>
    if (typeof record.kind === 'string' && record.kind) return record.kind
    try {
      return JSON.stringify(target)
    } catch {
      return 'track'
    }
  }
  return 'track'
}

/**
 * Revalidate a validated Sequence draft against the live Project.
 * Read-only: the draft and snapshots are only read, never written.
 */
export function revalidateAnimationProposal(input: RevalidationInput): RevalidationResult {
  const draft = input.draft
  const validated = input.validated
  const live = input.live
  const reviewed = input.reviewed === true

  const beats = Array.isArray(draft?.beats)
    ? draft.beats.slice(0, REVALIDATION_LIMITS.maxBeats)
    : []
  const truncated = Array.isArray(draft?.beats) && draft.beats.length > beats.length

  const validatedNodes = new Map<string, string>()
  for (const node of validated?.nodes ?? []) {
    if (typeof node?.id === 'string' && typeof node?.name === 'string') {
      validatedNodes.set(node.id, node.name)
    }
  }
  const liveNodes = new Map<string, string>()
  for (const node of live?.nodes ?? []) {
    if (typeof node?.id === 'string' && typeof node?.name === 'string') {
      liveNodes.set(node.id, node.name)
    }
  }
  const validatedCollections = new Map<string, Record<string, string>>()
  for (const collection of validated?.collections ?? []) {
    const name = trimText(collection?.name)
    if (!name || validatedCollections.has(lowerText(name))) continue
    validatedCollections.set(lowerText(name), { ...(collection?.bindings ?? {}) })
  }
  const liveCollections = new Map<string, Record<string, string>>()
  const liveNamesByLower = new Map<string, string>()
  for (const collection of live?.collections ?? []) {
    const name = trimText(collection?.name)
    if (!name || liveCollections.has(lowerText(name))) continue
    liveCollections.set(lowerText(name), { ...(collection?.bindings ?? {}) })
    liveNamesByLower.set(lowerText(name), name)
  }

  const validatedFingerprint =
    typeof validated?.fingerprint === 'string' ? validated.fingerprint : null
  const liveFingerprint = typeof live?.fingerprint === 'string' ? live.fingerprint : null
  const fingerprintMismatch =
    validatedFingerprint !== null &&
    liveFingerprint !== null &&
    validatedFingerprint !== liveFingerprint

  const validatedSlideId = typeof validated?.slideId === 'string' ? validated.slideId : null
  const liveSlideId = typeof live?.slideId === 'string' ? live.slideId : null
  const slideChanged =
    validatedSlideId !== null && liveSlideId !== null && validatedSlideId !== liveSlideId

  const footprintChanged =
    footprintKey(validated?.footprint ?? null) !== footprintKey(live?.footprint ?? null)
  const liveFootprintIds = footprintNodeIds(live?.footprint ?? null)

  const warnings: string[] = []
  if (truncated) {
    warnings.push(
      `Revalidation covers the first ${REVALIDATION_LIMITS.maxBeats} beats — describe fewer beats per batch so every beat stays reviewable.`,
    )
  }
  if (fingerprintMismatch) {
    warnings.push(
      'The project changed since validation (fingerprint moved) — only changes touching this draft block approval; unrelated changes stay unblocked but should still be reviewed.',
    )
  }

  const revalidated: RevalidatedBeat[] = beats.map((beat) => {
    const reasons: string[] = []
    const actions: string[] = []
    const dependencies = Array.isArray(beat?.dependencies) ? [...beat.dependencies] : []

    if (slideChanged) {
      reasons.push(
        `Stale slide — validated on Slide [${validatedSlideId}] but the live Slide is [${liveSlideId}]; analysis and previews belong to the validated Slide.`,
      )
      actions.push(
        'Re-run analysis against the live Slide and review the refreshed draft and previews.',
      )
    } else {
      const targets = Array.isArray(beat?.targetNodeIds) ? [...beat.targetNodeIds] : []
      const missing = targets.filter((id) => !liveNodes.has(id))
      if (missing.length > 0) {
        reasons.push(
          `Stale target — ${formatIdList(missing)} no longer exists in the live scene; the analysis is outdated and nothing is guessed.`,
        )
        actions.push(
          'Re-run analysis against the live Project and review the refreshed draft and previews.',
        )
      }
      const renamed = targets.filter(
        (id) =>
          liveNodes.has(id) &&
          validatedNodes.has(id) &&
          liveNodes.get(id) !== validatedNodes.get(id),
      )
      if (renamed.length > 0) {
        const detail = renamed
          .map((id) => `[${id}] was "${validatedNodes.get(id)}", now "${liveNodes.get(id)}"`)
          .join(', ')
        reasons.push(
          `Renamed target — ${detail}; Unique Name bindings in the retained script may be stale.`,
        )
        actions.push(
          'Re-run analysis so Unique Name bindings resolve against the live names, then review again.',
        )
      }
      const collectionName = trimText(beat?.collectionName)
      if (collectionName && beat?.status === 'draftable') {
        const key = lowerText(collectionName)
        const liveBindings = liveCollections.get(key)
        if (!liveBindings) {
          reasons.push(
            `Stale reusable motion — Clip Collection "${collectionName}" no longer exists in the live Project.`,
          )
          actions.push(
            'Re-run analysis against the live library and review the refreshed reusable candidates.',
          )
        } else {
          const validatedBindings = validatedCollections.get(key) ?? {}
          const matched =
            Array.isArray(beat?.matchedSemantics) && beat.matchedSemantics.length > 0
              ? [...beat.matchedSemantics]
              : Object.keys(validatedBindings)
          const changed = matched.filter((semantic) => {
            const wanted = Object.entries(validatedBindings).find(
              ([bindingKey]) => lowerText(bindingKey.trim()) === lowerText(semantic.trim()),
            )?.[1]
            const current = Object.entries(liveBindings).find(
              ([bindingKey]) => lowerText(bindingKey.trim()) === lowerText(semantic.trim()),
            )?.[1]
            if (wanted === undefined && current === undefined) return false
            return wanted !== current
          })
          const missingSemantics = matched.filter(
            (semantic) =>
              !Object.keys(liveBindings).some(
                (bindingKey) => lowerText(bindingKey.trim()) === lowerText(semantic.trim()),
              ),
          )
          if (missingSemantics.length > 0) {
            reasons.push(
              `Stale collection binding — Clip Collection "${collectionName}" no longer binds ${missingSemantics.map((s) => `"${s}"`).join(', ')} in the live Project (shared definition changed).`,
            )
            actions.push(
              'Re-run analysis and preview any Clip Collection Alignment Offset across the collection before approving; shared definitions are never silently mutated.',
            )
          } else if (changed.length > 0) {
            reasons.push(
              `Stale collection binding — Clip Collection "${collectionName}" bindings changed for ${changed.map((s) => `"${s}"`).join(', ')} since validation.`,
            )
            actions.push(
              'Re-run analysis and review the refreshed reusable candidates and previews.',
            )
          }
        }
      }
      const mentionsCamera = dependencies.join(' ').toLowerCase().includes('camera')
      if (mentionsCamera && validated?.hasCamera === true && live?.hasCamera === false) {
        reasons.push(
          'Stale prerequisite — the toward-camera beat lost its usable camera context in the live Project; framing is never fabricated from transforms alone.',
        )
        actions.push(
          'Supply human-authored camera setup in the live Project, re-run analysis, and review again.',
        )
      }
      const previewTargets = new Set<string>()
      for (const preview of draft?.previews ?? []) {
        if (preview?.beatId !== beat?.beatId) continue
        for (const id of preview?.nodeIds ?? []) previewTargets.add(id)
      }
      const stalePreviewTargets = [...previewTargets].filter((id) => !liveNodes.has(id))
      if (stalePreviewTargets.length > 0) {
        reasons.push(
          `Stale preview — labelled preview(s) for this beat reference ${formatIdList(stalePreviewTargets)}, which no longer exist live; refresh the previews and review again.`,
        )
        actions.push(
          'Request refreshed labelled views (Slide, time, stable node ids) and review them before approving.',
        )
      }
      if (footprintChanged && beat?.status === 'draftable') {
        const overlaps = targets.filter((id) => liveFootprintIds.has(id))
        const validatedIds = footprintNodeIds(validated?.footprint ?? null)
        const overlapDetail =
          overlaps.length > 0
            ? ` overlapping ${formatIdList(overlaps)}`
            : validatedIds.size > 0 || liveFootprintIds.size > 0
              ? ' touching script-created output'
              : ''
        reasons.push(
          `Stale script output — the Animation Script Compiled Footprint changed since validation${overlapDetail}; a rerun would replace different output than reviewed.`,
        )
        actions.push(
          'Review the exact replacement scope below, refresh analysis and previews, and review again before approving.',
        )
      }
    }

    return {
      beatId: beat.beatId,
      label: beat.label,
      order: beat.order,
      draftStatus: beat.status,
      affected: reasons.length > 0,
      reasons,
      actions: [...new Set(actions)],
      dependencies,
    }
  })

  const affectedBeatIds = revalidated.filter((beat) => beat.affected).map((beat) => beat.beatId)
  const relevantStale = affectedBeatIds.length > 0
  const stale = fingerprintMismatch || slideChanged || relevantStale || footprintChanged
  const blocked = relevantStale
  const needsReview = !reviewed || blocked
  const draftableCount = beats.filter((beat) => beat?.status === 'draftable').length
  const approvable = !blocked && reviewed && draftableCount > 0

  const replacement = describeReplacement(live?.footprint ?? null, draft)

  if (blocked) {
    warnings.push(
      `Stale proposal — ${affectedBeatIds.length} affected beat(s) (${affectedBeatIds.map((id) => `"${id}"`).join(', ')}) changed underneath the validated draft. Refresh analysis and previews, then review again before approval; blocked beats stay unapplied.`,
    )
  }
  if (!reviewed) {
    warnings.push(
      'Refreshed analysis and previews require renewed review before approval — review the affected beats, dependencies, replacement scope, and labelled previews, then approve.',
    )
  }
  if (replacement.requiresApproval) {
    warnings.push(replacement.warning)
  }
  const unverified = beats.filter(
    (beat) => beat?.status === 'draftable' && (beat?.previewViewIds ?? []).length === 0,
  )
  if (unverified.length > 0 && draftableCount > 0) {
    warnings.push(
      `Visual fit is unverified for ${unverified.length} draftable beat(s) (${unverified.map((beat) => `"${beat.label}"`).join(', ')}) — request a focused rendered view per beat before approving; binding compatibility alone is not visual proof.`,
    )
  }

  return {
    stale,
    blocked,
    needsReview,
    approvable,
    beats: revalidated,
    affectedBeatIds,
    replacement,
    warnings,
    summary: {
      total: beats.length,
      draftable: draftableCount,
      affected: affectedBeatIds.length,
      blocked: beats.filter((beat) => beat?.status === 'blocked').length,
    },
    note: REVALIDATION_NOTE,
  }
}

/** Minimal live-context surface the revalidator reads. */
export interface RevalidationAnimationSnapshot {
  nodes: { id: string; name: string; components: string[] }[]
  collections: { name: string; bindings: Record<string, string> }[]
  timeline: { slideId: string | null }
}

/**
 * Adapt the live Context Snapshot digest to the revalidation surface.
 * Read-only: the returned rows are freshly copied.
 */
export function toRevalidationSnapshot(
  animation: RevalidationAnimationSnapshot,
  extra: { footprint?: CompiledFootprint | null; fingerprint?: string | null } = {},
): RevalidationSnapshot {
  const nodes = Array.isArray(animation?.nodes) ? animation.nodes : []
  const collections = Array.isArray((animation as { collections?: unknown })?.collections)
    ? (
        animation as unknown as {
          collections: { name: string; bindings: Record<string, string> }[]
        }
      ).collections
    : []
  const slideId =
    typeof (animation as { timeline?: { slideId?: unknown } })?.timeline?.slideId === 'string'
      ? ((animation as { timeline: { slideId: string } }).timeline.slideId as string)
      : null
  return {
    slideId,
    nodes: nodes.map((node) => ({ id: node.id, name: node.name })),
    collections: collections.map((collection) => ({
      name: collection.name,
      bindings: { ...collection.bindings },
    })),
    hasCamera:
      Array.isArray(nodes) &&
      nodes.some((node) => Array.isArray(node.components) && node.components.includes('camera')),
    footprint: extra.footprint ?? null,
    fingerprint: typeof extra.fingerprint === 'string' ? extra.fingerprint : null,
  }
}

/** Adapt the full animation-assistant snapshot (same shape, wider rows). */
export function toRevalidationSnapshotFromAssistant(
  animation: AnimationAssistantSnapshot,
  extra: { footprint?: CompiledFootprint | null; fingerprint?: string | null } = {},
): RevalidationSnapshot {
  return toRevalidationSnapshot(
    {
      nodes: animation.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        components: [...node.components],
      })),
      collections: animation.collections.map((collection) => ({
        name: collection.name,
        bindings: { ...collection.bindings },
      })),
      timeline: { slideId: animation.timeline.slideId },
    },
    extra,
  )
}
