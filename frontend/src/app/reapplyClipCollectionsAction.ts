import type { EnginePublic } from '../engine'
import type { DispatchCommand, UndoStack } from '../engine/commands'
import {
  DeleteCollectionPlacementCommand,
  PlaceCollectionCommand,
  SetClipInstanceSpeedCommand,
  SetClipInstanceStartTimeCommand,
} from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import type { ClipCollection } from '../engine/clipCollection'
import type { SceneNode } from '../engine/sceneNode'

export type ReapplyClipCollectionsResult =
  | {
      readonly ok: true
      readonly message: string
      readonly refreshedCount: number
      readonly skippedCount: number
      readonly skipped: readonly string[]
      /** Number of member lanes whose start/speed edits were restored. */
      readonly preservedEditCount: number
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

/**
 * True when re-placing this collection would cleanly create at least one
 * member lane (mirrors Engine.placeCollection success condition without
 * mutating state). Also false when any currently-matching binding dangles
 * (bound clip deleted): placeCollection throws mid-loop on the first missing
 * clip, leaving a partial placement, so such placements are kept untouched.
 */
function wouldPlaceSucceed(
  engine: EnginePublic,
  parent: SceneNode,
  collection: ClipCollection,
): boolean {
  let valid = 0
  for (const node of walkPreOrder(parent)) {
    const sem = node.semanticName
    if (!sem) continue
    if (!collection.hasBinding(sem)) continue
    const clipId = collection.getBinding(sem)
    if (!clipId) continue
    try {
      engine.getClip(clipId)
    } catch {
      return false
    }
    valid += 1
  }
  return valid > 0
}

/**
 * Delete and re-place every collection placement under `parentNodeId`.
 *
 * Scope is intentionally the manager parent only (not project-wide).
 * Each placement is re-placed at its original `startTime` so timeline layout
 * is preserved and current descendants matching by semanticName get (re)bound
 * — e.g. a deleted child re-added with the same semantic picks up clips.
 *
 * Member retime/respeed edits are preserved by nodeId: surviving nodes keep
 * their old startTime/speed, new nodes get placement defaults. Placements
 * that would no longer match any descendant are kept untouched (skipped).
 *
 * Leaf commands only, merged into one undo step (never merge Transactions).
 */
export function executeReapplyClipCollections(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  parentNodeId: string,
): ReapplyClipCollectionsResult {
  const fail = (error: string): ReapplyClipCollectionsResult => ({ ok: false, error })
  let parent: SceneNode
  try {
    parent = engine.getNode(parentNodeId)
  } catch {
    return fail(`Parent not found: ${parentNodeId}`)
  }
  const snapshots = [...parent.collectionPlacements].map((p) => ({
    placementId: p.id,
    collectionId: p.collectionId,
    startTime: p.startTime,
  }))
  if (snapshots.length === 0) {
    return {
      ok: true,
      message: 'No placed collections to refresh',
      refreshedCount: 0,
      skippedCount: 0,
      skipped: [],
      preservedEditCount: 0,
    }
  }
  const EPS = 1e-9
  let records = 0
  let refreshed = 0
  let preserved = 0
  const skipped: string[] = []
  for (const snap of snapshots) {
    let collection: ClipCollection
    try {
      collection = engine.getClipCollection(snap.collectionId)
    } catch {
      skipped.push(`placement ${snap.placementId.slice(0, 6)} kept (collection missing)`)
      continue
    }
    let freshParent: SceneNode
    try {
      freshParent = engine.getNode(parentNodeId)
    } catch {
      mergeRecords(undoStack, records)
      return fail('Parent no longer exists — refresh stopped partway.')
    }
    if (!wouldPlaceSucceed(engine, freshParent, collection)) {
      skipped.push(`"${collection.name}" kept (no matching descendants)`)
      continue
    }
    const oldByNode = new Map<string, { startTime: number; speed: number }>()
    try {
      for (const m of engine.getPlacementMembers(snap.placementId)) {
        oldByNode.set(m.nodeId, {
          startTime: m.instance.startTime,
          speed: m.instance.speed,
        })
      }
    } catch {
      // placement vanished mid-refresh; treat as skipped
      skipped.push(`"${collection.name}" kept (placement missing)`)
      continue
    }
    const delRes = dispatch(new DeleteCollectionPlacementCommand({ placementId: snap.placementId }))
    if (!delRes.ok) {
      skipped.push(`"${collection.name}" kept (${delRes.error.message})`)
      continue
    }
    records += 1
    const placeRes = dispatch(
      new PlaceCollectionCommand({
        collectionId: snap.collectionId,
        parentNodeId,
        startTime: snap.startTime,
      }),
    )
    if (!placeRes.ok) {
      // Pre-check should make this unreachable; old placement is already
      // deleted so report clearly rather than silently losing it.
      skipped.push(`"${collection.name}" removed but re-place failed (${placeRes.error.message})`)
      continue
    }
    records += 1
    refreshed += 1
    const newPlacementId = (placeRes.inverse as { placementId: string }).placementId
    let newMembers: readonly {
      nodeId: string
      instance: { id: string; startTime: number; speed: number }
    }[]
    try {
      newMembers = engine.getPlacementMembers(newPlacementId) as typeof newMembers
    } catch {
      continue
    }
    for (const newMember of newMembers) {
      const old = oldByNode.get(newMember.nodeId)
      if (!old) continue
      if (Math.abs(old.startTime - newMember.instance.startTime) > EPS) {
        const r = dispatch(
          new SetClipInstanceStartTimeCommand({
            nodeId: newMember.nodeId,
            instanceId: newMember.instance.id,
            startTime: old.startTime,
          }),
        )
        if (r.ok) {
          records += 1
          preserved += 1
        }
      }
      if (Math.abs(old.speed - newMember.instance.speed) > EPS) {
        const r = dispatch(
          new SetClipInstanceSpeedCommand({
            nodeId: newMember.nodeId,
            instanceId: newMember.instance.id,
            speed: old.speed,
          }),
        )
        if (r.ok) {
          records += 1
          preserved += 1
        }
      }
    }
  }
  mergeRecords(undoStack, records)
  const bits = [`Refreshed ${refreshed} placement(s)`]
  if (preserved > 0) bits.push(`${preserved} edit(s) preserved`)
  if (skipped.length > 0) bits.push(`${skipped.length} kept (${skipped.join('; ')})`)
  return {
    ok: true,
    message: bits.join(' · '),
    refreshedCount: refreshed,
    skippedCount: skipped.length,
    skipped,
    preservedEditCount: preserved,
  }
}
