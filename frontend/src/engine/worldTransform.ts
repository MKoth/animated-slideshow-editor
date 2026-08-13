import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Transform } from './transform'

export interface WorldTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export function worldTransformOf(scene: Scene, nodeId: string): WorldTransform | null {
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
    const local = link.transform
    x += rotateX(local.x * scaleX, local.y * scaleY, rotation)
    y += rotateY(local.x * scaleX, local.y * scaleY, rotation)
    rotation += local.rotation
    scaleX *= local.scaleX
    scaleY *= local.scaleY
  }
  return { x, y, rotation, scaleX, scaleY }
}

export function relativeTransform(
  world: WorldTransform,
  parentWorld: WorldTransform,
): Transform | null {
  if (parentWorld.scaleX === 0 || parentWorld.scaleY === 0) {
    return null
  }
  const dx = world.x - parentWorld.x
  const dy = world.y - parentWorld.y
  return {
    x: rotateX(dx, dy, -parentWorld.rotation) / parentWorld.scaleX,
    y: rotateY(dx, dy, -parentWorld.rotation) / parentWorld.scaleY,
    rotation: world.rotation - parentWorld.rotation,
    scaleX: world.scaleX / parentWorld.scaleX,
    scaleY: world.scaleY / parentWorld.scaleY,
  }
}

export function transformsEqual(a: Transform, b: Transform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY
  )
}

export function rotateX(x: number, y: number, rotation: number): number {
  return x * Math.cos(rotation) - y * Math.sin(rotation)
}

export function rotateY(x: number, y: number, rotation: number): number {
  return x * Math.sin(rotation) + y * Math.cos(rotation)
}
