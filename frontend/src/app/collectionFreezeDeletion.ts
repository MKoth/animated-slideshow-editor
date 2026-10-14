import type { EnginePublic } from '../engine'
import type { DispatchCommand } from '../engine/commands/dispatcher'
import type { Command } from '../engine/commands/command'
import {
  DeleteCollectionPlacementCommand,
  DeleteKeyframesCommand,
  SetKeyframeFreezeLinkCommand,
  TransactionCommand,
} from '../engine/commands'
import type { KeyframeTarget } from '../engine/keyframeTarget'

export type FreezeDeleteChoice = 'delete' | 'orphan'

export interface FreezeDeleteResult {
  readonly ok: boolean
  readonly error?: string
  /** Member clip lanes removed with the placement. */
  readonly lanesRemoved: number
  /** Linked freeze keys deleted with the placement (`delete` choice). */
  readonly freezeDeleted: number
  /** Linked freeze keys kept as plain keyframes (`orphan` choice). */
  readonly freezeOrphaned: number
}

/** How many keyframes are linked to this placement via freeze. Never throws. */
export function countLinkedFreezeKeys(
  engine: Pick<EnginePublic, 'getFreezeKeyframes'>,
  placementId: string,
): number {
  try {
    return engine.getFreezeKeyframes(placementId).length
  } catch {
    return 0
  }
}

function groupByTarget(
  entries: readonly { target: KeyframeTarget; keyframe: { id: string } }[],
): { target: KeyframeTarget; ids: string[] }[] {
  const groups = new Map<string, { target: KeyframeTarget; ids: string[] }>()
  for (const entry of entries) {
    const key = JSON.stringify(entry.target)
    const group = groups.get(key)
    if (group) group.ids.push(entry.keyframe.id)
    else groups.set(key, { target: entry.target, ids: [entry.keyframe.id] })
  }
  return [...groups.values()]
}

/**
 * Delete a collection placement, resolving its linked freeze keys by choice:
 * `delete` removes them with the placement, `orphan` keeps them as plain
 * (unlinked) keyframes. One transaction → one undo step restores everything.
 * With no linked keys this dispatches the plain placement delete (unchanged
 * behavior and inverse shape).
 */
export function deleteCollectionPlacementWithFreeze(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  placementId: string,
  choice: FreezeDeleteChoice,
): FreezeDeleteResult {
  let linked: readonly { target: KeyframeTarget; keyframe: { id: string } }[]
  try {
    linked = engine.getFreezeKeyframes(placementId)
  } catch {
    linked = []
  }
  if (linked.length === 0) {
    const result = dispatch(new DeleteCollectionPlacementCommand({ placementId }) as never)
    if (!result.ok) {
      const err = (result as unknown as { error?: { message?: string } }).error
      return {
        ok: false,
        error: err?.message ?? 'Delete failed',
        lanesRemoved: 0,
        freezeDeleted: 0,
        freezeOrphaned: 0,
      }
    }
    const inverse = (result as unknown as { inverse?: { memberInstances?: readonly unknown[] } })
      .inverse
    return {
      ok: true,
      lanesRemoved: inverse?.memberInstances?.length ?? 0,
      freezeDeleted: 0,
      freezeOrphaned: 0,
    }
  }
  const cmds: Command<unknown>[] = [
    new DeleteCollectionPlacementCommand({ placementId }) as unknown as Command<unknown>,
  ]
  if (choice === 'delete') {
    for (const group of groupByTarget(linked)) {
      cmds.push(
        new DeleteKeyframesCommand({
          target: group.target,
          keyframeIds: group.ids,
        }) as unknown as Command<unknown>,
      )
    }
  } else {
    for (const entry of linked) {
      cmds.push(
        new SetKeyframeFreezeLinkCommand({
          target: entry.target,
          keyframeId: entry.keyframe.id,
          freezeLink: undefined,
        }) as unknown as Command<unknown>,
      )
    }
  }
  const result = dispatch(new TransactionCommand(cmds) as never)
  if (!result.ok) {
    const err = (result as unknown as { error?: { message?: string } }).error
    return {
      ok: false,
      error: err?.message ?? 'Delete failed',
      lanesRemoved: 0,
      freezeDeleted: 0,
      freezeOrphaned: 0,
    }
  }
  const inverse = (
    result as unknown as {
      inverse?: {
        children?: readonly { type: string; inverse?: { memberInstances?: readonly unknown[] } }[]
      }
    }
  ).inverse
  const placementChild = inverse?.children?.find(
    (child) => child.type === 'DeleteCollectionPlacement',
  )
  const lanesRemoved = placementChild?.inverse?.memberInstances?.length ?? 0
  return {
    ok: true,
    lanesRemoved,
    freezeDeleted: choice === 'delete' ? linked.length : 0,
    freezeOrphaned: choice === 'orphan' ? linked.length : 0,
  }
}

/** Human summary for the delete/orphan outcome (keeps existing phrasing). */
export function freezeDeleteMessage(result: FreezeDeleteResult): string {
  const lanes = result.lanesRemoved > 0 ? ` (+${result.lanesRemoved} clip lane(s) removed)` : ''
  if (result.freezeDeleted > 0) {
    return `Deleted collection placement${lanes} (+${result.freezeDeleted} freeze key(s) deleted)`
  }
  if (result.freezeOrphaned > 0) {
    return `Deleted collection placement${lanes} (${result.freezeOrphaned} freeze key(s) kept as plain keyframes)`
  }
  return result.lanesRemoved > 0
    ? `Deleted collection placement${lanes}`
    : 'Deleted collection placement'
}
