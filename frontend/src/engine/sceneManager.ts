import { newId } from './ids'
import type { Scene } from './scene'
import { Scene as SceneModel } from './scene'
import { SceneNode, walkPreOrder } from './sceneNode'
import { identityTransform } from './transform'
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

  install(scene: Scene): void {
    this.#scenes.set(scene.id, scene)
    this.#nodes.registerRoot(scene)
    for (const node of walkPreOrder(scene.root)) {
      if (node !== scene.root && node !== scene.camera) {
        this.#nodes.register(scene, node)
      }
    }
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
