import type { ExtractableKeyframe } from './clipExtraction'
import type { KeyframeTarget } from './keyframeTarget'
import type { EnginePublic } from './internal'
import type { DispatchCommand } from './commands/dispatcher'
import type { UndoStack } from './commands/undoStack'
import { ExtractToClipCommand } from './commands/extractToClipCommand'
import { CreateClipCollectionCommand } from './commands/createClipCollectionCommand'
import { SetClipCollectionBindingsCommand } from './commands/setClipCollectionBindingsCommand'
import { DeleteClipCommand } from './commands/deleteClipCommand'
import { DeleteKeyframesCommand } from './commands/deleteKeyframesCommand'
import { RemoveClipCommand } from './commands/removeClipCommand'

/** Tolerance (seconds) for time-segment boundary comparisons. */
export const SEGMENT_EPS = 1e-9

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

export function validateSegmentRange(
  from: number,
  to: number,
  slideDuration: number,
): string | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Enter numeric From and To times.'
  if (from < 0) return 'From must be ≥ 0.'
  if (to > slideDuration + SEGMENT_EPS)
    return `To must be ≤ slide duration (${slideDuration.toFixed(2)}s).`
  if (!(to - from > SEGMENT_EPS)) return 'Require From < To with a non-zero segment.'
  return null
}

export function defaultSegmentRange(
  times: readonly number[],
  slideDuration: number,
): { from: number; to: number } {
  if (times.length === 0) return { from: 0, to: Math.max(slideDuration, 1) }
  let min = Infinity
  let max = -Infinity
  for (const t of times) {
    if (!Number.isFinite(t)) continue
    if (t < min) min = t
    if (t > max) max = t
  }
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return { from: 0, to: Math.max(slideDuration, 1) }
  if (max - min > SEGMENT_EPS) return { from: min, to: max }
  // Single-point selection: expand so the segment stays usable and aligned
  const from = Math.max(0, min - 0.5)
  const to = Math.min(Math.max(slideDuration, from + SEGMENT_EPS), max + 0.5)
  if (to - from > SEGMENT_EPS) return { from, to }
  return { from: 0, to: Math.max(slideDuration, 1) }
}

export function inSegment(time: number, from: number, to: number): boolean {
  return time >= from - SEGMENT_EPS && time <= to + SEGMENT_EPS
}

/**
 * Whether a clip instance fits completely inside the segment: its first
 * played second is at/after From and its last played second at/before To.
 * `start`/`end` are timeline seconds (end = start + visual duration, i.e.
 * clip duration adjusted by instance speed).
 */
export function clipInstanceFits(start: number, end: number, from: number, to: number): boolean {
  return start >= from - SEGMENT_EPS && end <= to + SEGMENT_EPS
}

export function parseSec(raw: string): number | null {
  const n = parseFloat(raw.trim())
  return Number.isFinite(n) ? n : null
}

export function formatSec(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : ''
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function nextClipNameForNode(nodeName: string, clips: readonly { name: string }[]): string {
  const prefix = `${nodeName} Clip `
  let max = 0
  for (const c of clips) {
    if (c.name.startsWith(prefix)) {
      const suffix = c.name.slice(prefix.length).trim()
      const n = parseInt(suffix, 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

/** Ensure a clip name is unique within the batch (engine allows dupes, UX should not). */
export function uniqueClipName(base: string, taken: Set<string>): string {
  const trimmed = base.trim() || 'Extracted Clip'
  if (!taken.has(trimmed)) {
    taken.add(trimmed)
    return trimmed
  }
  let i = 2
  while (taken.has(`${trimmed} ${i}`)) i += 1
  const name = `${trimmed} ${i}`
  taken.add(name)
  return name
}

export function defaultSegmentCollectionName(parentName: string, from: number, to: number): string {
  return `${parentName} ${from.toFixed(2)}-${to.toFixed(2)}s`
}

// ---------------------------------------------------------------------------
// Target classification (mirrors ExtractToClipCommand's supported channels)
// ---------------------------------------------------------------------------

/** Whether ExtractToClipCommand stores this target kind (others are skipped, never fail). */
export function isClipStorableTarget(target: KeyframeTarget): boolean {
  if (target.kind === 'node') return 'property' in target || 'parameter' in target
  return (
    target.kind === 'visible' ||
    target.kind === 'zIndex' ||
    target.kind === 'morph' ||
    target.kind === 'circle' ||
    target.kind === 'shadow'
  )
}

export function describeTargetKind(target: KeyframeTarget): string {
  if (target.kind === 'node' && 'parameter' in target) return 'material'
  return target.kind
}

/**
 * Canonical per-track grouping key for source-keyframe deletion.
 * Same scheme as AnimationManagerModal's delete-confirm grouping: one
 * DeleteKeyframesCommand per (track target).
 */
export function deleteGroupKey(target: KeyframeTarget): string {
  if (target.kind === 'node' && 'property' in target)
    return `node:${target.nodeId}:${target.property}`
  if (target.kind === 'node' && 'parameter' in target)
    return `node-param:${target.nodeId}:${target.parameter}`
  if (target.kind === 'visible') return `visible:${target.nodeId}`
  if (target.kind === 'morph') return `morph:${target.nodeId}`
  if (target.kind === 'circle') return `circle:${target.nodeId}:${target.property}`
  if (target.kind === 'shadow') return `shadow:${target.nodeId}:${target.property}`
  if (target.kind === 'dataLabel') return `dataLabel:${target.nodeId}:${target.label}`
  if (target.kind === 'table') return `table:${target.nodeId}:${target.property}`
  if (target.kind === 'symmetry') return `symmetry:${target.nodeId}`
  if (target.kind === 'zIndex') return `zIndex:${target.nodeId}`
  if (target.kind === 'control') return `control:${target.nodeId}:${target.controlKey}`
  if (target.kind === 'clip') return `clip:${target.clipId}:${target.channel}`
  return `unknown:${(target as { nodeId?: string }).nodeId ?? ''}`
}

export interface SegmentDeleteEntry {
  readonly target: KeyframeTarget
  readonly time: number
  readonly keyframeId: string
}

export interface SegmentDeleteGroup {
  readonly target: KeyframeTarget
  readonly keyframeIds: string[]
}

/**
 * Plan source-keyframe deletion for a segment. keepFirst/keepLast spare the
 * globally earliest/latest keyframe instant(s) *across the whole delete set*,
 * so back-to-back collections can share a 1-frame overlap pose. All entries
 * at the boundary instant are spared (time-based, not a single index), which
 * keeps tied boundary poses whole. Remaining entries are grouped per track
 * (one DeleteKeyframesCommand per track target).
 */
export function planSegmentDeletes(
  entries: readonly SegmentDeleteEntry[],
  keepFirst: boolean,
  keepLast: boolean,
): SegmentDeleteGroup[] {
  if (entries.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const e of entries) {
    if (e.time < min) min = e.time
    if (e.time > max) max = e.time
  }
  const deletable = entries.filter((e) => {
    if (keepFirst && Math.abs(e.time - min) <= SEGMENT_EPS) return false
    if (keepLast && Math.abs(e.time - max) <= SEGMENT_EPS) return false
    return true
  })
  const byTrack = new Map<
    string,
    { target: KeyframeTarget; items: { time: number; id: string }[] }
  >()
  for (const e of deletable) {
    const key = deleteGroupKey(e.target)
    const g = byTrack.get(key)
    if (g) g.items.push({ time: e.time, id: e.keyframeId })
    else byTrack.set(key, { target: e.target, items: [{ time: e.time, id: e.keyframeId }] })
  }
  const out: SegmentDeleteGroup[] = []
  for (const { target, items } of byTrack.values()) {
    const ids = [...items].sort((a, b) => a.time - b.time).map((s) => s.id)
    if (ids.length > 0) out.push({ target, keyframeIds: ids })
  }
  return out
}

// ---------------------------------------------------------------------------
// Batch executor: N extractions + 1 collection + deletes, one undo step
// ---------------------------------------------------------------------------

export interface SegmentObjectPlan {
  readonly nodeId: string
  readonly nodeName: string
  /** Trimmed semantic name; required non-empty (validated). */
  readonly semanticName: string
  readonly clipName: string
  /** Clip category; defaults to the object's semantic name. */
  readonly category: string
  /** In-range, param-filtered source keyframes (all target kinds). */
  readonly keyframes: readonly ExtractableKeyframe[]
  /**
   * Selected clip instances fully contained in the segment. The first one
   * supplies the collection binding (existing clip, reused as-is); selecting
   * clips and keyframes on the same object is rejected (one binding per
   * semantic name).
   */
  readonly clips?: readonly SegmentClipRef[]
}

/** A clip instance selected for inclusion, with precomputed timeline span. */
export interface SegmentClipRef {
  readonly nodeId: string
  readonly instanceId: string
  readonly clipId: string
  readonly clipName: string
  /** Instance startTime (seconds). */
  readonly start: number
  /** start + visual duration, i.e. the last played second. */
  readonly end: number
}

/** A clip instance available to the segment wizard (all placements, unfiltered). */
export interface SegmentSourceClip extends SegmentClipRef {
  readonly nodeName: string
  readonly semanticName?: string
}

export interface SegmentCollectionPlan {
  readonly parentNodeId: string
  readonly from: number
  readonly to: number
  readonly objects: readonly SegmentObjectPlan[]
  readonly collectionName: string
  readonly deleteOrphans: boolean
  readonly keepFirst: boolean
  readonly keepLast: boolean
  /** Remove included clip placements from the timeline (library clips are kept). */
  readonly removeClipInstances?: boolean
  /** Pin each minted clip's start to the pose evaluated at From. */
  readonly bakeStart?: boolean
  /** Pin each minted clip's end to the pose evaluated at To. */
  readonly bakeEnd?: boolean
  /**
   * Keep per-object clip names exactly as given (duplicates allowed — clips live
   * in different categories, so sharing a name is fine). Defaults to true, which
   * uniquifies colliding names within the batch ("Name", "Name 2", …).
   */
  readonly dedupeClipNames?: boolean
  /**
   * Replace mode: rebind this existing collection instead of creating a new one.
   * Mutually exclusive with the create path — collectionName is ignored/locked.
   * Included semantic names are overwritten, untouched names keep their clips.
   */
  readonly replaceCollectionId?: string
}

export interface SegmentCreatedClip {
  readonly nodeId: string
  readonly nodeName: string
  readonly semanticName: string
  readonly clipId: string
  readonly clipName: string
  readonly keyframeCount: number
}

export type SegmentExecutionResult =
  | {
      readonly ok: true
      readonly clips: readonly SegmentCreatedClip[]
      /** semanticName → clipId for bindings that reuse existing clips. */
      readonly reused: readonly { semanticName: string; clipId: string; clipName: string }[]
      readonly collectionId: string
      readonly collectionName: string
      readonly extractedCount: number
      readonly skippedCount: number
      readonly skippedKinds: readonly string[]
      readonly deletedCount: number
      readonly removedInstanceCount: number
      readonly warnings: readonly string[]
      /** True when this was a replace (rebind) rather than a create. */
      readonly replaced?: boolean
      /** Displaced old clips that were deleted (replace mode only). */
      readonly deletedOldClipIds?: readonly string[]
      /** Shared clips that were kept because another collection still binds them. */
      readonly keptSharedClipNames?: readonly string[]
    }
  | { readonly ok: false; readonly error: string }

function mergeRecords(undoStack: UndoStack, records: number): void {
  if (records <= 1) return
  try {
    undoStack.mergeLastAsTransaction(records)
  } catch {
    /* best-effort: undo entries stay separate but valid */
  }
}

export function executeSegmentToCollection(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  plan: SegmentCollectionPlan,
): SegmentExecutionResult {
  const fail = (error: string): SegmentExecutionResult => ({ ok: false, error })
  if (
    !Number.isFinite(plan.from) ||
    !Number.isFinite(plan.to) ||
    !(plan.to - plan.from > SEGMENT_EPS)
  ) {
    return fail('Invalid time segment: require From < To.')
  }
  const isReplace = plan.replaceCollectionId !== undefined && plan.replaceCollectionId !== ''
  let replaceOldBindings: Record<string, string> = {}
  let replaceOldName = ''
  if (isReplace) {
    try {
      const oldCol = engine.getClipCollection(plan.replaceCollectionId!)
      replaceOldBindings = oldCol.getBindingsObject()
      replaceOldName = oldCol.name
    } catch {
      return fail('Collection to replace no longer exists — reopen the dialog.')
    }
  } else {
    const collectionName = plan.collectionName.trim()
    if (!collectionName) return fail('Collection name is required.')
  }
  const collectionName = isReplace ? replaceOldName : plan.collectionName.trim()
  if (plan.objects.length === 0) return fail('Select at least one object.')

  // Partition per object into clip-storable vs skipped; gather delete entries.
  // Objects may contribute either selected orphan keyframes (minted into a new
  // clip) or selected contained clips (existing clip reused as-is) — never
  // both, since a collection holds one clip per semantic name.
  const ready: { obj: SegmentObjectPlan; extractable: ExtractableKeyframe[]; clipName: string }[] =
    []
  const reused: { semanticName: string; clipId: string; clipName: string }[] = []
  const removals: { nodeId: string; instanceId: string; clipName: string }[] = []
  const deleteEntries: SegmentDeleteEntry[] = []
  const skippedKinds = new Set<string>()
  let skippedCount = 0
  const warnings: string[] = []
  for (const obj of plan.objects) {
    const sem = obj.semanticName.trim()
    if (!sem) {
      return fail(
        `"${obj.nodeName}" has no Semantic Name — set it in Inspector before creating a collection.`,
      )
    }
    const clips = obj.clips ?? []
    if (clips.length > 0 && obj.keyframes.length > 0) {
      return fail(
        `"${obj.nodeName}" has both keyframes and a clip selected — deselect either its parameters or its clip (one clip per object in a collection).`,
      )
    }
    if (clips.length > 0) {
      // Reuse the existing clip as-is: verify the placement still exists and fits.
      for (const ref of clips) {
        let instance
        try {
          const node = engine.getNode(ref.nodeId)
          instance = node.clipInstances.find((inst) => inst.id === ref.instanceId)
        } catch {
          instance = undefined
        }
        if (!instance) {
          return fail(
            `Clip "${ref.clipName}" on "${obj.nodeName}" no longer exists — reopen the wizard.`,
          )
        }
        let clipExists = true
        try {
          engine.getClip(ref.clipId)
        } catch {
          clipExists = false
        }
        if (!clipExists) {
          return fail(`Clip "${ref.clipName}" no longer exists — reopen the wizard.`)
        }
        if (!clipInstanceFits(ref.start, ref.end, plan.from, plan.to)) {
          return fail(
            `Clip "${ref.clipName}" on "${obj.nodeName}" no longer fits in the segment — reopen the wizard.`,
          )
        }
      }
      const first = clips[0]!
      const distinctIds = [...new Set(clips.map((c) => c.clipId))]
      if (distinctIds.length > 1) {
        warnings.push(
          `"${obj.nodeName}": ${clips.length} clips selected — binding "${first.clipName}" (first), the rest skipped.`,
        )
      }
      reused.push({ semanticName: sem, clipId: first.clipId, clipName: first.clipName })
      if (plan.removeClipInstances) {
        for (const ref of clips) {
          removals.push({ nodeId: ref.nodeId, instanceId: ref.instanceId, clipName: ref.clipName })
        }
      }
      continue
    }
    if (!obj.clipName.trim()) return fail(`Clip name is required for "${obj.nodeName}".`)
    const storable: ExtractableKeyframe[] = []
    for (const kf of obj.keyframes) {
      deleteEntries.push({ target: kf.target, time: kf.time, keyframeId: kf.keyframeId })
      if (isClipStorableTarget(kf.target)) storable.push(kf)
      else {
        skippedCount += 1
        skippedKinds.add(describeTargetKind(kf.target))
      }
    }
    if (storable.length === 0) {
      warnings.push(
        `"${obj.nodeName}": no clip-storable keyframes in the segment — clip skipped${plan.deleteOrphans ? ' (orphans still deleted)' : ''}.`,
      )
      continue
    }
    ready.push({ obj, extractable: storable, clipName: obj.clipName.trim() })
  }
  if (ready.length === 0 && reused.length === 0) {
    return fail('Nothing selected: check parameters or clips to include in the segment.')
  }
  if (plan.dedupeClipNames !== false) {
    const takenNames = new Set<string>()
    for (const r of ready) {
      r.clipName = uniqueClipName(r.clipName, takenNames)
    }
  }

  const duration = plan.to - plan.from
  const extractCmds = ready.map(
    (r) =>
      new ExtractToClipCommand({
        keyframes: [...r.extractable],
        name: r.clipName,
        duration,
        category: r.obj.category,
        rangeStart: plan.from,
        rangeEnd: plan.to,
        ...(plan.bakeStart ? { bakeStartingPose: true } : {}),
        ...(plan.bakeEnd ? { bakeEndingPose: true } : {}),
      }),
  )
  // Pre-validate everything before mutating (keeps the batch atomic for common failures).
  try {
    for (const cmd of extractCmds) cmd.validate(engine)
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }

  let records = 0
  const clips: SegmentCreatedClip[] = []
  for (let i = 0; i < extractCmds.length; i++) {
    const res = dispatch(extractCmds[i]!)
    if (!res.ok) {
      mergeRecords(undoStack, records)
      return fail(`Extraction failed for "${ready[i]!.obj.nodeName}": ${res.error.message}`)
    }
    records += 1
    clips.push({
      nodeId: ready[i]!.obj.nodeId,
      nodeName: ready[i]!.obj.nodeName,
      semanticName: ready[i]!.obj.semanticName.trim(),
      clipId: res.inverse.clipId,
      clipName: ready[i]!.clipName,
      keyframeCount: ready[i]!.extractable.length,
    })
  }

  const bindings: Record<string, string> = {}
  for (const c of clips) {
    if (bindings[c.semanticName] !== undefined) {
      warnings.push(
        `Duplicate semantic name "${c.semanticName}" — "${c.clipName}" replaced the earlier binding.`,
      )
    }
    bindings[c.semanticName] = c.clipId
  }
  for (const r of reused) {
    if (bindings[r.semanticName] !== undefined) {
      warnings.push(
        `Duplicate semantic name "${r.semanticName}" — "${r.clipName}" replaced the earlier binding.`,
      )
    }
    bindings[r.semanticName] = r.clipId
  }
  let collectionId: string
  const deletedOldClipIds: string[] = []
  const keptSharedClipNames: string[] = []
  if (isReplace) {
    const targetId = plan.replaceCollectionId!
    const merged: Record<string, string> = { ...replaceOldBindings, ...bindings }
    const bindRes = dispatch(
      new SetClipCollectionBindingsCommand({ collectionId: targetId, bindings: merged }),
    )
    if (!bindRes.ok) {
      mergeRecords(undoStack, records)
      return fail(`Clips created but rebinding failed: ${bindRes.error.message}`)
    }
    records += 1
    collectionId = targetId
    // Conservative old-clip deletion: only when no other collection binds it
    // and no clip instance places it. Shared clips are kept with a warning.
    for (const sem of Object.keys(bindings)) {
      const oldId = replaceOldBindings[sem]
      const newId = merged[sem]!
      if (!oldId || oldId === newId) continue
      let boundElsewhere = false
      let boundName = ''
      for (const col of engine.clipCollections) {
        if (col.id === targetId) continue
        try {
          if ([...col.bindings.values()].includes(oldId)) {
            boundElsewhere = true
            try {
              boundName = engine.getClip(oldId).name
            } catch {
              boundName = oldId.slice(0, 8)
            }
            break
          }
        } catch {
          continue
        }
      }
      if (boundElsewhere) {
        keptSharedClipNames.push(boundName || oldId.slice(0, 8))
        warnings.push(
          `Old clip "${boundName || oldId.slice(0, 8)}" kept — another collection still binds it.`,
        )
        continue
      }
      let placed = false
      try {
        placed = engine.isClipReferenced(oldId)
      } catch {
        placed = false
      }
      if (placed) {
        try {
          const nm = engine.getClip(oldId).name
          warnings.push(`Old clip "${nm}" kept — still placed on the timeline.`)
        } catch {
          warnings.push(`Old clip kept — still placed on the timeline.`)
        }
        continue
      }
      const delRes = dispatch(new DeleteClipCommand({ clipId: oldId }))
      if (!delRes.ok) {
        // Best-effort cleanup: keep the clip and warn instead of failing the rebind.
        try {
          const nm = engine.getClip(oldId).name
          warnings.push(`Old clip "${nm}" kept: ${delRes.error.message}`)
        } catch {
          warnings.push(`Old clip kept: ${delRes.error.message}`)
        }
        continue
      }
      records += 1
      deletedOldClipIds.push(oldId)
    }
  } else {
    const colRes = dispatch(
      new CreateClipCollectionCommand({
        name: collectionName,
        bindings,
        sourceNodeId: plan.parentNodeId,
      }),
    )
    if (!colRes.ok) {
      mergeRecords(undoStack, records)
      return fail(`Clips created but collection failed: ${colRes.error.message}`)
    }
    records += 1
    collectionId = colRes.inverse.collectionId
  }

  let deletedCount = 0
  if (plan.deleteOrphans && deleteEntries.length > 0) {
    const groups = planSegmentDeletes(deleteEntries, plan.keepFirst, plan.keepLast)
    // Dispatch deletes individually (not as one TransactionCommand): merged
    // history entries nest opaque children, and a nested 'Transaction' child
    // has no undo/redo handler — leaf entries keep one-step undo working.
    for (const g of groups) {
      const delRes = dispatch(
        new DeleteKeyframesCommand({ target: g.target, keyframeIds: g.keyframeIds }),
      )
      if (!delRes.ok) {
        mergeRecords(undoStack, records)
        return fail(
          isReplace
            ? `Collection "${collectionName}" rebound, but deleting orphans failed: ${delRes.error.message}`
            : `Collection "${collectionName}" created, but deleting orphans failed: ${delRes.error.message}`,
        )
      }
      records += 1
      deletedCount += g.keyframeIds.length
    }
  }

  let removedInstanceCount = 0
  if (removals.length > 0) {
    // Individual dispatches (not one TransactionCommand): nested Transaction
    // children have no undo/redo handler, leaf entries keep one-step undo working.
    for (const r of removals) {
      const remRes = dispatch(new RemoveClipCommand({ nodeId: r.nodeId, instanceId: r.instanceId }))
      if (!remRes.ok) {
        mergeRecords(undoStack, records)
        return fail(
          isReplace
            ? `Collection "${collectionName}" rebound, but removing clip "${r.clipName}" failed: ${remRes.error.message}`
            : `Collection "${collectionName}" created, but removing clip "${r.clipName}" failed: ${remRes.error.message}`,
        )
      }
      records += 1
      removedInstanceCount += 1
    }
  }

  mergeRecords(undoStack, records)
  return {
    ok: true,
    clips,
    reused,
    collectionId,
    collectionName,
    extractedCount: ready.reduce((n, r) => n + r.extractable.length, 0),
    skippedCount,
    skippedKinds: [...skippedKinds].sort(),
    deletedCount,
    removedInstanceCount,
    warnings,
    ...(isReplace
      ? {
          replaced: true as const,
          deletedOldClipIds,
          keptSharedClipNames,
        }
      : {}),
  }
}
