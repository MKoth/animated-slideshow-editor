import type { EnginePublic, SceneNode } from '../engine'
import { resolveMaterial, uniformValuesEqual } from '../engine'
import { OPACITY_MULTIPLIER_PARAMETER_KEY, TINT_PARAMETER_KEY } from '../engine'
import type {
  MaterialOverrideValue,
  MaterialParameterDefault,
  MaterialParameterDefaultValue,
} from '../engine'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import {
  AssignMaterialCommand,
  ClearMaterialOverrideCommand,
  OverrideMaterialParameterCommand,
} from '../engine/commands'
import type { Command } from '../engine/commands'
import { RESERVED_TEXTURE_UNIFORM, RESERVED_TIME_UNIFORM } from '../shaders/reflection'
import { dispatchCommands } from './keyframeActions'
import { readUniformReadings } from './uniformReadings'
import type { UniformReading } from './uniformReadings'

export type { UniformReading } from './uniformReadings'

export interface MaterialReading {
  readonly definitionId: string
  readonly tint: string
  readonly opacityMultiplier: number
  readonly tintOverridden: boolean
  readonly opacityMultiplierOverridden: boolean
  readonly uniforms: readonly UniformReading[]
}

function definitionParametersOf(
  engine: EnginePublic,
  node: SceneNode,
): readonly MaterialParameterDefault[] {
  try {
    return engine.getMaterialDefinition(node.material.materialDefinitionId).parameters
  } catch {
    // unknown definition: resolve overrides against the built-in defaults
    return []
  }
}

export function readMaterial(engine: EnginePublic, node: SceneNode): MaterialReading {
  const parameters = definitionParametersOf(engine, node)
  const effective = resolveMaterial(parameters, node.material.overrides)
  const uniforms = readUniformReadings(parameters, node.material.overrides, [
    TINT_PARAMETER_KEY,
    OPACITY_MULTIPLIER_PARAMETER_KEY,
    RESERVED_TEXTURE_UNIFORM,
    RESERVED_TIME_UNIFORM,
  ])
  return {
    definitionId: node.material.materialDefinitionId,
    tint: effective.tint,
    opacityMultiplier: effective.opacityMultiplier,
    tintOverridden: Object.prototype.hasOwnProperty.call(node.material.overrides, 'tint'),
    opacityMultiplierOverridden: Object.prototype.hasOwnProperty.call(
      node.material.overrides,
      'opacityMultiplier',
    ),
    uniforms,
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
): MaterialParameterDefaultValue | undefined {
  const reading = readMaterial(engine, node)
  if (parameter === TINT_PARAMETER_KEY) {
    return reading.tint
  }
  if (parameter === OPACITY_MULTIPLIER_PARAMETER_KEY) {
    return reading.opacityMultiplier
  }
  for (const uniform of reading.uniforms) {
    if (uniform.key === parameter) {
      return uniform.effective
    }
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
    if (uniformValuesEqual(current ?? effective, value)) {
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
