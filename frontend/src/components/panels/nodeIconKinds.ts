import type { SceneNode } from '../../engine'

export type NodeIconKind = 'folder' | 'image' | 'text' | 'camera' | 'mesh' | 'table'

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
  if (node.components.table) {
    return 'table'
  }
  return 'folder'
}
