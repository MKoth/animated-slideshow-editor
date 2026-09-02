import type { MaterialJSON } from './json'
import { isRecord, requireOverrides, requireString } from './guards'
import {
  DEFAULT_FIT_MODE,
  DEFAULT_UV_OFFSET,
  DEFAULT_UV_SCALE,
  cloneUVTransform,
  requireFitMode,
  requireUVOffset,
  requireUVScale,
  type UVTransform,
} from './uvTransform'

export type MaterialOverrideValue = string | number | boolean | readonly number[]

export type MaterialParameterDefaultValue = MaterialOverrideValue

export type MaterialOverrides = Readonly<Record<string, MaterialOverrideValue>>

export interface MaterialInstance {
  readonly materialDefinitionId: string
  readonly overrides: MaterialOverrides
  readonly textureId?: string
  readonly uvTransform?: UVTransform
}

export type { FitMode, UVTransform } from './uvTransform'
export { DEFAULT_FIT_MODE, DEFAULT_UV_OFFSET, DEFAULT_UV_SCALE } from './uvTransform'

export const DEFAULT_MATERIAL_DEFINITION_ID =
  // uuid5("animated-slideshow-editor/builtin-material/default"), computed in
  // backend/app/materials/model.py so the engine and the library share one id
  '0d3f4464-8300-5b6d-ae14-45246fefbeae'
export const DEFAULT_MATERIAL_NAME = 'Default Material'

export function defaultMaterial(): MaterialInstance {
  return { materialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID, overrides: {} }
}

export function defaultUVTransformForMaterial(): UVTransform {
  return {
    uvScale: { ...DEFAULT_UV_SCALE },
    uvOffset: { ...DEFAULT_UV_OFFSET },
    fitMode: DEFAULT_FIT_MODE,
  }
}

export function isDefaultUVTransform(transform: UVTransform | undefined): boolean {
  if (!transform) return true
  return (
    transform.uvScale.u === DEFAULT_UV_SCALE.u &&
    transform.uvScale.v === DEFAULT_UV_SCALE.v &&
    transform.uvOffset.u === DEFAULT_UV_OFFSET.u &&
    transform.uvOffset.v === DEFAULT_UV_OFFSET.v &&
    transform.fitMode === DEFAULT_FIT_MODE
  )
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
  const hasTexture = typeof material.textureId === 'string' && material.textureId !== ''
  const hasUVTransform =
    material.uvTransform !== undefined && !isDefaultUVTransform(material.uvTransform)
  if (
    material.materialDefinitionId === DEFAULT_MATERIAL_DEFINITION_ID &&
    Object.keys(material.overrides).length === 0 &&
    !hasTexture &&
    !hasUVTransform
  ) {
    return undefined
  }
  const result: MaterialJSON = {
    definitionId: material.materialDefinitionId,
    overrides: { ...material.overrides },
  }
  if (hasTexture) {
    ;(result as unknown as Record<string, unknown>).textureId = material.textureId
  }
  if (hasUVTransform && material.uvTransform) {
    const t = material.uvTransform
    ;(result as unknown as Record<string, unknown>).uvScale = { ...t.uvScale }
    ;(result as unknown as Record<string, unknown>).uvOffset = { ...t.uvOffset }
    ;(result as unknown as Record<string, unknown>).fitMode = t.fitMode
  } else if (hasTexture && material.uvTransform) {
    // texture without custom uv still persists defaults? Keep explicit if texture present and transform explicitly stored
    const t = material.uvTransform
    if (t) {
      ;(result as unknown as Record<string, unknown>).uvScale = { ...t.uvScale }
      ;(result as unknown as Record<string, unknown>).uvOffset = { ...t.uvOffset }
      ;(result as unknown as Record<string, unknown>).fitMode = t.fitMode
    }
  }
  return result
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
  let textureId: string | undefined
  if (value.textureId !== undefined) {
    if (typeof value.textureId !== 'string' || value.textureId === '') {
      throw new Error(`Node "${nodeId}" material textureId must be a non-empty string`)
    }
    textureId = value.textureId as string
  }
  let uvTransform: UVTransform | undefined
  const hasUVScale = value.uvScale !== undefined
  const hasUVOffset = value.uvOffset !== undefined
  const hasFitMode = value.fitMode !== undefined
  if (hasUVScale || hasUVOffset || hasFitMode) {
    const uvScale = hasUVScale
      ? requireUVScale(value.uvScale, `Node "${nodeId}" uvScale`)
      : { ...DEFAULT_UV_SCALE }
    const uvOffset = hasUVOffset
      ? requireUVOffset(value.uvOffset, `Node "${nodeId}" uvOffset`)
      : { ...DEFAULT_UV_OFFSET }
    const fitMode = hasFitMode
      ? requireFitMode(value.fitMode, `Node "${nodeId}" fitMode`)
      : DEFAULT_FIT_MODE
    uvTransform = { uvScale, uvOffset, fitMode }
    // Omit default transform unless texture present? Keep for explicit non-default; but we persist even default if explicitly present
    if (isDefaultUVTransform(uvTransform) && !hasTextureIdForPersist(value)) {
      uvTransform = undefined
    }
  } else if (textureId !== undefined) {
    // texture present but no uv fields → defaults implicitly (undefined = default)
    uvTransform = undefined
  }
  const result: MaterialInstance = { materialDefinitionId: definitionId, overrides }
  if (textureId !== undefined) {
    ;(result as unknown as Record<string, unknown>).textureId = textureId
  }
  if (uvTransform !== undefined) {
    ;(result as unknown as Record<string, unknown>).uvTransform = uvTransform
  }
  return result
}

function hasTextureIdForPersist(value: Record<string, unknown>): boolean {
  return typeof value.textureId === 'string' && value.textureId !== ''
}

export function materialHasTexture(material: MaterialInstance): boolean {
  return typeof material.textureId === 'string' && material.textureId !== ''
}

export function copyMaterialInstance(material: MaterialInstance): MaterialInstance {
  const base: MaterialInstance = {
    materialDefinitionId: material.materialDefinitionId,
    overrides: { ...material.overrides },
  }
  if (material.textureId !== undefined) {
    ;(base as unknown as Record<string, unknown>).textureId = material.textureId
  }
  if (material.uvTransform !== undefined) {
    ;(base as unknown as Record<string, unknown>).uvTransform = cloneUVTransform(
      material.uvTransform,
    )
  }
  return base
}

export function withTextureAndUV(
  material: MaterialInstance,
  textureId: string | null,
  uvTransform?: UVTransform,
): MaterialInstance {
  const base: Record<string, unknown> = {
    materialDefinitionId: material.materialDefinitionId,
    overrides: { ...material.overrides },
  }
  if (textureId !== null) {
    base.textureId = textureId
  }
  if (uvTransform !== undefined) {
    base.uvTransform = cloneUVTransform(uvTransform)
  } else if (textureId !== null && material.uvTransform) {
    base.uvTransform = cloneUVTransform(material.uvTransform)
  }
  // if texture removed, also remove uvTransform unless explicitly kept
  if (textureId === null) {
    // do not carry uvTransform
  }
  return base as unknown as MaterialInstance
}
