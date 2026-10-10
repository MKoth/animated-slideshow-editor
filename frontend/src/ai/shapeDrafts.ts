import type { BeatAnalysis } from './animationAnalysis'

/**
 * Reviewable missing-Shape drafts (issue #444).
 *
 * Pure and read-only: every draft derives from the beat analysis (#440) —
 * its missing-geometry finding with a closest-fit Shape — plus the
 * live-project Shape inventory, and never mutates its inputs. When existing
 * topology can express a missing pose, the assistant proposes a separate
 * closest-fit draft Shape for artist review: the copy is minted with the
 * existing `DuplicateShape` command, so the source Shape keeps its id, name,
 * and vertices and the mesh keeps its vertices/faces (`shape.vertices.length
 * === mesh.vertices.length` per ADR 0007). The source is never mutated.
 * Insufficient topology (no Shape inventory, no mesh, or a stale closest fit)
 * is reported as requiring artist-authored geometry — nothing is inferred or
 * substituted.
 *
 * Review lifecycle is pure: {@link editShapeDraft} renames the review copy,
 * {@link acceptShapeDraft} retains the chosen Shape as project feedback, and
 * {@link rejectShapeDraft} retains the artist's reason — the source stays
 * untouched in every case. Applying an approved draft rides the existing
 * commands/Transaction/undo/Save flow (see {@link toDuplicateShapeJson}).
 */

/** Boundedness contract: one review batch covers a reviewable set of drafts. */
export const SHAPE_DRAFT_LIMITS = {
  maxDrafts: 12,
} as const

export type ShapeDraftStatus =
  'proposed' | 'accepted' | 'edited' | 'rejected' | 'needs-artist-geometry'

export interface ShapeDraftSnapshotNode {
  id: string
  name: string
  hasMesh: boolean
  shapeNames: string[]
}

/** Minimal live-context surface the draft inventory reads. */
export interface ShapeDraftAnimationSnapshot {
  nodes: { id: string; name: string; components: string[] }[]
  rig: { shapeInventory: { nodeId: string; shapeNames: string[] }[] }
}

export interface ShapeDraftInput {
  beats: readonly BeatAnalysis[]
  nodes: readonly ShapeDraftSnapshotNode[]
}

export interface ShapeDraft {
  /** Deterministic review id: `draft-<beatId>-<nodeId>` (or `draft-<beatId>`). */
  draftId: string
  beatId: string
  label: string
  nodeId: string
  nodeName: string
  /** Closest-fit source to duplicate; null when topology cannot express the pose. */
  sourceShapeName: string | null
  /** Artist-facing name of the review copy; empty when there is no copy. */
  draftName: string
  status: ShapeDraftStatus
  note: string
  warnings: string[]
  actions: string[]
  /** Retained artist decision: acceptance choice or rejection reason; null while proposed. */
  feedback: string | null
}

export interface ShapeDraftSummary {
  total: number
  proposed: number
  needsArtistGeometry: number
}

export interface ShapeDraftResult {
  drafts: ShapeDraft[]
  warnings: string[]
  summary: ShapeDraftSummary
  note: string
}

/** Existing-command payload that mints the review copy; applied only on approval. */
export interface ShapeDraftCommandJson {
  readonly type: 'DuplicateShape'
  readonly nodeId: string
  readonly shapeId: string
}

export const SHAPE_DRAFT_NOTE =
  'Shape drafts are separate reviewable copies duplicated from a closest-fit Shape ' +
  'with the existing DuplicateShape command — the source Shape keeps its id, name, and ' +
  'vertices and mesh topology is preserved (ADR 0007). Inspect the copy, sculpt or rename ' +
  'it to fit, then accept (the choice is retained as project feedback) or reject (the ' +
  'source stays unchanged). When topology cannot express the pose, artist-authored ' +
  'geometry is required — nothing is inferred or substituted.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nodeById(
  nodes: readonly ShapeDraftSnapshotNode[],
  id: string,
): ShapeDraftSnapshotNode | undefined {
  return nodes.find((node) => node.id === id)
}

function artistGeometryDraft(
  beat: BeatAnalysis,
  nodeId: string,
  nodeName: string,
  warnings: string[],
  detail: string,
): ShapeDraft {
  return {
    draftId: nodeId ? `draft-${beat.beatId}-${nodeId}` : `draft-${beat.beatId}`,
    beatId: beat.beatId,
    label: beat.label,
    nodeId,
    nodeName,
    sourceShapeName: null,
    draftName: '',
    status: 'needs-artist-geometry',
    note:
      'Inadequate topology for a closest-fit draft — artist-authored geometry is required; ' +
      `nothing is inferred or substituted. ${detail}`,
    warnings,
    actions: [
      'Author the missing pose as your own Shape on the target mesh (existing topology cannot express it), then re-run analysis.',
    ],
    feedback: null,
  }
}

/**
 * Propose one reviewable Shape draft per beat whose geometry finding reports a
 * missing pose. Read-only: inputs are only read, never written.
 */
export function proposeShapeDrafts(input: ShapeDraftInput): ShapeDraftResult {
  const beats = Array.isArray(input.beats) ? [...input.beats] : []
  const nodes = Array.isArray(input.nodes) ? [...input.nodes] : []
  const capped = beats.slice(0, SHAPE_DRAFT_LIMITS.maxDrafts)
  const warnings: string[] = []
  if (beats.length > capped.length) {
    warnings.push(
      `Shape drafts cover the first ${SHAPE_DRAFT_LIMITS.maxDrafts} beats — describe fewer missing poses per batch so every draft stays reviewable.`,
    )
  }

  const drafts: ShapeDraft[] = []
  for (const beat of capped) {
    const geometry = beat.geometry
    if (!geometry || geometry.state === 'available' || geometry.state === 'not-checked') {
      continue
    }
    const resolvedIds = Array.isArray(beat.resolvedNodeIds) ? [...beat.resolvedNodeIds] : []
    const firstId = resolvedIds[0] ?? ''
    const firstNode = firstId ? nodeById(nodes, firstId) : undefined
    const nodeName = firstNode?.name ?? (firstId ? firstId : '')

    if (geometry.state === 'no-shapes') {
      drafts.push(
        artistGeometryDraft(
          beat,
          firstId,
          nodeName,
          [...beat.warnings],
          firstId
            ? `Target [${firstId}] carries no Shape inventory for the requested pose.`
            : 'The beat has no resolved target carrying Shape inventory.',
        ),
      )
      continue
    }

    // geometry.state === 'missing-with-suggestion'
    const closestFit = trimText(geometry.closestFit)
    if (!closestFit) {
      drafts.push(
        artistGeometryDraft(
          beat,
          firstId,
          nodeName,
          [...beat.warnings],
          'No closest-fit Shape was identified on the target.',
        ),
      )
      continue
    }
    if (resolvedIds.length === 0) {
      // Defensive: analysis only assesses geometry for resolved targets, so
      // this means the beat changed under us — report it, never drop it.
      drafts.push(
        artistGeometryDraft(
          beat,
          '',
          '',
          [
            ...beat.warnings,
            'The beat reports missing pose geometry but no resolved target — the analysis is stale; re-run analysis before drafting.',
          ],
          'The beat has no resolved target carrying Shape inventory.',
        ),
      )
      continue
    }
    const carrier = resolvedIds
      .map((id) => ({ id, node: nodeById(nodes, id) }))
      .find(({ node }) => node?.shapeNames.includes(closestFit))
    if (!carrier || !carrier.node) {
      // Stale analysis: the suggested source no longer exists live. Never guess.
      drafts.push(
        artistGeometryDraft(
          beat,
          firstId,
          nodeName,
          [
            ...beat.warnings,
            `Closest-fit Shape “${closestFit}” no longer exists on the resolved target — the analysis is stale; re-run analysis before drafting.`,
          ],
          `Closest-fit Shape “${closestFit}” matches no live Shape inventory on the resolved target.`,
        ),
      )
      continue
    }
    if (!carrier.node.hasMesh) {
      drafts.push(
        artistGeometryDraft(
          beat,
          carrier.id,
          carrier.node.name,
          [...beat.warnings],
          `Target [${carrier.id}] carries no mesh to host a Shape copy.`,
        ),
      )
      continue
    }

    const draftName = `${closestFit} draft`
    drafts.push({
      draftId: `draft-${beat.beatId}-${carrier.id}`,
      beatId: beat.beatId,
      label: beat.label,
      nodeId: carrier.id,
      nodeName: carrier.node.name,
      sourceShapeName: closestFit,
      draftName,
      status: 'proposed',
      note:
        `Separate reviewable draft duplicated from closest-fit Shape “${closestFit}” on ` +
        `${carrier.node.name} [${carrier.id}] — the source Shape keeps its id, name, and ` +
        `vertices and mesh topology is preserved (the copy carries the same vertex count). ` +
        `The source is never mutated; duplication mints a separate Shape for artist review.`,
      warnings: [...beat.warnings],
      actions: [
        `Inspect the “${draftName}” copy against “${closestFit}” (source unchanged), sculpt or rename it to fit, then accept or reject the draft.`,
      ],
      feedback: null,
    })
  }

  return {
    drafts,
    warnings,
    summary: {
      total: drafts.length,
      proposed: drafts.filter((draft) => draft.status === 'proposed').length,
      needsArtistGeometry: drafts.filter((draft) => draft.status === 'needs-artist-geometry')
        .length,
    },
    note: SHAPE_DRAFT_NOTE,
  }
}

/** Rename the review copy. The source reference is kept; the project is untouched. */
export function editShapeDraft(draft: ShapeDraft, newName: string): ShapeDraft {
  if (draft.status !== 'proposed' && draft.status !== 'edited' && draft.status !== 'accepted') {
    throw new Error(
      `Shape draft “${draft.draftId}” has no review copy to edit (status ${draft.status}) — only proposed, edited, or accepted drafts can be renamed.`,
    )
  }
  const trimmed = trimText(newName)
  if (!trimmed) {
    throw new Error(
      `Shape draft “${draft.draftId}” needs a non-empty draft name — give the review copy a name and try again.`,
    )
  }
  const wasAccepted = draft.status === 'accepted'
  return {
    ...draft,
    draftName: trimmed,
    status: 'edited',
    // Renaming the review copy never erases an accepted choice: the retained
    // acceptance stays so later work in this Project can still use it.
    feedback: wasAccepted ? draft.feedback : null,
  }
}

/**
 * Accept the draft. Retains the chosen Shape as project-scoped feedback so
 * subsequent animation work in that Project can use the artist's decision.
 */
export function acceptShapeDraft(draft: ShapeDraft): ShapeDraft {
  if (draft.sourceShapeName === null || draft.status === 'needs-artist-geometry') {
    throw new Error(
      `Shape draft “${draft.draftId}” has no duplicable source — supply artist-authored geometry instead of accepting.`,
    )
  }
  if (draft.status === 'rejected') {
    throw new Error(`Shape draft “${draft.draftId}” was rejected — re-propose it before accepting.`)
  }
  const name = trimText(draft.draftName)
  if (!name) {
    throw new Error(`Shape draft “${draft.draftId}” needs a draft name before it can be accepted.`)
  }
  return {
    ...draft,
    status: 'accepted',
    feedback:
      `Accepted “${name}” duplicated from “${draft.sourceShapeName}” on ${draft.nodeName} ` +
      `[${draft.nodeId}] — retained as the artist-approved Shape for this Project; the source Shape is unchanged.`,
  }
}

/** Reject the draft with the artist's reason retained; the source stays unchanged. */
export function rejectShapeDraft(draft: ShapeDraft, reason: string): ShapeDraft {
  if (draft.status === 'needs-artist-geometry') {
    throw new Error(
      `Shape draft “${draft.draftId}” has no review copy to reject — it already asks for artist-authored geometry; supply your own Shape instead.`,
    )
  }
  const trimmed = trimText(reason)
  if (!trimmed) {
    throw new Error(
      `Rejecting shape draft “${draft.draftId}” needs a reason — say why the copy did not fit so later work can use it.`,
    )
  }
  const copy = draft.draftName ? `“${draft.draftName}”` : 'the review copy'
  return {
    ...draft,
    status: 'rejected',
    feedback:
      `Rejected ${copy}` +
      (draft.sourceShapeName ? ` duplicated from “${draft.sourceShapeName}”` : '') +
      `: ${trimmed} — the source Shape is unchanged; feedback retained for this Project.`,
  }
}

/**
 * Resolve the draft's source against live Shape inventory by exact name.
 * Null when the source is missing live — the caller re-runs analysis instead
 * of guessing (stale blocking at the draft seam).
 */
export function resolveDraftSourceId(
  draft: ShapeDraft,
  liveShapes: readonly { readonly id: string; readonly name: string }[],
): string | null {
  if (draft.sourceShapeName === null) return null
  const hit = (Array.isArray(liveShapes) ? liveShapes : []).find(
    (shape) => shape.name === draft.sourceShapeName,
  )
  return hit ? hit.id : null
}

/**
 * Build the existing-command payload that mints the review copy. Approval and
 * execution stay on the existing commands/Transaction/undo/Save flow — this
 * only describes the duplication.
 */
export function toDuplicateShapeJson(
  draft: ShapeDraft,
  shapeId: string | null,
): ShapeDraftCommandJson {
  const nodeId = trimText(draft.nodeId)
  const resolved = trimText(shapeId)
  if (!nodeId || !resolved) {
    throw new Error(
      `Shape draft “${draft.draftId}” cannot duplicate yet — resolve the stable Scene Node id and the live source Shape id first (re-run analysis when stale).`,
    )
  }
  return { type: 'DuplicateShape', nodeId, shapeId: resolved }
}

/**
 * Adapt the live Context Snapshot digest to the draft inventory surface.
 * Read-only: the returned rows are freshly copied.
 */
export function toShapeDraftSnapshot(
  animation: ShapeDraftAnimationSnapshot,
): ShapeDraftSnapshotNode[] {
  const nodes = Array.isArray(animation?.nodes) ? animation.nodes : []
  const rig = (animation as ShapeDraftAnimationSnapshot | null | undefined)?.rig
  const inventory = rig && Array.isArray(rig.shapeInventory) ? rig.shapeInventory : []
  return nodes.map((node) => {
    const entry = inventory.find((row) => row.nodeId === node.id)
    return {
      id: node.id,
      name: node.name,
      hasMesh: Array.isArray(node.components) && node.components.includes('mesh'),
      shapeNames:
        entry && Array.isArray(entry.shapeNames)
          ? entry.shapeNames.filter(
              (name): name is string => typeof name === 'string' && name.trim() !== '',
            )
          : [],
    }
  })
}
