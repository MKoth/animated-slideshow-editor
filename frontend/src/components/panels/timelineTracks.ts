import type { Scene, SceneNode } from '../../engine'

export const TRACK_HEADER_WIDTH = 240
export const ROW_HEIGHT = 28

export interface TrackRowEntry {
  readonly node: SceneNode
  readonly depth: number
  readonly name: string
  readonly visible: boolean
}

export function trackRows(scene: Scene): TrackRowEntry[] {
  const rows: TrackRowEntry[] = []
  const walk = (node: SceneNode, depth: number): void => {
    rows.push({ node, depth, name: node.name, visible: node.visible })
    for (const child of node.children) {
      if (child.components.camera) {
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(scene.root, 0)
  rows.push({
    node: scene.camera,
    depth: 1,
    name: scene.camera.name,
    visible: scene.camera.visible,
  })
  return rows
}

export function sceneHasObjects(scene: Scene): boolean {
  return scene.root.children.some((child) => !child.components.camera)
}
