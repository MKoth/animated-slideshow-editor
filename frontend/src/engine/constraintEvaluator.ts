import type { Constraint } from './constraint'
import type { WorldTransform } from './worldTransform'
import type { SceneNode } from './sceneNode'

export interface ConstraintEvaluationContext {
  readonly nodeLookup: (nodeId: string) => SceneNode
  readonly worldTransformLookup: (nodeId: string) => WorldTransform | null
}

export function applyConstraints(
  worldTransform: WorldTransform,
  constraints: readonly Constraint[],
  context: ConstraintEvaluationContext,
): WorldTransform {
  let result = { ...worldTransform }
  for (const constraint of constraints) {
    result = applySingleConstraint(result, constraint, context)
  }
  return result
}

function applySingleConstraint(
  world: WorldTransform,
  constraint: Constraint,
  context: ConstraintEvaluationContext,
): WorldTransform {
  switch (constraint.type) {
    case 'rotationLimit':
      return applyRotationLimit(world)
    case 'lookAt':
      return applyLookAt(world, constraint, context)
    case 'distance':
      return applyDistance(world, constraint, context)
    case 'parent':
      return applyParentConstraint(world, constraint, context)
    default:
      return world
  }
}

function applyRotationLimit(world: WorldTransform): WorldTransform {
  return world
}

function applyLookAt(
  world: WorldTransform,
  constraint: Constraint,
  context: ConstraintEvaluationContext,
): WorldTransform {
  const { targetX, targetY, targetNodeId } = constraint.params as {
    targetX: number
    targetY: number
    targetNodeId?: string
  }
  let tx = targetX
  let ty = targetY
  if (targetNodeId) {
    const targetWorld = context.worldTransformLookup(targetNodeId)
    if (targetWorld) {
      tx = targetWorld.x
      ty = targetWorld.y
    }
  }
  const dx = tx - world.x
  const dy = ty - world.y
  const rotation = Math.atan2(dy, dx)
  return { ...world, rotation }
}

function applyDistance(
  world: WorldTransform,
  constraint: Constraint,
  context: ConstraintEvaluationContext,
): WorldTransform {
  const { targetNodeId, minDistance, maxDistance } = constraint.params as {
    targetNodeId: string
    minDistance: number
    maxDistance: number
  }
  const targetWorld = context.worldTransformLookup(targetNodeId)
  if (!targetWorld) {
    return world
  }
  const dx = world.x - targetWorld.x
  const dy = world.y - targetWorld.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < minDistance) {
    const angle = Math.atan2(dy, dx)
    const x = targetWorld.x + Math.cos(angle) * minDistance
    const y = targetWorld.y + Math.sin(angle) * minDistance
    return { ...world, x, y }
  }
  if (dist > maxDistance) {
    const angle = Math.atan2(dy, dx)
    const x = targetWorld.x + Math.cos(angle) * maxDistance
    const y = targetWorld.y + Math.sin(angle) * maxDistance
    return { ...world, x, y }
  }
  return world
}

function applyParentConstraint(
  world: WorldTransform,
  constraint: Constraint,
  context: ConstraintEvaluationContext,
): WorldTransform {
  const { targetNodeId, positionInfluence, rotationInfluence, scaleInfluence } =
    constraint.params as {
      targetNodeId: string
      positionInfluence: number
      rotationInfluence: number
      scaleInfluence: number
    }
  const targetWorld = context.worldTransformLookup(targetNodeId)
  if (!targetWorld) {
    return world
  }
  const x = world.x + (targetWorld.x - world.x) * positionInfluence
  const y = world.y + (targetWorld.y - world.y) * positionInfluence
  const rotation = world.rotation + (targetWorld.rotation - world.rotation) * rotationInfluence
  const scaleX = world.scaleX + (targetWorld.scaleX - world.scaleX) * scaleInfluence
  const scaleY = world.scaleY + (targetWorld.scaleY - world.scaleY) * scaleInfluence
  return { x, y, rotation, scaleX, scaleY }
}
