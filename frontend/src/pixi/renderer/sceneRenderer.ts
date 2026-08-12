import type { EngineReadOnly } from '../../engine'
import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import { walkPreOrder } from '../../engine/sceneNode'
import type { PixiContainer, RendererPixi } from './pixi'
import { applyName, applyTransform, createNodeContainer } from './nodeRenderer'
import type { TextureCache } from './textureCache'

export class SceneRenderer {
  readonly #engine: EngineReadOnly
  readonly #pixi: RendererPixi
  readonly #textureCache: TextureCache
  readonly #world: PixiContainer
  readonly #containers = new Map<string, PixiContainer>()
  readonly #nodeIds = new WeakMap<PixiContainer, string>()
  #scene: Scene | null = null

  constructor(
    engine: EngineReadOnly,
    world: PixiContainer,
    pixi: RendererPixi,
    textureCache: TextureCache,
  ) {
    this.#engine = engine
    this.#world = world
    this.#pixi = pixi
    this.#textureCache = textureCache
  }

  get boundSceneId(): string | null {
    return this.#scene?.id ?? null
  }

  get boundCamera(): SceneNode | null {
    return this.#scene?.camera ?? null
  }

  get renderedNodeCount(): number {
    let count = 0
    for (const container of this.#containers.values()) {
      if (container.visible) {
        count += 1
      }
    }
    return count
  }

  bind(scene: Scene | null): void {
    for (const container of this.#containers.values()) {
      container.destroy({ children: true })
    }
    this.#containers.clear()
    this.#scene = scene
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#addNode(node)
    }
  }

  handleNodeCreated(nodeId: string): void {
    if (!this.#scene || !this.#scene.getNode(nodeId)) {
      return
    }
    if (this.#containers.has(nodeId)) {
      return
    }
    this.#addNode(this.#engine.getNode(nodeId))
  }

  handleNodeRemoved(nodeId: string): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    for (const descendant of walkContainers(container)) {
      const descendantId = this.#nodeIds.get(descendant)
      if (descendantId) {
        this.#containers.delete(descendantId)
      }
      this.#nodeIds.delete(descendant)
    }
    container.destroy({ children: true })
  }

  handleTransformChanged(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    applyTransform(container, this.#engine.getNode(nodeId))
  }

  handleVisibilityChanged(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    container.visible = this.#engine.getNode(nodeId).visible
  }

  handleNodeRenamed(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    applyName(container, this.#engine.getNode(nodeId))
  }

  handleOpacityChanged(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    container.alpha = this.#engine.getNode(nodeId).opacity
  }

  handleNodeReparented(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    this.#attachToParent(container, this.#engine.getNode(nodeId))
  }

  #addNode(node: SceneNode): void {
    const container = createNodeContainer(this.#pixi, node, this.#textureCache)
    this.#containers.set(node.id, container)
    this.#nodeIds.set(container, node.id)
    this.#attachToParent(container, node)
  }

  #attachToParent(container: PixiContainer, node: SceneNode): void {
    const parentContainer = node.parent ? this.#containers.get(node.parent.id) : undefined
    ;(parentContainer ?? this.#world).addChild(container)
  }
}

function* walkContainers(root: PixiContainer): IterableIterator<PixiContainer> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    stack.push(...current.children)
    yield current
  }
}
