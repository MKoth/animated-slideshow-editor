export type MaterialOverrideValue = string | number

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
