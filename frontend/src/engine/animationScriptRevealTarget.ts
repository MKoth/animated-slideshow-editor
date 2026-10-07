import type { AnimationScriptBoundsRead } from './animationScriptReads'
import { mergeBounds } from './animationScriptReads'

export interface RevealTargetNode {
  readonly id: string
  readonly parentId?: string
  readonly isRenderable?: boolean
}

/** Resolve one node/subtree/group path set to its measurable renderable members. */
export function sampleAnimationScriptRevealTarget(input: {
  readonly nodes: readonly RevealTargetNode[]
  readonly rootNodeIds: readonly string[]
  readonly includeDescendants: boolean
  readonly time: number
  readonly isVisible: (nodeId: string, time: number) => boolean
  readonly nodeBounds: (nodeId: string, time: number) => AnimationScriptBoundsRead | null
}): { readonly nodeIds: readonly string[]; readonly bounds: AnimationScriptBoundsRead } | null {
  const parents = new Map(input.nodes.map((node) => [node.id, node.parentId] as const))
  const selected = new Set<string>()
  for (const rootNodeId of input.rootNodeIds) {
    for (const candidate of input.nodes) {
      if (!input.includeDescendants && candidate.id !== rootNodeId) continue
      let current: string | undefined = candidate.id
      while (current !== undefined && current !== rootNodeId) current = parents.get(current)
      if (current === rootNodeId) selected.add(candidate.id)
    }
  }

  const nodeIds: string[] = []
  let bounds: AnimationScriptBoundsRead | null = null
  for (const candidate of input.nodes) {
    if (!selected.has(candidate.id) || !candidate.isRenderable) continue
    if (!input.isVisible(candidate.id, input.time)) continue
    const measured = input.nodeBounds(candidate.id, input.time)
    if (!measured) continue
    nodeIds.push(candidate.id)
    bounds = bounds === null ? measured : mergeBounds(bounds, measured)
  }
  return bounds === null || nodeIds.length === 0 ? null : { nodeIds, bounds }
}
