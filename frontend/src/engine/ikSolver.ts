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
 * @returns local rotations for each bone (in radians)
 */
export function solveTwoBoneIK(
  boneNodes: readonly SceneNode[],
  target: { readonly x: number; readonly y: number },
  poleTarget: { readonly x: number; readonly y: number } | null,
  getLocalTransform: (nodeId: string) => Transform,
): IKSolution {
  if (boneNodes.length !== 2) {
    throw new Error('Two-bone IK requires exactly two bones')
  }
  const [bone1, bone2] = boneNodes
  // Compute rest lengths from current transforms (distance between origins)
  const local1 = getLocalTransform(bone1.id)
  const local2 = getLocalTransform(bone2.id)
  // Bone lengths are the magnitude of local position offsets (assuming no scaling)
  const L1 = Math.hypot(local1.x, local1.y)
  const L2 = Math.hypot(local2.x, local2.y)
  // If either length is zero, fall back to identity
  if (L1 === 0 || L2 === 0) {
    return { rotations: [local1.rotation, local2.rotation] }
  }
  // Compute world position of root bone (parent's world transform + local)
  // For simplicity, we assume the root bone's parent world transform is known.
  // However, we can compute world positions by walking up the chain.
  // Let's compute world positions using composeChain (but we need chain up to bone1)
  // We'll approximate: treat bone1 as root (its world position is its parent's world position + local)
  // Since we don't have parent world, we'll compute relative to bone1's parent.
  // This is a simplification; a full solution would require world positions.
  // For now, we'll assume bone1 is at origin (0,0) and bone2 is at (L1,0) after rotation.
  // We'll compute angles in local space of bone1's parent.
  // Actually, we can compute using law of cosines in the plane defined by root, target, and pole.
  // We'll need the world position of bone1's parent (the chain root). Let's compute by walking up.
  // Let's write a helper to compute world position of a node given local transforms.
  const worldPos = (node: SceneNode): { x: number; y: number } => {
    // Walk up the chain, compose transforms
    const chain: SceneNode[] = []
    for (let cur: SceneNode | null = node; cur !== null; cur = cur.parent) {
      chain.push(cur)
    }
    chain.reverse()
    // compose chain using local transforms (but we only have local transforms for bone nodes)
    // We'll approximate by using identity for non-bone nodes.
    // This is not accurate but for now we assume bone chain is direct parent-child.
    // Since boneNodes are consecutive children, we can compute world position by summing local offsets.
    // Let's compute cumulative rotation and position.
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
  // Compute world position of bone1's origin (should be rootWorld + local1 rotated by parent rotation)
  // Actually worldPos(bone1) includes bone1's local transform. Let's compute bone1World = worldPos(bone1)
  const bone1World = worldPos(bone1)
  // Vector from bone1 to target
  const dx = target.x - bone1World.x
  const dy = target.y - bone1World.y
  const dist = Math.hypot(dx, dy)
  // Clamp distance to reachable range
  const maxReach = L1 + L2
  const minReach = Math.abs(L1 - L2)
  const clampedDist = Math.min(Math.max(dist, minReach), maxReach)
  // Law of cosines to find angle at bone1 (between bone1->parent and bone1->bone2)
  const cosAngle1 = (L1 * L1 + clampedDist * clampedDist - L2 * L2) / (2 * L1 * clampedDist)
  const angle1 = Math.acos(Math.min(Math.max(cosAngle1, -1), 1))
  // Angle of target vector relative to bone1's parent orientation
  const targetAngle = Math.atan2(dy, dx)
  // Compute rotation for bone1 (local rotation relative to parent)
  // We need to know bone1's parent world rotation. Let's compute parent world rotation.
  const parentWorldRotation = bone1.parent
    ? computeWorldRotation(bone1.parent, getLocalTransform)
    : 0
  // bone1's world rotation = parentWorldRotation + local1.rotation
  // We want bone1's world rotation such that bone1 points toward target with angle1 offset.
  // The direction from bone1 to bone2 should be at angle (targetAngle - angle1) or (targetAngle + angle1) depending on pole.
  // Use pole target to decide sign.
  let sign = 1
  if (poleTarget) {
    // Compute cross product to determine side
    const poleDx = poleTarget.x - bone1World.x
    const poleDy = poleTarget.y - bone1World.y
    const cross = dx * poleDy - dy * poleDx
    sign = cross >= 0 ? 1 : -1
  }
  const bone1WorldRotation = targetAngle - sign * angle1
  const bone1LocalRotation = bone1WorldRotation - parentWorldRotation
  // Now compute bone2 local rotation
  // bone2's world rotation should point from bone1 to target
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
 * @param iterations number of iterations (default 10)
 * @param tolerance distance tolerance (default 0.001)
 * @returns local rotations for each bone
 */
export function solveCCDIK(
  boneNodes: readonly SceneNode[],
  target: { readonly x: number; readonly y: number },
  poleTarget: { readonly x: number; readonly y: number } | null,
  getLocalTransform: (nodeId: string) => Transform,
  iterations = 10,
  tolerance = 0.001,
): IKSolution {
  if (boneNodes.length < 2) {
    throw new Error('IK chain must have at least 2 bones')
  }
  // Initialize rotations with current local rotations
  const rotations = boneNodes.map((node) => getLocalTransform(node.id).rotation)
  // Precompute bone lengths (distance from bone origin to child origin)
  const lengths: number[] = []
  for (let i = 0; i < boneNodes.length - 1; i++) {
    const local = getLocalTransform(boneNodes[i].id)
    lengths.push(Math.hypot(local.x, local.y))
  }
  // Add a dummy length for end effector (not used)
  lengths.push(0)
  // Helper to compute end effector world position given rotations
  const computeEndEffector = (): { x: number; y: number } => {
    // Walk up the chain from root to end effector, composing transforms
    let x = 0
    let y = 0
    let rotation = 0
    for (let i = 0; i < boneNodes.length; i++) {
      // Use modified rotation
      const modifiedRotation = rotations[i]
      // Offset by length of previous bone? Actually local position is offset from parent.
      // We'll use the local position (x,y) as offset, but we need to apply rotation.
      // For simplicity, we assume each bone's local position is along the bone direction.
      // We'll approximate: local position is (length, 0) rotated by local rotation.
      const boneLength = lengths[i]
      const offsetX = rotateX(boneLength, 0, rotation)
      const offsetY = rotateY(boneLength, 0, rotation)
      x += offsetX
      y += offsetY
      rotation += modifiedRotation
    }
    // End effector position is after last bone's length? Actually end effector is at the end of last bone.
    // We'll return position after adding last bone's length.
    const lastLength = lengths[boneNodes.length - 1]
    const endX = x + rotateX(lastLength, 0, rotation)
    const endY = y + rotateY(lastLength, 0, rotation)
    return { x: endX, y: endY }
  }
  // CCD iteration
  for (let iter = 0; iter < iterations; iter++) {
    const endPos = computeEndEffector()
    const dx = target.x - endPos.x
    const dy = target.y - endPos.y
    const dist = Math.hypot(dx, dy)
    if (dist < tolerance) {
      break
    }
    // Iterate from end effector back to root
    for (let i = boneNodes.length - 1; i >= 0; i--) {
      // Compute world position of current bone (as pivot)
      const pivotWorld = computePivotWorld(i)
      // Vector from pivot to end effector
      const endDx = endPos.x - pivotWorld.x
      const endDy = endPos.y - pivotWorld.y
      // Vector from pivot to target
      const targetDx = target.x - pivotWorld.x
      const targetDy = target.y - pivotWorld.y
      // Compute angle between vectors
      const cross = endDx * targetDy - endDy * targetDx
      const dot = endDx * targetDx + endDy * targetDy
      let angle = Math.atan2(cross, dot)
      // Apply pole target influence (optional)
      if (poleTarget && i === boneNodes.length - 2) {
        // Adjust angle sign based on pole target
        const poleDx = poleTarget.x - pivotWorld.x
        const poleDy = poleTarget.y - pivotWorld.y
        const crossPole = endDx * poleDy - endDy * poleDx
        if (crossPole * cross < 0) {
          angle = -angle
        }
      }
      // Update rotation
      rotations[i] += angle
    }
  }
  return { rotations }
  // Helper to compute world position of pivot (origin of bone i)
  function computePivotWorld(boneIndex: number): { x: number; y: number } {
    let x = 0
    let y = 0
    let rotation = 0
    for (let i = 0; i < boneIndex; i++) {
      const boneLength = lengths[i]
      x += rotateX(boneLength, 0, rotation)
      y += rotateY(boneLength, 0, rotation)
      rotation += rotations[i]
    }
    return { x, y }
  }
}