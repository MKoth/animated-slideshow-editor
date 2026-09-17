import type { EnginePublic } from '../engine'
import type { DispatchCommand, UndoStack } from '../engine/commands'
import {
  DeleteClipCollectionCommand,
  DeleteClipCommand,
  RemoveClipCommand,
} from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import { mergeUndoRecords } from './undoMerge'

export type DeleteClipCollectionResult =
  | {
      readonly ok: true
      readonly message: string
      /** Member clips deleted alongside the collection (exclusive owners only). */
      readonly deletedClipCount: number
    }
  | { readonly ok: false; readonly error: string }

/**
 * Delete a clip collection together with its member clips.
 *
 * Clips bound by another collection are shared owners: deleting them would
 * leave dangling bindings behind, so they are kept (the message says so).
 * Timeline placements referencing deleted clips are removed first (across all
 * slides), then the clips, then the collection.
 *
 * Commands are dispatched individually (not wrapped in TransactionCommand) and
 * merged afterwards: merged entries replay leaf children, while a nested
 * 'Transaction' child has no undo/redo handler and would silently skip its
 * inner undos. The whole batch is one undo step.
 */
export function executeDeleteClipCollection(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  collectionId: string,
): DeleteClipCollectionResult {
  const fail = (error: string): DeleteClipCollectionResult => ({ ok: false, error })
  try {
    const col = engine.getClipCollection(collectionId)
    const allCols = engine.clipCollections
    const clipIds = [...col.bindings.values()]
    // Only delete clips exclusively owned by this collection (not shared)
    const exclusiveClipIds = clipIds.filter(
      (cid) =>
        !allCols.some((c) => c.id !== collectionId && [...c.bindings.values()].includes(cid)),
    )
    // Collect all ClipInstances referencing exclusive clips
    const instancesToRemove: { nodeId: string; instanceId: string }[] = []
    if (exclusiveClipIds.length > 0 && engine.project) {
      for (const slide of engine.project.slides) {
        for (const node of walkPreOrder(slide.scene.root)) {
          for (const inst of node.clipInstances) {
            if (exclusiveClipIds.includes(inst.clipId)) {
              instancesToRemove.push({ nodeId: node.id, instanceId: inst.id })
            }
          }
        }
      }
    }
    let records = 0
    for (const { nodeId, instanceId } of instancesToRemove) {
      const res = dispatch(new RemoveClipCommand({ nodeId, instanceId }))
      if (!res.ok) {
        mergeUndoRecords(undoStack, records)
        return fail(`Collection not deleted: ${res.error.message}`)
      }
      records += 1
    }
    const existingExclusive = exclusiveClipIds.filter((cid) => {
      try {
        engine.getClip(cid)
        return true
      } catch {
        return false
      }
    })
    for (const cid of existingExclusive) {
      const res = dispatch(new DeleteClipCommand({ clipId: cid }))
      if (!res.ok) {
        mergeUndoRecords(undoStack, records)
        return fail(`Collection not deleted: ${res.error.message}`)
      }
      records += 1
    }
    const resCol = dispatch(new DeleteClipCollectionCommand({ collectionId }))
    if (!resCol.ok) {
      mergeUndoRecords(undoStack, records)
      return fail(resCol.error.message)
    }
    records += 1
    mergeUndoRecords(undoStack, records)
    if (existingExclusive.length > 0) {
      return {
        ok: true,
        message: `Collection deleted — ${existingExclusive.length} clip(s) also deleted`,
        deletedClipCount: existingExclusive.length,
      }
    }
    if (clipIds.length > 0 && exclusiveClipIds.length === 0) {
      return {
        ok: true,
        message: 'Collection deleted — clips kept (shared with other collections)',
        deletedClipCount: 0,
      }
    }
    return { ok: true, message: 'Collection deleted', deletedClipCount: 0 }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}
