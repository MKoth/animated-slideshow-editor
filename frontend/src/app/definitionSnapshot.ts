import type { EnginePublic } from '../engine'
import { collectReferencedMaterialIds, collectReferencedShaderIds } from '../engine/missingAssets'
import { DEFAULT_MATERIAL_DEFINITION_ID } from '../engine/materialInstance'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import type { MaterialDefinition } from '../api'
import type { ShaderDefinition } from '../api'

export function captureMaterialSnapshot(engine: EnginePublic, definitionId: string): boolean {
  if (engine.getEmbeddedMaterial(definitionId) !== undefined) {
    return true
  }
  const definition = libraryMaterial(definitionId)
  if (!definition) {
    return false
  }
  engine.embedMaterial({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    tags: definition.tags,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
    parameters: definition.parameters.map((parameter) => ({
      key: parameter.key,
      kind: parameter.kind,
      default: parameter.default,
    })),
  })
  return true
}

export function captureShaderSnapshot(engine: EnginePublic, definitionId: string): boolean {
  if (engine.getEmbeddedShader(definitionId) !== undefined) {
    return true
  }
  const definition = libraryShader(definitionId)
  if (!definition) {
    return false
  }
  engine.embedShader({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    tags: definition.tags,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
    source: definition.source,
    defaultUniforms: definition.default_uniforms.map((uniform) => ({ ...uniform })),
    isBuiltin: definition.is_builtin,
  })
  return true
}

export function ensureReferencedMaterialAndShaderSnapshots(engine: EnginePublic): void {
  const project = engine.project
  if (!project) {
    return
  }
  for (const definitionId of collectReferencedMaterialIds(project)) {
    if (definitionId === DEFAULT_MATERIAL_DEFINITION_ID) {
      continue
    }
    captureMaterialSnapshot(engine, definitionId)
  }
  for (const definitionId of collectReferencedShaderIds(project)) {
    captureShaderSnapshot(engine, definitionId)
  }
}

function libraryMaterial(definitionId: string): MaterialDefinition | null {
  return (
    useMaterialLibraryStore
      .getState()
      .definitions.find((definition) => definition.id === definitionId) ?? null
  )
}

function libraryShader(definitionId: string): ShaderDefinition | null {
  return (
    useShaderLibraryStore
      .getState()
      .definitions.find((definition) => definition.id === definitionId) ?? null
  )
}
