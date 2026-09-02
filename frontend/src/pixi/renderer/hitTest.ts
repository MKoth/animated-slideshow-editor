import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import { walkPreOrder } from '../../engine/sceneNode'
import { worldTransformOf as storedWorldTransformOf } from '../../engine/worldTransform'
import type { WorldPoint, WorldRect, WorldSize, WorldTransform } from './worldGeometry'

export type NodeSizeSource = (nodeId: string) => WorldSize | null

export type WorldTransformSource = (nodeId: string) => WorldTransform | null

export type NodeFilter = (node: SceneNode) => boolean

function storedTransformOf(scene: Scene): WorldTransformSource {
  return (nodeId) => storedWorldTransformOf(scene, nodeId)
}

export function topmostNodeAt(
  scene: Scene,
  point: WorldPoint,
  sizes: NodeSizeSource,
  transformOf: WorldTransformSource = storedTransformOf(scene),
  filter?: NodeFilter | null,
): string | null {
  let topmost: string | null = null
  for (const node of walkPreOrder(scene.root)) {
    const size = sizes(node.id)
    const transform = transformOf(node.id)
    if (!selectable(node) || !containsPoint(point, size, transform, node.transform.localPivot)) {
      continue
    }
    if (filter && !filter(node)) {
      continue
    }
    topmost = node.id
  }
  return topmost
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
  if (!transform || transform.scaleX <= 0 || transform.scaleY <= 0) {
    return null
  }
  const hasPivot = pivot && (pivot.x !== 0 || pivot.y !== 0)
  if (!hasPivot) {
    const halfWidth = (size.width * transform.scaleX) / 2
    const halfHeight = (size.height * transform.scaleY) / 2
    const corners = rotatedCornersCenter(size, transform, halfWidth, halfHeight)
    return {
      minX: Math.min(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxX: Math.max(...corners.map((p) => p.x)),
      maxY: Math.max(...corners.map((p) => p.y)),
    }
  }
  const pivotOffset = { x: pivot.x * size.width, y: pivot.y * size.height }
  const halfW = size.width / 2
  const halfH = size.height / 2
  const cornersLocal = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ]
  const corners = cornersLocal.map((corner) => {
    const dx = (corner.x - pivotOffset.x) * transform.scaleX
    const dy = (corner.y - pivotOffset.y) * transform.scaleY
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
  if (!size || !transform || transform.scaleX <= 0 || transform.scaleY <= 0) {
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
    rotateX((size.offsetX ?? 0) * transform.scaleX, (size.offsetY ?? 0) * transform.scaleY, transform.rotation)
  const centerY =
    transform.y +
    rotateY((size.offsetX ?? 0) * transform.scaleX, (size.offsetY ?? 0) * transform.scaleY, transform.rotation)
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
  for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
    if (!cursor.visible) {
      return false
    }
  }
  return true
}
