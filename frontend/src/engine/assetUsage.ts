import type { Project } from './project'
import { walkPreOrder } from './sceneNode'

export function countAssetUsage(project: Project, assetDefinitionId: string): number {
  let usage = 0
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      if (node.components.assetInstance?.assetDefinitionId === assetDefinitionId) {
        usage += 1
      }
    }
  }
  return usage
}
