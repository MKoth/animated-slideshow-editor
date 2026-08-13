import type { EngineReadOnly, Scene, SceneNode } from '../engine'
import { normalizeRotation } from '../engine'
import { requireFiniteNumber, requireNonEmpty } from '../engine/guards'
import { namesInTree, uniqueNodeName } from '../engine/naming'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import {
  MoveNodeCommand,
  RenameNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  SetOpacityCommand,
  TransactionCommand,
} from '../engine/commands'
import type { Command } from '../engine/commands'
import type {
  MoveNodeInverse,
  RenameNodeInverse,
  RotateNodeInverse,
  ScaleNodeInverse,
  SetOpacityInverse,
} from '../engine/commands'
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
  return toLocalTransformOf(reading, mutate)
}

function toLocalTransformOf(
  reading: NodeWorldReading,
  mutate: (world: WorldTransform) => WorldTransform,
): Transform | null {
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

export function applyField(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  node: SceneNode,
  world: WorldTransform,
  field: InspectorFieldKind,
  value: number,
): CommandResult<MoveNodeInverse | RotateNodeInverse | ScaleNodeInverse> | null {
  switch (field) {
    case 'x':
      return applyNodePosition(engine, dispatch, node.id, value, world.y)
    case 'y':
      return applyNodePosition(engine, dispatch, node.id, world.x, value)
    case 'rotation':
      return applyNodeRotationDegrees(engine, dispatch, node.id, value)
    case 'scaleX':
      return applyNodeScale(engine, dispatch, node.id, value, world.scaleY)
    case 'scaleY':
      return applyNodeScale(engine, dispatch, node.id, world.scaleX, value)
  }
}

export type InspectorFieldKind = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'

export const FIELD_LABELS: Record<InspectorFieldKind, string> = {
  x: 'X',
  y: 'Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
}

interface FieldRules {
  readonly apply: (world: WorldTransform, value: number) => WorldTransform
  readonly build: (nodeId: string, local: Transform) => Command<unknown>
  readonly needsNonZeroScale: boolean
}

const FIELD_RULES: Record<InspectorFieldKind, FieldRules> = {
  x: {
    apply: (world, value) => ({ ...world, x: value }),
    build: (nodeId, local) => new MoveNodeCommand({ nodeId, x: local.x, y: local.y }),
    needsNonZeroScale: false,
  },
  y: {
    apply: (world, value) => ({ ...world, y: value }),
    build: (nodeId, local) => new MoveNodeCommand({ nodeId, x: local.x, y: local.y }),
    needsNonZeroScale: false,
  },
  rotation: {
    apply: (world, value) => ({ ...world, rotation: normalizeRotation(value * DEG_TO_RAD) }),
    build: (nodeId, local) => new RotateNodeCommand({ nodeId, rotation: local.rotation }),
    needsNonZeroScale: false,
  },
  scaleX: {
    apply: (world, value) => ({ ...world, scaleX: value }),
    build: (nodeId, local) =>
      new ScaleNodeCommand({ nodeId, scaleX: local.scaleX, scaleY: local.scaleY }),
    needsNonZeroScale: true,
  },
  scaleY: {
    apply: (world, value) => ({ ...world, scaleY: value }),
    build: (nodeId, local) =>
      new ScaleNodeCommand({ nodeId, scaleX: local.scaleX, scaleY: local.scaleY }),
    needsNonZeroScale: true,
  },
}

export function applyNodeName(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
  requested: string,
): CommandResult<RenameNodeInverse | TransactionInverse> | null {
  const name = requireNonEmpty(requested, 'Node name').trim()
  if (nodeIds.length === 0) {
    return null
  }
  if (nodeIds.length === 1) {
    const nodeId = nodeIds[0]
    const node = engine.getNode(nodeId)
    const scene = sceneOfNode(engine, nodeId)
    if (!scene) {
      return null
    }
    const taken = namesInTree(scene.root)
    taken.delete(node.name)
    const candidate = uniqueNodeName(taken, name)
    if (candidate === node.name) {
      return null
    }
    return dispatch(new RenameNodeCommand({ nodeId, name: candidate }))
  }
  const scenes = nodeIds.map((nodeId) => sceneOfNode(engine, nodeId))
  const groups = new Map<string, { ids: string[]; taken: Set<string> }>()
  nodeIds.forEach((nodeId, index) => {
    const scene = scenes[index]
    if (!scene) {
      return
    }
    let group = groups.get(scene.id)
    if (!group) {
      const taken = namesInTree(scene.root)
      scenes.forEach((otherScene, otherIndex) => {
        if (otherScene?.id === scene.id) {
          taken.delete(engine.getNode(nodeIds[otherIndex]).name)
        }
      })
      group = { ids: [], taken }
      groups.set(scene.id, group)
    }
    group.ids.push(nodeId)
  })
  const children: Command<unknown>[] = []
  for (const group of groups.values()) {
    for (const nodeId of group.ids) {
      const node = engine.getNode(nodeId)
      const candidate = uniqueNodeName(group.taken, name)
      if (candidate !== node.name) {
        children.push(new RenameNodeCommand({ nodeId, name: candidate }))
      }
      group.taken.add(candidate)
    }
  }
  if (children.length === 0) {
    return null
  }
  return dispatch(new TransactionCommand(children))
}

export function applyNodeOpacity(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
  opacity: number,
): CommandResult<SetOpacityInverse | TransactionInverse> | null {
  const clamped = clampFraction(opacity)
  const children: Command<unknown>[] = []
  for (const nodeId of nodeIds) {
    const node = engine.getNode(nodeId)
    if (node.opacity !== clamped) {
      children.push(new SetOpacityCommand({ nodeId, opacity: clamped }))
    }
  }
  if (children.length === 0) {
    return null
  }
  if (nodeIds.length === 1) {
    return dispatch(children[0] as SetOpacityCommand)
  }
  return dispatch(new TransactionCommand(children))
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function applyNodeField(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
  field: InspectorFieldKind,
  value: number,
): CommandResult<
  MoveNodeInverse | RotateNodeInverse | ScaleNodeInverse | TransactionInverse
> | null {
  const rules = FIELD_RULES[field]
  if (rules.needsNonZeroScale) {
    requireNonZeroScale(value, FIELD_LABELS[field])
  }
  const children: Command<unknown>[] = []
  for (const nodeId of nodeIds) {
    const local = toLocalTransform(engine, nodeId, (world) => rules.apply(world, value))
    if (!local) {
      continue
    }
    if (transformsEqual(engine.getNode(nodeId).transform, local)) {
      continue
    }
    children.push(rules.build(nodeId, local))
  }
  if (children.length === 0) {
    return null
  }
  return dispatch(new TransactionCommand(children))
}

export function resetNodesTransform(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
): CommandResult<TransactionInverse> | null {
  const children: Command<unknown>[] = []
  for (const nodeId of nodeIds) {
    const reading = readNodeWorld(engine, nodeId)
    if (!reading) {
      continue
    }
    if (transformsEqual(reading.world, identityTransform())) {
      continue
    }
    const target = reading.parentWorld
      ? relativeTransform(identityTransform(), reading.parentWorld)
      : identityTransform()
    if (!target) {
      continue
    }
    children.push(
      new MoveNodeCommand({ nodeId, x: target.x, y: target.y }),
      new RotateNodeCommand({ nodeId, rotation: target.rotation }),
      new ScaleNodeCommand({ nodeId, scaleX: target.scaleX, scaleY: target.scaleY }),
    )
  }
  if (children.length === 0) {
    return null
  }
  return dispatch(new TransactionCommand(children))
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
