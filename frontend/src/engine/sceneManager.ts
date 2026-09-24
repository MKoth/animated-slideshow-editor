import { newId } from './ids'
import type { Scene } from './scene'
import { Scene as SceneModel } from './scene'
import { SceneNode, walkPreOrder } from './sceneNode'
import { identityTransform } from './transform'
import type { NodeManager } from './nodeManager'
import { copyComponents } from './components'
import { copyMaterialInstance } from './materialInstance'
import { cloneShadowEffect } from './shadowEffect'
import { newClipInstanceId } from './clipInstance'
import { newCollectionPlacementId } from './collectionPlacement'
import { cloneControlSet } from './control'

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
    const placementIds = new Map<string, string>()
    for (const node of walkPreOrder(source.root)) {
      nodeIds.set(node.id, newId('node'))
      for (const placement of node.collectionPlacements) {
        placementIds.set(placement.id, newCollectionPlacementId())
      }
    }
    const root = copyNodeDeep(source.root, null, nodeIds, placementIds)
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
        if (!scene.getNode(node.id)) {
          scene.register(node)
        }
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
  nodeIds: ReadonlyMap<string, string>,
  placementIds: ReadonlyMap<string, string>,
): SceneNode {
  const id = requireCopiedId(nodeIds, source.id, 'node')
  const copy = new SceneNode(
    id,
    source.name,
    { ...source.transform },
    copyComponents(source.components),
    source.semanticName,
  )
  copy.visible = source.visible
  copy.opacity = source.opacity
  copy.zIndex = source.zIndex
  copy.material = copyMaterialInstance(source.material)
  if (source.shadowEffect) {
    copy.shadowEffect = cloneShadowEffect(source.shadowEffect)
  }
  if (source.castShadow !== undefined) {
    copy.castShadow = source.castShadow
  }
  if (source.controlSet) {
    copy.controlSet = cloneControlSet(source.controlSet, id)
  }
  for (const placement of source.collectionPlacements) {
    copy.collectionPlacements.push({
      id: requireCopiedId(placementIds, placement.id, 'placement'),
      collectionId: placement.collectionId,
      parentNodeId: requireCopiedId(nodeIds, placement.parentNodeId, 'placement parent'),
      startTime: placement.startTime,
    })
  }
  for (const inst of source.clipInstances) {
    copy.clipInstances.push({
      ...inst,
      id: newClipInstanceId(),
      paramOverrides: { ...inst.paramOverrides },
      ...(inst.placementId !== undefined
        ? { placementId: requireCopiedId(placementIds, inst.placementId, 'instance placement') }
        : {}),
      ...(inst.collectionTargetId !== undefined
        ? {
            collectionTargetId: requireCopiedId(
              nodeIds,
              inst.collectionTargetId,
              'collection target',
            ),
          }
        : {}),
    })
  }
  copy.parent = parent
  if (parent) {
    parent.children.push(copy)
  }
  for (const child of source.children) {
    copyNodeDeep(child, copy, nodeIds, placementIds)
  }
  return copy
}

function requireCopiedId(
  copiedIds: ReadonlyMap<string, string>,
  sourceId: string,
  what: string,
): string {
  const copied = copiedIds.get(sourceId)
  if (!copied) {
    throw new Error(`Copied scene has no ${what} for: ${sourceId}`)
  }
  return copied
}

function findNodeById(root: SceneNode, id: string): SceneNode {
  for (const node of walkPreOrder(root)) {
    if (node.id === id) {
      return node
    }
  }
  throw new Error(`Copied node not found: ${id}`)
}
