import type { SceneNode } from '../../engine'

export type NodeIconKind = 'folder' | 'image' | 'text' | 'camera' | 'mesh'

export function iconOf(node: SceneNode): NodeIconKind {
  if (node.components.camera) {
    return 'camera'
  }
  if (node.components.assetInstance) {
    return 'image'
  }
  if (node.components.text) {
    return 'text'
  }
  if (node.components.mesh) {
    return 'mesh'
  }
  return 'folder'
}
