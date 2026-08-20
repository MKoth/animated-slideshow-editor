import type { SceneNode } from './sceneNode'
import { walkPreOrder } from './sceneNode'

export function collectBones(root: SceneNode): SceneNode[] {
  const bones: SceneNode[] = []
  for (const node of walkPreOrder(root)) {
    if (node.components.bone) {
      bones.push(node)
    }
  }
  return bones
}

export function collectMeshes(root: SceneNode): SceneNode[] {
  const meshes: SceneNode[] = []
  for (const node of walkPreOrder(root)) {
    if (node.components.mesh) {
      meshes.push(node)
    }
  }
  return meshes
}
