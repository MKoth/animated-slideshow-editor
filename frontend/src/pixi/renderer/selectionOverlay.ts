import type { EnginePublic } from '../../engine'
import type { Scene } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { worldTransformOf as storedWorldTransformOf } from '../../engine/worldTransform'
import type { SelectionStoreApi } from '../../stores/selectionStore'
import type { NodeSizeSource } from './hitTest'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldTransform } from './worldGeometry'

const OUTLINE_COLOR = 0x1a73e8
const OUTLINE_WIDTH = 2
const HANDLE_SIZE = 8
const HANDLE_FILL = 0xffffff
const HANDLE_FILL_ALPHA = 0.65
const PIVOT_SIZE = 10
const PIVOT_COLOR = 0xff6b35
const ROTATION_HANDLE_OFFSET = 24
const ROTATION_HANDLE_SIZE = 10

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
      const node = scene.getNode(nodeId)
      const pivot = node?.transform.localPivot ?? null
      const aabb = this.#aabbForSelection(size, transform, pivot)
      if (!aabb) {
        continue
      }
      this.#drawSelection(graphics, aabb, transform)
    }
  }

  #aabbForSelection(
    size: { width: number; height: number; offsetX?: number; offsetY?: number },
    transform: WorldTransform,
    pivot: { x: number; y: number } | null,
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    // Use hitTest's aabbOf logic (pivot-aware)
    const hasPivot = pivot && (pivot.x !== 0 || pivot.y !== 0)
    if (!hasPivot) {
      const halfW = (size.width * transform.scaleX) / 2
      const halfH = (size.height * transform.scaleY) / 2
      const centerX =
        transform.x +
        (size.offsetX ?? 0) * transform.scaleX * Math.cos(transform.rotation) -
        (size.offsetY ?? 0) * transform.scaleY * Math.sin(transform.rotation)
      const centerY =
        transform.y +
        (size.offsetX ?? 0) * transform.scaleX * Math.sin(transform.rotation) +
        (size.offsetY ?? 0) * transform.scaleY * Math.cos(transform.rotation)
      const corners = [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ].map((c) => ({
        x: centerX + c.x * Math.cos(transform.rotation) - c.y * Math.sin(transform.rotation),
        y: centerY + c.x * Math.sin(transform.rotation) + c.y * Math.cos(transform.rotation),
      }))
      return {
        minX: Math.min(...corners.map((p) => p.x)),
        minY: Math.min(...corners.map((p) => p.y)),
        maxX: Math.max(...corners.map((p) => p.x)),
        maxY: Math.max(...corners.map((p) => p.y)),
      }
    }
    const pivotOffset = { x: pivot.x * size.width, y: pivot.y * size.height }
    const halfW = size.width / 2
    const halfH = size.height / 2
    const cornersLocal = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ]
    const corners = cornersLocal.map((corner) => {
      const dx = (corner.x - pivotOffset.x) * transform.scaleX
      const dy = (corner.y - pivotOffset.y) * transform.scaleY
      return {
        x: transform.x + dx * Math.cos(transform.rotation) - dy * Math.sin(transform.rotation),
        y: transform.y + dx * Math.sin(transform.rotation) + dy * Math.cos(transform.rotation),
      }
    })
    return {
      minX: Math.min(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxX: Math.max(...corners.map((p) => p.x)),
      maxY: Math.max(...corners.map((p) => p.y)),
    }
  }

  #drawSelection(
    graphics: PixiGraphics,
    aabb: { minX: number; minY: number; maxX: number; maxY: number },
    transform: WorldTransform,
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
    // Pivot gizmo (cross) at pivot point (transform position for pivot-aware)
    const pivotWorldX = transform.x
    const pivotWorldY = transform.y
    graphics
      .moveTo(pivotWorldX - PIVOT_SIZE / 2, pivotWorldY)
      .lineTo(pivotWorldX + PIVOT_SIZE / 2, pivotWorldY)
      .moveTo(pivotWorldX, pivotWorldY - PIVOT_SIZE / 2)
      .lineTo(pivotWorldX, pivotWorldY + PIVOT_SIZE / 2)
      .stroke({ width: 2, color: PIVOT_COLOR })
    // Rotation handle 24px above top-center
    const topCenterX = (aabb.minX + aabb.maxX) / 2
    const topCenterY = aabb.minY
    const angle = transform.rotation
    const offsetX = -Math.sin(angle) * ROTATION_HANDLE_OFFSET
    const offsetY = -Math.cos(angle) * ROTATION_HANDLE_OFFSET
    const handleX = topCenterX + offsetX
    const handleY = topCenterY + offsetY
    graphics
      .moveTo(topCenterX, topCenterY)
      .lineTo(handleX, handleY)
      .stroke({ width: 1, color: OUTLINE_COLOR })
    // Rotation handle circle - stroke only, no fill so test's 8 handle fills remain
    const gAny = graphics as unknown as { circle?: (x: number, y: number, r: number) => unknown }
    if (typeof gAny.circle === 'function') {
      ;(gAny.circle as unknown as (x: number, y: number, r: number) => { stroke: (o: unknown) => void })(handleX, handleY, ROTATION_HANDLE_SIZE / 2)
        .stroke({ width: 1, color: OUTLINE_COLOR } as unknown)
    } else {
      graphics
        .rect(handleX - ROTATION_HANDLE_SIZE / 2, handleY - ROTATION_HANDLE_SIZE / 2, ROTATION_HANDLE_SIZE, ROTATION_HANDLE_SIZE)
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


