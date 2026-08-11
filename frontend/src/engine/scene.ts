import type { SceneNode } from './sceneNode'
import { walkPreOrder } from './sceneNode'
import type { NodeJSON, SceneJSON } from './json'

export class Scene {
  readonly id: string
  readonly root: SceneNode
  readonly camera: SceneNode
  readonly #nodes = new Map<string, SceneNode>()

  constructor(id: string, root: SceneNode, camera: SceneNode) {
    this.id = id
    this.root = root
    this.camera = camera
    this.#nodes.set(root.id, root)
    this.#nodes.set(camera.id, camera)
  }

  getNode(id: string): SceneNode | undefined {
    return this.#nodes.get(id)
  }

  register(node: SceneNode): void {
    if (this.#nodes.has(node.id)) {
      throw new Error(`A node with id "${node.id}" already exists in this scene`)
    }
    this.#nodes.set(node.id, node)
  }

  unregister(nodeId: string): void {
    this.#nodes.delete(nodeId)
  }

  toJSON(): SceneJSON {
    const nodes: NodeJSON[] = []
    for (const node of walkPreOrder(this.root)) {
      nodes.push(node.toJSON())
    }
    return { id: this.id, nodes }
  }
}
