import type { MaterialJSON } from './json'
import { isRecord, requireOverrides, requireString } from './guards'

export type MaterialOverrideValue = string | number | boolean | readonly number[]

export type MaterialParameterDefaultValue = MaterialOverrideValue

export type MaterialOverrides = Readonly<Record<string, MaterialOverrideValue>>

export interface MaterialInstance {
  readonly materialDefinitionId: string
  readonly overrides: MaterialOverrides
}

export const DEFAULT_MATERIAL_DEFINITION_ID =
  // uuid5("animated-slideshow-editor/builtin-material/default"), computed in
  // backend/app/materials/model.py so the engine and the library share one id
  '0d3f4464-8300-5b6d-ae14-45246fefbeae'
export const DEFAULT_MATERIAL_NAME = 'Default Material'

export function defaultMaterial(): MaterialInstance {
  return { materialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID, overrides: {} }
}

export function requireMaterialOverridePresent(
  material: MaterialInstance,
  parameter: string,
  nodeId: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(material.overrides, parameter)) {
    throw new Error(`Node "${nodeId}" has no override for material parameter "${parameter}"`)
  }
}

export function materialToJSON(material: MaterialInstance): MaterialJSON | undefined {
  if (
    material.materialDefinitionId === DEFAULT_MATERIAL_DEFINITION_ID &&
    Object.keys(material.overrides).length === 0
  ) {
    return undefined
  }
  return {
    definitionId: material.materialDefinitionId,
    overrides: { ...material.overrides },
  }
}

export function materialFromJSON(value: unknown, nodeId: string): MaterialInstance {
  if (value === undefined) {
    return defaultMaterial()
  }
  if (!isRecord(value)) {
    throw new Error(`Node "${nodeId}" material must be an object`)
  }
  const definitionId = requireString(value.definitionId, `Node "${nodeId}" material definition id`)
  const overrides = requireOverrides(value.overrides, `Node "${nodeId}" material overrides`)
  return { materialDefinitionId: definitionId, overrides }
}

export function copyMaterialInstance(material: MaterialInstance): MaterialInstance {
  return { ...material, overrides: { ...material.overrides } }
}
