import type { EnginePublic } from '../../engine'
import type { Scene } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { worldTransformOf as storedWorldTransformOf } from '../../engine/worldTransform'
import type { SelectionStoreApi } from '../../stores/selectionStore'
import { aabbOf } from './hitTest'
import type { NodeSizeSource } from './hitTest'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldTransform } from './worldGeometry'

const OUTLINE_COLOR = 0x1a73e8
const OUTLINE_WIDTH = 2
const HANDLE_SIZE = 8
const HANDLE_FILL = 0xffffff
const HANDLE_FILL_ALPHA = 0.65

const REDRAW_EVENTS = new Set([
  'TransformChanged',
  'NodeCreated',
  'NodeRemoved',
  'NodeReparented',
  'NodeOrderChanged',
  'KeyframeAdded',
  'KeyframeRemoved',
  'KeyframeMoved',
  'KeyframeValueChanged',
  'IKTargetChanged',
  'IKPoleTargetChanged',
  'MeshChanged',
  'TableChanged',
])

export interface SelectionOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getNodeSize: NodeSizeSource
  readonly store: SelectionStoreApi
  readonly getWorldTransform?: (nodeId: string) => WorldTransform | null
  readonly subscribeTime?: (listener: () => void) => Unsubscribe
}

export class SelectionOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getNodeSize: NodeSizeSource
  readonly #store: SelectionStoreApi
  readonly #getWorldTransform?: (nodeId: string) => WorldTransform | null
  readonly #subscribeTime?: (listener: () => void) => Unsubscribe
  #graphics: PixiGraphics | null = null
  #unsubscribeStore: Unsubscribe | null = null
  #unsubscribeEngine: Unsubscribe | null = null
  #unsubscribeTime: Unsubscribe | null = null
  #attached = false

  constructor(context: SelectionOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getNodeSize = context.getNodeSize
    this.#store = context.store
    this.#getWorldTransform = context.getWorldTransform
    this.#subscribeTime = context.subscribeTime
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    const graphics = new this.#pixi.Graphics()
    graphics.label = 'selection-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    this.#unsubscribeStore = this.#store.subscribe(() => this.redraw())
    this.#unsubscribeEngine = this.#engine.subscribe((event) => {
      if (REDRAW_EVENTS.has(event.type)) {
        this.redraw()
      }
    })
    this.#unsubscribeTime = this.#subscribeTime?.(() => this.redraw()) ?? null
    this.redraw()
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#unsubscribeStore?.()
    this.#unsubscribeStore = null
    this.#unsubscribeEngine?.()
    this.#unsubscribeEngine = null
    this.#unsubscribeTime?.()
    this.#unsubscribeTime = null
    this.#graphics?.destroy()
    this.#graphics = null
  }

  bringToFront(): void {
    const graphics = this.#graphics
    if (graphics) {
      this.#world.addChild(graphics)
    }
  }

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    for (const nodeId of this.#store.getState().selectedIds) {
      const size = this.#getNodeSize(nodeId)
      if (!size) {
        continue
      }
      const transform = this.#getWorldTransform
        ? this.#getWorldTransform(nodeId)
        : storedWorldTransformOf(scene, nodeId)
      if (!transform) {
        continue
      }
      const aabb = aabbOf(size, transform)
      if (!aabb) {
        continue
      }
      this.#drawSelection(graphics, aabb)
    }
  }

  #drawSelection(
    graphics: PixiGraphics,
    aabb: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    graphics
      .rect(aabb.minX, aabb.minY, aabb.maxX - aabb.minX, aabb.maxY - aabb.minY)
      .stroke({ width: OUTLINE_WIDTH, color: OUTLINE_COLOR })
    for (const point of handlePositions(aabb)) {
      graphics
        .rect(point.x - HANDLE_SIZE / 2, point.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
        .fill({ color: HANDLE_FILL, alpha: HANDLE_FILL_ALPHA })
        .stroke({ width: 1, color: OUTLINE_COLOR })
    }
  }
}

function handlePositions(aabb: {
  minX: number
  minY: number
  maxX: number
  maxY: number
}): { x: number; y: number }[] {
  const minX = aabb.minX
  const minY = aabb.minY
  const maxX = aabb.maxX
  const maxY = aabb.maxY
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  return [
    { x: minX, y: minY },
    { x: midX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: midY },
    { x: maxX, y: midY },
    { x: minX, y: maxY },
    { x: midX, y: maxY },
    { x: maxX, y: maxY },
  ]
}
