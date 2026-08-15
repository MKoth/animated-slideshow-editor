import type { EnginePublic, SceneNode } from '../engine'
import { resolveMaterial } from '../engine'
import { OPACITY_MULTIPLIER_PARAMETER_KEY, TINT_PARAMETER_KEY } from '../engine'
import type { MaterialOverrideValue, MaterialParameterDefault } from '../engine'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import {
  AssignMaterialCommand,
  ClearMaterialOverrideCommand,
  OverrideMaterialParameterCommand,
} from '../engine/commands'
import type { Command } from '../engine/commands'
import { dispatchCommands } from './keyframeActions'

export interface MaterialReading {
  readonly definitionId: string
  readonly tint: string
  readonly opacityMultiplier: number
  readonly tintOverridden: boolean
  readonly opacityMultiplierOverridden: boolean
}

export function readMaterial(engine: EnginePublic, node: SceneNode): MaterialReading {
  let parameters: readonly MaterialParameterDefault[] = []
  try {
    parameters = engine.getMaterialDefinition(node.material.materialDefinitionId).parameters
  } catch {
    // unknown definition: resolve overrides against the built-in defaults
    parameters = []
  }
  const effective = resolveMaterial(parameters, node.material.overrides)
  const overrides = node.material.overrides
  return {
    definitionId: node.material.materialDefinitionId,
    tint: effective.tint,
    opacityMultiplier: effective.opacityMultiplier,
    tintOverridden: Object.prototype.hasOwnProperty.call(overrides, 'tint'),
    opacityMultiplierOverridden: Object.prototype.hasOwnProperty.call(
      overrides,
      'opacityMultiplier',
    ),
  }
}

export function assignMaterialToNodes(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
  materialDefinitionId: string,
): CommandResult<unknown> | null {
  const children: Command<unknown>[] = []
  for (const nodeId of nodeIds) {
    const node = engine.getNode(nodeId)
    if (node.material.materialDefinitionId !== materialDefinitionId) {
      children.push(new AssignMaterialCommand({ nodeId, materialDefinitionId }))
    }
  }
  return dispatchCommands(dispatch, children)
}

function effectiveValueOf(
  engine: EnginePublic,
  node: SceneNode,
  parameter: string,
): MaterialOverrideValue | undefined {
  const reading = readMaterial(engine, node)
  if (parameter === TINT_PARAMETER_KEY) {
    return reading.tint
  }
  if (parameter === OPACITY_MULTIPLIER_PARAMETER_KEY) {
    return reading.opacityMultiplier
  }
  return undefined
}

export function overrideMaterialParameterOnNodes(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
  parameter: string,
  value: MaterialOverrideValue,
): CommandResult<unknown> | null {
  const children: Command<unknown>[] = []
  for (const nodeId of nodeIds) {
    const node = engine.getNode(nodeId)
    const current = node.material.overrides[parameter]
    const effective = effectiveValueOf(engine, node, parameter)
    if ((current ?? effective) === value) {
      continue
    }
    children.push(new OverrideMaterialParameterCommand({ nodeId, parameter, value }))
  }
  return dispatchCommands(dispatch, children)
}

export function clearMaterialOverrideOnNodes(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  nodeIds: readonly string[],
  parameter: string,
): CommandResult<unknown> | null {
  const children: Command<unknown>[] = []
  for (const nodeId of nodeIds) {
    const node = engine.getNode(nodeId)
    if (Object.prototype.hasOwnProperty.call(node.material.overrides, parameter)) {
      children.push(new ClearMaterialOverrideCommand({ nodeId, parameter }))
    }
  }
  return dispatchCommands(dispatch, children)
}
