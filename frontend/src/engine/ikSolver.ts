import type { SceneNode } from './sceneNode'
import { rotateX, rotateY } from './worldTransform'
import type { Transform } from './transform'

export interface IKSolution {
  /** Rotations for each bone in the chain (local rotations) */
  readonly rotations: readonly number[]
}

/**
 * Solve a 2-bone IK chain analytically.
 * @param boneNodes array of two bone nodes (root, end effector)
 * @param target world-space target position
 * @param poleTarget optional pole target for elbow direction
 * @param getLocalTransform function to get evaluated local transform of a node
 * @param boneLengths bone lengths from BoneComponent
 * @returns local rotations for each bone (in radians)
 */
export function solveTwoBoneIK(
  boneNodes: readonly SceneNode[],
  target: { readonly x: number; readonly y: number },
  poleTarget: { readonly x: number; readonly y: number } | null,
  getLocalTransform: (nodeId: string) => Transform,
  boneLengths: readonly number[],
): IKSolution {
  if (boneNodes.length !== 2) {
    throw new Error('Two-bone IK requires exactly two bones')
  }
  const [bone1] = boneNodes
  const L1 = boneLengths[0] ?? 100
  const L2 = boneLengths[1] ?? 100

  const worldPos = (node: SceneNode): { x: number; y: number } => {
    const chain: SceneNode[] = []
    for (let cur: SceneNode | null = node; cur !== null; cur = cur.parent) {
      chain.push(cur)
    }
    chain.reverse()
    let x = 0
    let y = 0
    let rotation = 0
    for (const link of chain) {
      const local = getLocalTransform(link.id)
      x += rotateX(local.x, local.y, rotation)
      y += rotateY(local.x, local.y, rotation)
      rotation += local.rotation
    }
    return { x, y }
  }

  const bone1World = worldPos(bone1)
  const dx = target.x - bone1World.x
  const dy = target.y - bone1World.y
  const dist = Math.hypot(dx, dy)
  const maxReach = L1 + L2
  const minReach = Math.abs(L1 - L2)
  const clampedDist = Math.min(Math.max(dist, minReach), maxReach)
  const cosAngle1 = (L1 * L1 + clampedDist * clampedDist - L2 * L2) / (2 * L1 * clampedDist)
  const angle1 = Math.acos(Math.min(Math.max(cosAngle1, -1), 1))
  const targetAngle = Math.atan2(dy, dx)
  const parentWorldRotation = bone1.parent
    ? computeWorldRotation(bone1.parent, getLocalTransform)
    : 0

  let sign = 1
  if (poleTarget) {
    const poleDx = poleTarget.x - bone1World.x
    const poleDy = poleTarget.y - bone1World.y
    const cross = dx * poleDy - dy * poleDx
    sign = cross >= 0 ? 1 : -1
  }
  const bone1WorldRotation = targetAngle - sign * angle1
  const bone1LocalRotation = bone1WorldRotation - parentWorldRotation
  const bone2WorldRotation = targetAngle
  const bone2LocalRotation = bone2WorldRotation - bone1WorldRotation
  return { rotations: [bone1LocalRotation, bone2LocalRotation] }
}

function computeWorldRotation(
  node: SceneNode,
  getLocalTransform: (nodeId: string) => Transform,
): number {
  let rotation = 0
  for (let cur: SceneNode | null = node; cur !== null; cur = cur.parent) {
    rotation += getLocalTransform(cur.id).rotation
  }
  return rotation
}

/**
 * Solve IK for chains longer than 2 using Cyclic Coordinate Descent (CCD).
 * @param boneNodes array of bone nodes (root to end effector)
 * @param target world-space target position
 * @param poleTarget optional pole target
 * @param getLocalTransform function to get evaluated local transform of a node
 * @param boneLengths bone lengths from BoneComponent
 * @param iterations number of iterations (default 10)
 * @param tolerance distance tolerance (default 0.001)
 * @returns local rotations for each bone
 */
export function solveCCDIK(
  boneNodes: readonly SceneNode[],
  target: { readonly x: number; readonly y: number },
  poleTarget: { readonly x: number; readonly y: number } | null,
  getLocalTransform: (nodeId: string) => Transform,
  boneLengths: readonly number[],
  iterations = 10,
  tolerance = 0.001,
): IKSolution {
  if (boneNodes.length < 2) {
    throw new Error('IK chain must have at least 2 bones')
  }
  const rotations = boneNodes.map((node) => getLocalTransform(node.id).rotation)
  const lengths: number[] = boneLengths.map((l) => l)

  // Compute max reach for distance clamping
  const maxReach = lengths.reduce((sum, l) => sum + l, 0)

  // Compute bone1's world position and parent world rotation
  const bone1World = (() => {
    let x = 0
    let y = 0
    let rotation = 0
    for (let cur: SceneNode | null = boneNodes[0]; cur !== null; cur = cur.parent) {
      const local = getLocalTransform(cur.id)
      x += rotateX(local.x, local.y, rotation)
      y += rotateY(local.x, local.y, rotation)
      rotation += local.rotation
    }
    return { x, y, parentRotation: rotation - getLocalTransform(boneNodes[0].id).rotation }
  })()

  // Clamp target distance to maxReach to prevent wild rotations
  let relTarget = { x: target.x - bone1World.x, y: target.y - bone1World.y }
  const targetDist = Math.hypot(relTarget.x, relTarget.y)
  if (targetDist > maxReach) {
    const scale = maxReach / targetDist
    relTarget = { x: relTarget.x * scale, y: relTarget.y * scale }
  }
  const parentRot = bone1World.parentRotation

  // Max rotation change per iteration (radians)
  const maxRotationPerIteration = 0.5

  const computeEndEffector = (): { x: number; y: number } => {
    let x = 0
    let y = 0
    let rotation = parentRot
    for (let i = 0; i < boneNodes.length; i++) {
      rotation += rotations[i]
      x += rotateX(lengths[i], 0, rotation)
      y += rotateY(lengths[i], 0, rotation)
    }
    return { x, y }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const endPos = computeEndEffector()
    const dx = relTarget.x - endPos.x
    const dy = relTarget.y - endPos.y
    const dist = Math.hypot(dx, dy)
    if (dist < tolerance) {
      break
    }
    for (let i = boneNodes.length - 1; i >= 0; i--) {
      const pivotWorld = computePivotWorld(i)
      const endDx = endPos.x - pivotWorld.x
      const endDy = endPos.y - pivotWorld.y
      const targetDx = relTarget.x - pivotWorld.x
      const targetDy = relTarget.y - pivotWorld.y
      const cross = endDx * targetDy - endDy * targetDx
      const dot = endDx * targetDx + endDy * targetDy
      let angle = Math.atan2(cross, dot)
      if (poleTarget && i === boneNodes.length - 2) {
        const relPoleX = poleTarget.x - bone1World.x
        const relPoleY = poleTarget.y - bone1World.y
        const poleDx = relPoleX - pivotWorld.x
        const poleDy = relPoleY - pivotWorld.y
        const crossPole = endDx * poleDy - endDy * poleDx
        if (crossPole * cross < 0) {
          angle = -angle
        }
      }
      // Clamp rotation change to prevent wild swings
      angle = Math.max(-maxRotationPerIteration, Math.min(maxRotationPerIteration, angle))
      rotations[i] += angle
    }
  }
  return { rotations }

  function computePivotWorld(boneIndex: number): { x: number; y: number } {
    let x = 0
    let y = 0
    let rotation = parentRot
    for (let i = 0; i < boneIndex; i++) {
      rotation += rotations[i]
      x += rotateX(lengths[i], 0, rotation)
      y += rotateY(lengths[i], 0, rotation)
    }
    return { x, y }
  }
}
