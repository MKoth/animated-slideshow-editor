import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import { isGroupNode, walkPreOrder } from '../../engine/sceneNode'
import { worldTransformOf as storedWorldTransformOf } from '../../engine/worldTransform'
import type { WorldPoint, WorldRect, WorldSize, WorldTransform } from './worldGeometry'

export type NodeSizeSource = (nodeId: string) => WorldSize | null

export type WorldTransformSource = (nodeId: string) => WorldTransform | null

export type NodeFilter = (node: SceneNode) => boolean

export type ZIndexSource = (nodeId: string) => number | null

function storedTransformOf(scene: Scene): WorldTransformSource {
  return (nodeId) => storedWorldTransformOf(scene, nodeId)
}

function zOf(scene: Scene, nodeId: string, getZ?: ZIndexSource | null): number {
  if (getZ) {
    try {
      const explicit = getZ(nodeId)
      if (typeof explicit === 'number' && Number.isFinite(explicit)) {
        return explicit
      }
    } catch {
      // fall through to stored zIndex
    }
  }
  const z = scene.getNode(nodeId)?.zIndex
  return typeof z === 'number' && Number.isFinite(z) ? z : 0
}

interface StackingFrame {
  readonly z: number
  readonly order: number
}

/**
 * Ancestor chain (root-first) of (zIndex, sibling order) frames.
 * Comparing these lexicographically reproduces the renderer's paint order:
 * a higher z wins at the first level where chains differ (z is scoped to
 * its parent, like Pixi's per-container sortableChildren), ties fall back
 * to sibling order, and a descendant wins when its chain extends an
 * ancestor's (children paint above their parent).
 */
function stackingKey(scene: Scene, nodeId: string, getZ?: ZIndexSource | null): StackingFrame[] {
  const node = scene.getNode(nodeId)
  if (!node) {
    return []
  }
  const chain: SceneNode[] = []
  for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
    chain.push(cursor)
  }
  chain.reverse()
  return chain.map((link) => ({
    z: zOf(scene, link.id, getZ),
    order: link.parent ? link.parent.children.indexOf(link) : 0,
  }))
}

/** Positive when `a` paints above `b`. */
function compareStacking(a: StackingFrame[], b: StackingFrame[]): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    const fa = a[i]
    const fb = b[i]
    if (!fa || !fb) {
      continue
    }
    if (fa.z !== fb.z) {
      return fa.z - fb.z
    }
    if (fa.order !== fb.order) {
      return fa.order - fb.order
    }
  }
  // One chain extends the other: the deeper node paints above its ancestor.
  return a.length - b.length
}

function depthOf(scene: Scene, nodeId: string): number {
  let depth = 0
  for (
    let cursor: SceneNode | null = scene.getNode(nodeId) ?? null;
    cursor !== null;
    cursor = cursor.parent
  ) {
    depth += 1
  }
  return depth
}

/**
 * All selectable nodes containing the point, best pick first.
 *
 * Order: renderer paint order (zIndex scoped per parent, then tree order,
 * descendants above ancestors) first so clicks match what is seen; then
 * smallest bounds area so a small foreground object beats a big background
 * one sharing the same stacking; then non-group leaves before group
 * unions, then deeper nodes — so repeat-click cycling walks from the leaf
 * on top down through the stack.
 */
export function nodesAtSorted(
  scene: Scene,
  point: WorldPoint,
  sizes: NodeSizeSource,
  transformOf: WorldTransformSource = storedTransformOf(scene),
  filter?: NodeFilter | null,
  getZ?: ZIndexSource | null,
): string[] {
  const hits: {
    readonly id: string
    readonly area: number
    readonly depth: number
    readonly group: boolean
    readonly key: StackingFrame[]
  }[] = []
  for (const node of walkPreOrder(scene.root)) {
    const size = sizes(node.id)
    const transform = transformOf(node.id)
    if (!selectable(node) || !containsPoint(point, size, transform, node.transform.localPivot)) {
      continue
    }
    if (filter && !filter(node)) {
      continue
    }
    const aabb = size && transform ? aabbOf(size, transform, node.transform.localPivot) : null
    const area = aabb
      ? Math.max(0, aabb.maxX - aabb.minX) * Math.max(0, aabb.maxY - aabb.minY)
      : Infinity
    hits.push({
      id: node.id,
      area,
      depth: depthOf(scene, node.id),
      group: isGroupNode(node),
      key: stackingKey(scene, node.id, getZ),
    })
  }
  hits.sort((a, b) => {
    const stacking = compareStacking(b.key, a.key)
    if (stacking !== 0) {
      return stacking
    }
    if (a.area !== b.area) {
      return a.area - b.area
    }
    if (a.group !== b.group) {
      return a.group ? 1 : -1
    }
    if (a.depth !== b.depth) {
      return b.depth - a.depth
    }
    return 0
  })
  return hits.map((hit) => hit.id)
}

export function topmostNodeAt(
  scene: Scene,
  point: WorldPoint,
  sizes: NodeSizeSource,
  transformOf: WorldTransformSource = storedTransformOf(scene),
  filter?: NodeFilter | null,
  getZ?: ZIndexSource | null,
): string | null {
  return nodesAtSorted(scene, point, sizes, transformOf, filter, getZ)[0] ?? null
}

export function nodesIntersectingRect(
  scene: Scene,
  rect: WorldRect,
  sizes: NodeSizeSource,
  transformOf: WorldTransformSource = storedTransformOf(scene),
  filter?: NodeFilter | null,
): readonly string[] {
  const hit: string[] = []
  for (const node of walkPreOrder(scene.root)) {
    if (!selectable(node)) {
      continue
    }
    // Group unions always overlap their children — marquee stays leaf-only
    // so a drag around grouped content selects the members, never both the
    // group and its members (which would double-apply group moves).
    if (isGroupNode(node)) {
      continue
    }
    if (filter && !filter(node)) {
      continue
    }
    const aabb = worldAabbOf(scene, node.id, sizes, transformOf)
    if (aabb && intersects(aabb, rect)) {
      hit.push(node.id)
    }
  }
  return hit
}

export function worldAabbOf(
  scene: Scene,
  nodeId: string,
  sizes: NodeSizeSource,
  transformOf: WorldTransformSource = storedTransformOf(scene),
): WorldRect | null {
  const node = scene.getNode(nodeId)
  if (!node) {
    return null
  }
  const size = sizes(nodeId)
  if (!size) {
    return null
  }
  const transform = transformOf(nodeId)
  return aabbOf(size, transform, node.transform.localPivot)
}

export function aabbOf(
  size: WorldSize,
  transform: WorldTransform | null,
  pivot?: { readonly x: number; readonly y: number } | null,
): WorldRect | null {
  if (
    !transform ||
    transform.scaleX === 0 ||
    transform.scaleY === 0 ||
    !Number.isFinite(transform.scaleX) ||
    !Number.isFinite(transform.scaleY)
  ) {
    return null
  }
  const hasPivot = pivot && (pivot.x !== 0 || pivot.y !== 0)
  if (!hasPivot) {
    const halfWidth = Math.abs(size.width * transform.scaleX) / 2
    const halfHeight = Math.abs(size.height * transform.scaleY) / 2
    const corners = rotatedCornersCenter(size, transform, halfWidth, halfHeight)
    return {
      minX: Math.min(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxX: Math.max(...corners.map((p) => p.x)),
      maxY: Math.max(...corners.map((p) => p.y)),
    }
  }
  const pivotOffset = { x: pivot.x * size.width, y: pivot.y * size.height }
  const offsetX = size.offsetX ?? 0
  const offsetY = size.offsetY ?? 0
  const halfW = size.width / 2
  const halfH = size.height / 2
  const cornersLocal = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ]
  const corners = cornersLocal.map((corner) => {
    const dx = (corner.x - pivotOffset.x + offsetX) * transform.scaleX
    const dy = (corner.y - pivotOffset.y + offsetY) * transform.scaleY
    return {
      x: transform.x + rotateX(dx, dy, transform.rotation),
      y: transform.y + rotateY(dx, dy, transform.rotation),
    }
  })
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  }
}

function containsPoint(
  point: WorldPoint,
  size: WorldSize | null,
  transform: WorldTransform | null,
  pivot?: { readonly x: number; readonly y: number } | null,
): boolean {
  if (
    !size ||
    !transform ||
    transform.scaleX === 0 ||
    transform.scaleY === 0 ||
    !Number.isFinite(transform.scaleX) ||
    !Number.isFinite(transform.scaleY)
  ) {
    return false
  }
  // Transform is pivot point world; bounds center is pivot - pivotOffset
  const pivotOffset = pivot ? { x: pivot.x * size.width, y: pivot.y * size.height } : null
  const pivotWorldX = transform.x
  const pivotWorldY = transform.y
  // Compute pivot offset in world (scaled and rotated)
  // For contains test, transform point to pivot-local, then to bounds-center local
  const dx = point.x - pivotWorldX
  const dy = point.y - pivotWorldY
  const localPivotX = rotateX(dx, dy, -transform.rotation) / transform.scaleX
  const localPivotY = rotateY(dx, dy, -transform.rotation) / transform.scaleY
  // localPivot is offset from pivot point; convert to offset from bounds center
  const offsetX = size.offsetX ?? 0
  const offsetY = size.offsetY ?? 0
  const pivotLocalX = pivotOffset ? pivotOffset.x : 0
  const pivotLocalY = pivotOffset ? pivotOffset.y : 0
  // Bounds center local = pivotLocal - pivotOffset? Actually pivotLocal = boundsCenter + pivotOffset
  // So center local = pivotLocal - pivotOffset = (localPivot offset from pivot) + pivotOffset? Wait localPivot is vector from pivot to point
  // Point local from pivot = localPivot
  // Point local from center = localPivot + pivotOffset
  const cx = localPivotX + pivotLocalX - offsetX
  const cy = localPivotY + pivotLocalY - offsetY
  // Alternative simpler: map to center space
  // center = pivot - pivotOffset, so point - center = (point - pivot) + pivotOffset
  // which is localPivot + pivotOffset
  return Math.abs(cx) <= size.width / 2 && Math.abs(cy) <= size.height / 2
}

function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function rotatedCornersCenter(
  size: WorldSize,
  transform: WorldTransform,
  halfWidth: number,
  halfHeight: number,
): WorldPoint[] {
  const centerX =
    transform.x +
    rotateX(
      (size.offsetX ?? 0) * transform.scaleX,
      (size.offsetY ?? 0) * transform.scaleY,
      transform.rotation,
    )
  const centerY =
    transform.y +
    rotateY(
      (size.offsetX ?? 0) * transform.scaleX,
      (size.offsetY ?? 0) * transform.scaleY,
      transform.rotation,
    )
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  return corners.map((corner) => ({
    x: centerX + rotateX(corner.x, corner.y, transform.rotation),
    y: centerY + rotateY(corner.x, corner.y, transform.rotation),
  }))
}

function rotateX(x: number, y: number, rotation: number): number {
  return x * Math.cos(rotation) - y * Math.sin(rotation)
}

function rotateY(x: number, y: number, rotation: number): number {
  return x * Math.sin(rotation) + y * Math.cos(rotation)
}

function selectable(node: SceneNode): boolean {
  if (node.components.camera) {
    return false
  }
  if (node.components.tableRow) {
    return false
  }
  for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
    if (!cursor.visible) {
      return false
    }
  }
  return true
}
