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
      return applyRotationLimit(world, constraint)
    case 'positionLimit':
      return applyPositionLimit(world, constraint)
    case 'lookAt':
      return applyLookAt(world, constraint)
    case 'distance':
      return applyDistance(world, constraint, context)
    case 'parent':
      return applyParentConstraint(world, constraint, context)
    default:
      return world
  }
}

function applyRotationLimit(world: WorldTransform, constraint: Constraint): WorldTransform {
  const { minRotation, maxRotation } = constraint.params as {
    minRotation: number
    maxRotation: number
  }
  const clamped = Math.max(minRotation, Math.min(maxRotation, world.rotation))
  return { ...world, rotation: clamped }
}

function applyPositionLimit(world: WorldTransform, constraint: Constraint): WorldTransform {
  const { minX, maxX, minY, maxY } = constraint.params as {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  const x = Math.max(minX, Math.min(maxX, world.x))
  const y = Math.max(minY, Math.min(maxY, world.y))
  return { ...world, x, y }
}

function applyLookAt(world: WorldTransform, constraint: Constraint): WorldTransform {
  const { targetX, targetY } = constraint.params as {
    targetX: number
    targetY: number
  }
  const dx = targetX - world.x
  const dy = targetY - world.y
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
