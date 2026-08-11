import { newId } from './ids'
import type { Scene } from './scene'
import { Scene as SceneModel } from './scene'
import { SceneNode, wouldFormCycle } from './sceneNode'
import { identityTransform } from './transform'
import type { SceneJSON } from './json'
import { requireString } from './guards'
import type { NodeManager } from './nodeManager'

export class SceneManager {
  readonly #scenes = new Map<string, Scene>()
  readonly #nodes: NodeManager

  constructor(nodes: NodeManager) {
    this.#nodes = nodes
  }

  createScene(rootName: string): Scene {
    const root = new SceneNode(newId('node'), rootName, identityTransform())
    const camera = new SceneNode(newId('node'), 'Camera', identityTransform(), {
      camera: { kind: 'camera' },
    })
    camera.parent = root
    root.children.push(camera)
    const scene = new SceneModel(newId('scene'), root, camera)
    this.#scenes.set(scene.id, scene)
    this.#nodes.registerRoot(scene)
    return scene
  }

  restoreScene(json: SceneJSON): Scene {
    const sceneId = requireString(json.id, 'Scene id')
    const built = json.nodes.map((nodeJson) => SceneNode.fromJSON(nodeJson))
    const roots = json.nodes.filter((nodeJson) => nodeJson.parentId === null)
    if (roots.length !== 1) {
      throw new Error('A scene must have exactly one root node')
    }
    const root = built.find((node) => node.id === roots[0].id)
    if (!root) {
      throw new Error(`Root node not found: ${roots[0].id}`)
    }
    const cameras = built.filter((node) => node.components.camera)
    if (cameras.length !== 1) {
      throw new Error('A scene must have exactly one camera node')
    }
    const scene = new SceneModel(sceneId, root, cameras[0])
    this.#scenes.set(scene.id, scene)
    for (const node of built) {
      this.#nodes.register(scene, node)
    }
    for (const node of built) {
      if (node !== root && node !== cameras[0]) {
        scene.register(node)
      }
    }
    for (const nodeJson of json.nodes) {
      if (nodeJson.parentId === null) {
        continue
      }
      const parent = scene.getNode(nodeJson.parentId)
      if (!parent) {
        throw new Error(`Parent node not found: ${nodeJson.parentId}`)
      }
      const node = scene.getNode(nodeJson.id)
      if (!node) {
        throw new Error(`Node not found: ${nodeJson.id}`)
      }
      if (wouldFormCycle(node, parent)) {
        throw new Error('A node cannot become a descendant of itself')
      }
      parent.children.push(node)
      node.parent = parent
    }
    const camera = cameras[0]
    if (camera.parent !== root) {
      throw new Error('The camera node must be a child of the scene root')
    }
    return scene
  }

  getScene(sceneId: string): Scene {
    const scene = this.#scenes.get(sceneId)
    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`)
    }
    return scene
  }

  removeScene(sceneId: string): void {
    this.#scenes.delete(sceneId)
    this.#nodes.removeScene(sceneId)
  }

  clear(): void {
    this.#scenes.clear()
  }
}
