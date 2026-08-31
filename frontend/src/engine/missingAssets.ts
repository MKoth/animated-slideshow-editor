import type { Project } from './project'
import { walkPreOrder } from './sceneNode'

export interface MissingAssetReference {
  readonly assetDefinitionId: string
  readonly nodeIds: readonly string[]
}

export interface MissingAssetsReport {
  readonly missing: readonly MissingAssetReference[]
  readonly affectedNodeIds: readonly string[]
  readonly names: readonly string[]
}

export function collectReferencedDefinitionIds(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      const instance = node.components.assetInstance
      if (instance) {
        ids.add(instance.assetDefinitionId)
      }
    }
  }
  return ids
}

export function collectReferencedAudioAssetIds(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const slide of project.slides) {
    for (const clip of slide.audio.clips) {
      ids.add(clip.assetId)
    }
  }
  return ids
}

export function collectReferencedMaterialIds(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      ids.add(node.material.materialDefinitionId)
    }
  }
  return ids
}

export function collectReferencedShaderIds(
  project: Project,
  shaderIdOfMaterial: (materialDefinitionId: string) => string | null = () => null,
): Set<string> {
  const ids = new Set<string>()
  for (const slide of project.slides) {
    if (slide.fullscreenShader) {
      ids.add(slide.fullscreenShader.shaderDefinitionId)
    }
    for (const node of walkPreOrder(slide.scene.root)) {
      const shaderId = shaderIdOfMaterial(node.material.materialDefinitionId)
      if (shaderId !== null) {
        ids.add(shaderId)
      }
    }
  }
  return ids
}

export function reconcileMissingAssets(
  project: Project,
  availableDefinitionIds: ReadonlySet<string>,
): MissingAssetsReport {
  const missingByDefinition = new Map<string, string[]>()
  const affectedNodeIds: string[] = []
  const seenNames = new Set<string>()
  const names: string[] = []
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      const instance = node.components.assetInstance
      if (!instance) {
        continue
      }
      if (availableDefinitionIds.has(instance.assetDefinitionId)) {
        continue
      }
      affectedNodeIds.push(node.id)
      const nodes = missingByDefinition.get(instance.assetDefinitionId)
      if (nodes) {
        nodes.push(node.id)
      } else {
        missingByDefinition.set(instance.assetDefinitionId, [node.id])
      }
      if (!seenNames.has(node.name)) {
        seenNames.add(node.name)
        names.push(node.name)
      }
    }
  }
  const missing = [...missingByDefinition.entries()].map(([assetDefinitionId, nodeIds]) => ({
    assetDefinitionId,
    nodeIds,
  }))
  return { missing, affectedNodeIds, names }
}
