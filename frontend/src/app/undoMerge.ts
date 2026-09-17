import type { UndoStack } from '../engine/commands'

/**
 * Merge the last `count` leaf command records into a single undo transaction.
 *
 * Best-effort: when the merge fails the entries stay separate but valid, and
 * on failure a warning is emitted because callers promise one undo step.
 * Never merge an entry that is itself a Transaction (nested Transactions have
 * no undo handler, see undoStack.ts).
 */
export function mergeUndoRecords(undoStack: UndoStack, count: number): void {
  if (count <= 1) return
  try {
    undoStack.mergeLastAsTransaction(count)
  } catch (error) {
    console.warn(
      `[undo] failed to merge ${count} records into one step`,
      error instanceof Error ? error.message : error,
    )
  }
}
