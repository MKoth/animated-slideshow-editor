import type { EngineReadOnly, Scene, SceneNode } from '../engine'
import { normalizeRotation } from '../engine'
import { requireFiniteNumber } from '../engine/guards'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import {
  MoveNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  TransactionCommand,
} from '../engine/commands'
import type { MoveNodeInverse, RotateNodeInverse, ScaleNodeInverse } from '../engine/commands'
import type { TransactionInverse } from '../engine/commands'
import { relativeTransform, transformsEqual, worldTransformOf } from '../engine/worldTransform'
import type { WorldTransform } from '../engine/worldTransform'
import { identityTransform } from '../engine/transform'
import type { Transform } from '../engine/transform'

const DEG_TO_RAD = Math.PI / 180

export function parseFiniteNumber(raw: string, what: string): number {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new Error(`${what} must be a number`)
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
  return value
}

export function rotationDegreesToRadians(degrees: number): number {
  return normalizeRotation(degrees * DEG_TO_RAD)
}

export function radiansToDegrees(radians: number): number {
  return radians / DEG_TO_RAD
}

export function formatDecimal(value: number): string {
  return String(parseFloat(value.toFixed(4)))
}

export function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.round(-Math.log10(step)))
  return Number((Math.round(value / step) * step).toFixed(decimals))
}

export interface NodeWorldReading {
  readonly world: WorldTransform
  readonly parentWorld: WorldTransform | null
}

export function readNodeWorld(engine: EngineReadOnly, nodeId: string): NodeWorldReading | null {
  const scene = sceneOfNode(engine, nodeId)
  if (!scene) {
    return null
  }
  const node = scene.getNode(nodeId)
  const world = worldTransformOf(scene, nodeId)
  if (!node || !world) {
    return null
  }
  const parent = node.parent
  if (!parent || !parentWorldScaled(parent, scene)) {
    return { world, parentWorld: null }
  }
  const parentWorld = worldTransformOf(scene, parent.id)
  return parentWorld ? { world, parentWorld } : { world, parentWorld: null }
}

function parentWorldScaled(parent: SceneNode, scene: Scene): boolean {
  const parentWorld = worldTransformOf(scene, parent.id)
  return parentWorld !== null && parentWorld.scaleX !== 0 && parentWorld.scaleY !== 0
}

function toLocalTransform(
  engine: EngineReadOnly,
  nodeId: string,
  mutate: (world: WorldTransform) => WorldTransform,
): Transform | null {
  const reading = readNodeWorld(engine, nodeId)
  if (!reading) {
    return null
  }
  const target = mutate(reading.world)
  if (!reading.parentWorld) {
    return target
  }
  return relativeTransform(target, reading.parentWorld)
}

export function applyNodePosition(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeId: string,
  x: number,
  y: number,
): CommandResult<MoveNodeInverse> {
  const local = toLocalTransform(engine, nodeId, (world) => ({ ...world, x, y }))
  if (!local) {
    throw new Error(`Cannot edit the position of node ${nodeId}`)
  }
  return dispatch(new MoveNodeCommand({ nodeId, x: local.x, y: local.y }))
}

export function applyNodeRotationDegrees(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeId: string,
  degrees: number,
): CommandResult<RotateNodeInverse> {
  const rotation = rotationDegreesToRadians(degrees)
  const local = toLocalTransform(engine, nodeId, (world) => ({ ...world, rotation }))
  if (!local) {
    throw new Error(`Cannot edit the rotation of node ${nodeId}`)
  }
  return dispatch(new RotateNodeCommand({ nodeId, rotation: local.rotation }))
}

export function requireNonZeroScale(value: number, what: string): number {
  requireFiniteNumber(value, what)
  if (value === 0) {
    throw new Error(`${what} must not be zero`)
  }
  return value
}

export function applyNodeScale(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeId: string,
  scaleX: number,
  scaleY: number,
): CommandResult<ScaleNodeInverse> {
  requireNonZeroScale(scaleX, 'Scale X')
  requireNonZeroScale(scaleY, 'Scale Y')
  const local = toLocalTransform(engine, nodeId, (world) => ({ ...world, scaleX, scaleY }))
  if (!local) {
    throw new Error(`Cannot edit the scale of node ${nodeId}`)
  }
  return dispatch(new ScaleNodeCommand({ nodeId, scaleX: local.scaleX, scaleY: local.scaleY }))
}

export function resetNodeTransform(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeId: string,
): CommandResult<TransactionInverse> | null {
  const reading = readNodeWorld(engine, nodeId)
  if (!reading) {
    return null
  }
  if (transformsEqual(reading.world, identityTransform())) {
    return null
  }
  const target = reading.parentWorld
    ? relativeTransform(identityTransform(), reading.parentWorld)
    : identityTransform()
  if (!target) {
    return null
  }
  return dispatch(
    new TransactionCommand([
      new MoveNodeCommand({ nodeId, x: target.x, y: target.y }),
      new RotateNodeCommand({ nodeId, rotation: target.rotation }),
      new ScaleNodeCommand({ nodeId, scaleX: target.scaleX, scaleY: target.scaleY }),
    ]),
  )
}

export function degreesOf(world: WorldTransform): number {
  return radiansToDegrees(normalizeRotation(world.rotation))
}

function sceneOfNode(engine: EngineReadOnly, nodeId: string): Scene | null {
  for (const slide of engine.project?.slides ?? []) {
    if (slide.scene.getNode(nodeId)) {
      return slide.scene
    }
  }
  return null
}
