import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import { walkPreOrder } from '../../engine/sceneNode'
import type { WorldPoint, WorldRect, WorldSize, WorldTransform } from './worldGeometry'

export type NodeSizeSource = (nodeId: string) => WorldSize | null

export function topmostNodeAt(
  scene: Scene,
  point: WorldPoint,
  sizes: NodeSizeSource,
): string | null {
  let topmost: string | null = null
  for (const node of walkPreOrder(scene.root)) {
    if (!selectable(node) || !containsPoint(scene, node, point, sizes)) {
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
): readonly string[] {
  const hit: string[] = []
  for (const node of walkPreOrder(scene.root)) {
    if (!selectable(node)) {
      continue
    }
    const aabb = worldAabbOf(scene, node.id, sizes)
    if (aabb && intersects(aabb, rect)) {
      hit.push(node.id)
    }
  }
  return hit
}

export function worldAabbOf(scene: Scene, nodeId: string, sizes: NodeSizeSource): WorldRect | null {
  const node = scene.getNode(nodeId)
  if (!node) {
    return null
  }
  const size = sizes(nodeId)
  if (!size) {
    return null
  }
  const transform = worldTransformOf(scene, nodeId)
  return aabbOf(size, transform)
}

export function aabbOf(size: WorldSize, transform: WorldTransform | null): WorldRect | null {
  if (!transform || transform.scaleX <= 0 || transform.scaleY <= 0) {
    return null
  }
  const halfWidth = (size.width * transform.scaleX) / 2
  const halfHeight = (size.height * transform.scaleY) / 2
  const corners = rotatedCorners(transform, halfWidth, halfHeight)
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  }
}

export function worldTransformOf(
  scene: Scene,
  nodeId: string,
  preview?: WorldPoint,
): WorldTransform | null {
  const node = scene.getNode(nodeId)
  if (!node) {
    return null
  }
  const chain: SceneNode[] = []
  for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
    chain.push(cursor)
  }
  chain.reverse()
  let x = 0
  let y = 0
  let rotation = 0
  let scaleX = 1
  let scaleY = 1
  for (const link of chain) {
    const local =
      link.id === nodeId && preview
        ? { ...link.transform, x: preview.x, y: preview.y }
        : link.transform
    x += rotateX(local.x * scaleX, local.y * scaleY, rotation)
    y += rotateY(local.x * scaleX, local.y * scaleY, rotation)
    rotation += local.rotation
    scaleX *= local.scaleX
    scaleY *= local.scaleY
  }
  return { x, y, rotation, scaleX, scaleY }
}

function containsPoint(
  scene: Scene,
  node: SceneNode,
  point: WorldPoint,
  sizes: NodeSizeSource,
): boolean {
  const size = sizes(node.id)
  if (!size) {
    return false
  }
  const transform = worldTransformOf(scene, node.id)
  if (!transform || transform.scaleX <= 0 || transform.scaleY <= 0) {
    return false
  }
  const dx = point.x - transform.x
  const dy = point.y - transform.y
  const localX = rotateX(dx, dy, -transform.rotation) / transform.scaleX
  const localY = rotateY(dx, dy, -transform.rotation) / transform.scaleY
  return Math.abs(localX) <= size.width / 2 && Math.abs(localY) <= size.height / 2
}

function rotatedCorners(
  transform: WorldTransform,
  halfWidth: number,
  halfHeight: number,
): WorldPoint[] {
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  return corners.map((corner) => ({
    x: transform.x + rotateX(corner.x, corner.y, transform.rotation),
    y: transform.y + rotateY(corner.x, corner.y, transform.rotation),
  }))
}

function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
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
