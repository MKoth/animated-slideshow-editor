import { countTrackInRange, rangeTrackCheckKey } from './rangeKeyframes'
import type { RangeNodeSnapshot } from './rangeKeyframes'

export interface RangeNodeTree {
  readonly snap: RangeNodeSnapshot
  readonly children: readonly RangeNodeTree[]
}

/** Build the nested checkbox tree from a flat pre-order snapshot list. */
export function buildRangeNodeTree(snapshots: readonly RangeNodeSnapshot[]): RangeNodeTree | null {
  if (snapshots.length === 0) {
    return null
  }
  interface MutableNode {
    readonly snap: RangeNodeSnapshot
    readonly children: RangeNodeTree[]
  }
  const root: MutableNode = { snap: snapshots[0]!, children: [] }
  const stack: { node: MutableNode; depth: number }[] = [{ node: root, depth: snapshots[0]!.depth }]
  for (const snap of snapshots.slice(1)) {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= snap.depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (!parent) {
      break
    }
    const child: MutableNode = { snap, children: [] }
    parent.node.children.push(child)
    stack.push({ node: child, depth: snap.depth })
  }
  return root
}

/** All check keys in the subtree (used by the node-level checkbox). */
export function subtreeKeys(tree: RangeNodeTree): string[] {
  const keys: string[] = []
  const visit = (node: RangeNodeTree): void => {
    for (const track of node.snap.tracks) {
      keys.push(rangeTrackCheckKey(node.snap.nodeId, track.trackKey))
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree)
  return keys
}

/** Visible (in-range, non-zero) check keys in the subtree. Zero-count rows are hidden. */
export function visibleSubtreeKeys(tree: RangeNodeTree, from: number, to: number): string[] {
  const keys: string[] = []
  const visit = (node: RangeNodeTree): void => {
    for (const track of node.snap.tracks) {
      if (countTrackInRange(track, from, to) > 0) {
        keys.push(rangeTrackCheckKey(node.snap.nodeId, track.trackKey))
      }
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree)
  return keys
}

/** Total in-range keyframes under checked tracks in the subtree. */
export function subtreeTotal(
  tree: RangeNodeTree,
  from: number,
  to: number,
  checked: ReadonlySet<string>,
): number {
  let total = 0
  const visit = (node: RangeNodeTree): void => {
    for (const track of node.snap.tracks) {
      if (checked.has(rangeTrackCheckKey(node.snap.nodeId, track.trackKey))) {
        total += countTrackInRange(track, from, to)
      }
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree)
  return total
}

/** Whether the subtree has any keyframe in range (drives hide-zero-count). */
export function subtreeHasVisible(tree: RangeNodeTree, from: number, to: number): boolean {
  return visibleSubtreeKeys(tree, from, to).length > 0
}
