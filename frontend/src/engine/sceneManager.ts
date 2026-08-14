import { newId } from './ids'
import type { Scene } from './scene'
import { Scene as SceneModel } from './scene'
import { SceneNode, walkPreOrder } from './sceneNode'
import { identityTransform } from './transform'
import type { NodeManager } from './nodeManager'
import { copyComponents } from './components'

export interface CopiedScene {
  readonly scene: Scene
  readonly nodeIds: ReadonlyMap<string, string>
}

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

  copyScene(source: Scene): CopiedScene {
    const nodeIds = new Map<string, string>()
    const root = copyNodeDeep(source.root, null, nodeIds)
    const cameraId = nodeIds.get(source.camera.id)
    if (!cameraId) {
      throw new Error('Copied scene has no camera node')
    }
    const scene = new SceneModel(newId('scene'), root, findNodeById(root, cameraId))
    this.install(scene)
    return { scene, nodeIds }
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

function copyNodeDeep(
  source: SceneNode,
  parent: SceneNode | null,
  nodeIds: Map<string, string>,
): SceneNode {
  const id = newId('node')
  nodeIds.set(source.id, id)
  const copy = new SceneNode(
    id,
    source.name,
    { ...source.transform },
    copyComponents(source.components),
  )
  copy.visible = source.visible
  copy.opacity = source.opacity
  copy.parent = parent
  if (parent) {
    parent.children.push(copy)
  }
  for (const child of source.children) {
    copyNodeDeep(child, copy, nodeIds)
  }
  return copy
}

function findNodeById(root: SceneNode, id: string): SceneNode {
  for (const node of walkPreOrder(root)) {
    if (node.id === id) {
      return node
    }
  }
  throw new Error(`Copied node not found: ${id}`)
}
