import type { EventBus } from './events'
import { newId } from './ids'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import {
  SceneNode as SceneNodeModel,
  detachFromParent,
  walkPreOrder,
  wouldFormCycle,
} from './sceneNode'
import type { Transform } from './transform'
import { identityTransform, normalizeRotation } from './transform'
import type { NodeComponents } from './components'
import {
  requireMaterialOverrideValue,
  requireMaterialParameterKey,
  requireNonEmpty,
  requireOpacity,
} from './guards'
import type { MaterialOverrideValue } from './materialInstance'
import { requireMaterialOverridePresent } from './materialInstance'

export interface CreateNodeOptions {
  readonly id?: string
  readonly transform?: Transform
  readonly visible?: boolean
  readonly opacity?: number
  readonly components?: NodeComponents
}

export class NodeManager {
  readonly #bus: EventBus
  readonly #sceneLookup: (sceneId: string) => Scene
  readonly #byId = new Map<string, { scene: Scene; node: SceneNode }>()

  constructor(bus: EventBus, sceneLookup: (sceneId: string) => Scene) {
    this.#bus = bus
    this.#sceneLookup = sceneLookup
  }

  register(scene: Scene, node: SceneNode): void {
    if (this.#byId.has(node.id)) {
      throw new Error(`A node with id "${node.id}" already exists`)
    }
    this.#byId.set(node.id, { scene, node })
  }

  registerRoot(scene: Scene): void {
    this.register(scene, scene.root)
    this.register(scene, scene.camera)
  }

  getById(nodeId: string): SceneNode {
    const entry = this.#byId.get(nodeId)
    if (!entry) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    return entry.node
  }

  getSceneOf(nodeId: string): Scene {
    const entry = this.#byId.get(nodeId)
    if (!entry) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    return entry.scene
  }

  create(
    sceneId: string,
    parentId: string,
    name: string,
    options: CreateNodeOptions = {},
  ): SceneNode {
    if (typeof sceneId !== 'string' || sceneId === '') {
      throw new Error('Scene id is required')
    }
    if (typeof parentId !== 'string' || parentId === '') {
      throw new Error('Parent id is required')
    }
    requireNonEmpty(name, 'Node name')
    const scene = this.#sceneLookup(sceneId)
    const parent = scene.getNode(parentId)
    if (!parent) {
      throw new Error(`Parent node not found: ${parentId}`)
    }
    if (options.components?.camera && scene.camera) {
      throw new Error('This scene already has a camera node')
    }
    if (options.opacity !== undefined) {
      requireOpacity(options.opacity, 'Opacity')
    }
    const node = new SceneNodeModel(
      options.id ?? newId('node'),
      name,
      options.transform ?? identityTransform(),
      options.components,
    )
    if (this.#byId.has(node.id)) {
      throw new Error(`A node with id "${node.id}" already exists`)
    }
    scene.register(node)
    this.#byId.set(node.id, { scene, node })
    parent.children.push(node)
    node.parent = parent
    node.visible = options.visible ?? true
    node.opacity = options.opacity ?? 1
    this.#bus.emit({ type: 'NodeCreated', nodeId: node.id })
    return node
  }

  remove(nodeId: string): void {
    const entry = this.#byId.get(nodeId)
    if (!entry) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    const { scene, node } = entry
    if (node === scene.root) {
      throw new Error('The root node cannot be deleted')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be deleted')
    }
    detachFromParent(node)
    for (const descendant of walkPreOrder(node)) {
      this.#byId.delete(descendant.id)
      scene.unregister(descendant.id)
      descendant.parent = null
      descendant.children.length = 0
    }
    this.#bus.emit({ type: 'NodeRemoved', nodeId })
  }

  reparent(nodeId: string, newParentId: string): void {
    const entry = this.#byId.get(nodeId)
    if (!entry) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    const { scene, node } = entry
    if (node === scene.root) {
      throw new Error('The root node cannot be reparented')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reparented')
    }
    const newParent = scene.getNode(newParentId)
    if (!newParent) {
      throw new Error(`Parent node not found: ${newParentId}`)
    }
    if (node === newParent) {
      throw new Error('A node cannot be reparented to itself')
    }
    if (wouldFormCycle(node, newParent)) {
      throw new Error('A node cannot become a descendant of itself')
    }
    detachFromParent(node)
    newParent.children.push(node)
    node.parent = newParent
    this.#bus.emit({ type: 'NodeReparented', nodeId })
  }

  setTransform(nodeId: string, transform: Transform): void {
    const node = this.getById(nodeId)
    if (node.components.camera && transform.rotation !== node.transform.rotation) {
      throw new Error('Camera rotation is locked')
    }
    node.transform = { ...transform, rotation: normalizeRotation(transform.rotation) }
    this.#bus.emit({ type: 'TransformChanged', nodeId })
  }

  setVisibility(nodeId: string, visible: boolean): void {
    const node = this.getById(nodeId)
    node.visible = visible
    this.#bus.emit({ type: 'VisibilityChanged', nodeId })
  }

  renameNode(nodeId: string, name: string): void {
    const node = this.getById(nodeId)
    requireNonEmpty(name, 'Node name')
    node.name = name
    this.#bus.emit({ type: 'NodeRenamed', nodeId })
  }

  setOpacity(nodeId: string, opacity: number): void {
    const node = this.getById(nodeId)
    requireOpacity(opacity, 'Opacity')
    node.opacity = opacity
    this.#bus.emit({ type: 'OpacityChanged', nodeId })
  }

  assignMaterial(nodeId: string, materialDefinitionId: string): void {
    const node = this.getById(nodeId)
    node.material = { materialDefinitionId, overrides: {} }
    this.#bus.emit({ type: 'MaterialAssigned', nodeId })
  }

  overrideMaterialParameter(nodeId: string, parameter: string, value: MaterialOverrideValue): void {
    const node = this.getById(nodeId)
    requireMaterialParameterKey(parameter, 'Material parameter key')
    requireMaterialOverrideValue(value, `Material parameter "${parameter}" value`)
    node.material = {
      ...node.material,
      overrides: { ...node.material.overrides, [parameter]: value },
    }
    this.#bus.emit({ type: 'MaterialParameterChanged', nodeId })
  }

  clearMaterialOverride(nodeId: string, parameter: string): void {
    const node = this.getById(nodeId)
    requireMaterialParameterKey(parameter, 'Material parameter key')
    requireMaterialOverridePresent(node.material, parameter, nodeId)
    const overrides = { ...node.material.overrides }
    delete overrides[parameter]
    node.material = { ...node.material, overrides }
    this.#bus.emit({ type: 'MaterialParameterChanged', nodeId })
  }

  reorderNode(nodeId: string, index: number): void {
    const entry = this.#byId.get(nodeId)
    if (!entry) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    const { scene, node } = entry
    if (node === scene.root) {
      throw new Error('The root node cannot be reordered')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reordered')
    }
    const parent = node.parent
    if (!parent) {
      throw new Error('A node without a parent cannot be reordered')
    }
    if (!Number.isInteger(index) || index < 0 || index >= parent.children.length) {
      throw new Error(`Reorder index out of bounds: ${index}`)
    }
    const current = parent.children.indexOf(node)
    if (current === index) {
      throw new Error(`Node ${node.name} is already at index ${index}`)
    }
    parent.children.splice(current, 1)
    parent.children.splice(index, 0, node)
    this.#bus.emit({ type: 'NodeOrderChanged', nodeId })
  }

  removeScene(sceneId: string): void {
    for (const [nodeId, entry] of this.#byId) {
      if (entry.scene.id === sceneId) {
        this.#byId.delete(nodeId)
      }
    }
  }

  clear(): void {
    this.#byId.clear()
  }
}
