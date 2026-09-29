import type { Scene } from '../../engine'
import { isGroupNode, walkPreOrder } from '../../engine/sceneNode'
import { worldDeltaToLocal } from '../../engine/worldTransform'
import { aabbOf } from './hitTest'
import type { NodeSizeSource, WorldTransformSource } from './hitTest'
import type { WorldSize } from './worldGeometry'

const MIN_EXTENT = 1e-9

/**
 * Virtual local size for a group node, derived from the union of its visible
 * renderable descendants.
 *
 * Group nodes are empty containers — the scene renderer records no size for
 * them, which makes them invisible to hit-testing, the selection outline,
 * and the resize/rotate handles. This computes a `WorldSize` (width/height
 * plus center offset) in the group's local space so the existing
 * `orientedCornersForSelection(size, groupWorld)` math draws the union
 * bounds, and `containsPoint` hit-tests the group's empty interior.
 *
 * Returns null for non-groups, empty groups, zero-area unions, and
 * degenerate (zero-scale) group transforms — those stay Inspector-only.
 */
export function groupSizeOf(
  scene: Scene,
  groupId: string,
  sizes: NodeSizeSource,
  transformOf: WorldTransformSource,
): WorldSize | null {
  const node = scene.getNode(groupId)
  if (!node || !isGroupNode(node)) {
    return null
  }
  const groupWorld = transformOf(groupId)
  if (
    !groupWorld ||
    groupWorld.scaleX === 0 ||
    groupWorld.scaleY === 0 ||
    !Number.isFinite(groupWorld.scaleX) ||
    !Number.isFinite(groupWorld.scaleY)
  ) {
    return null
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const descendant of walkPreOrder(node)) {
    if (descendant.id === groupId) {
      continue
    }
    if (descendant.components.camera || descendant.components.tableRow) {
      continue
    }
    if (isGroupNode(descendant)) {
      // Nested groups contribute through their leaves, visited separately.
      continue
    }
    if (!isVisibleUpTo(descendant.parent, node)) {
      continue
    }
    const size = sizes(descendant.id)
    const world = transformOf(descendant.id)
    if (!size || !world) {
      continue
    }
    const aabb = aabbOf(size, world, descendant.transform.localPivot)
    if (!aabb) {
      continue
    }
    const corners = [
      { x: aabb.minX, y: aabb.minY },
      { x: aabb.maxX, y: aabb.minY },
      { x: aabb.maxX, y: aabb.maxY },
      { x: aabb.minX, y: aabb.maxY },
    ]
    for (const corner of corners) {
      const local = worldDeltaToLocal(
        { x: corner.x - groupWorld.x, y: corner.y - groupWorld.y },
        groupWorld,
      )
      if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) {
        continue
      }
      found = true
      if (local.x < minX) minX = local.x
      if (local.y < minY) minY = local.y
      if (local.x > maxX) maxX = local.x
      if (local.y > maxY) maxY = local.y
    }
  }
  if (!found) {
    return null
  }
  const width = maxX - minX
  const height = maxY - minY
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= MIN_EXTENT ||
    height <= MIN_EXTENT
  ) {
    return null
  }
  // The outline math renders corners at (±w/2 − pivotOffset + offset),
  // so the offset must recenter the union on top of the pivot adjustment.
  const pivot = node.transform.localPivot ?? null
  const pivotX = pivot?.x ?? 0
  const pivotY = pivot?.y ?? 0
  return {
    width,
    height,
    offsetX: (minX + maxX) / 2 + pivotX * width,
    offsetY: (minY + maxY) / 2 + pivotY * height,
  }
}

function isVisibleUpTo(
  start: import('../../engine').SceneNode | null,
  stop: import('../../engine').SceneNode,
): boolean {
  for (let cursor = start; cursor !== null; cursor = cursor.parent) {
    if (!cursor.visible) {
      return false
    }
    if (cursor.id === stop.id) {
      return true
    }
  }
  return false
}
