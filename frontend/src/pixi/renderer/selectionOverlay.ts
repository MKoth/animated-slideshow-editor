import type { EnginePublic } from '../../engine'
import type { Scene } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { worldTransformOf as storedWorldTransformOf } from '../../engine/worldTransform'
import type { SelectionStoreApi } from '../../stores/selectionStore'
import type { NodeSizeSource } from './hitTest'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { ViewportTransform, WorldTransform } from './worldGeometry'

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
  readonly getCameraTransform?: () => ViewportTransform | null
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
  readonly #getCameraTransform?: () => ViewportTransform | null
  readonly #subscribeTime?: (listener: () => void) => Unsubscribe
  #graphics: PixiGraphics | null = null
  #unsubscribeStore: Unsubscribe | null = null
  #unsubscribeEngine: Unsubscribe | null = null
  #unsubscribeTime: Unsubscribe | null = null
  #attached = false
  #lastCameraScale: number | null = null

  constructor(context: SelectionOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getNodeSize = context.getNodeSize
    this.#store = context.store
    this.#getWorldTransform = context.getWorldTransform
    this.#getCameraTransform = context.getCameraTransform
    this.#subscribeTime = context.subscribeTime
  }

  #cameraScale(): number {
    const cam = this.#getCameraTransform?.()
    if (!cam) return 1
    return Math.max(Math.abs(cam.scaleX), Math.abs(cam.scaleY), 0.1)
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
    this.#lastCameraScale = null
    this.#graphics?.destroy()
    this.#graphics = null
  }

  bringToFront(): void {
    const graphics = this.#graphics
    if (graphics) {
      this.#world.addChild(graphics)
    }
  }

  handleTick(): void {
    if (!this.#attached) return
    const scale = this.#cameraScale()
    if (this.#lastCameraScale === null || Math.abs(scale - this.#lastCameraScale) > 1e-6) {
      this.redraw()
    }
  }

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    this.#lastCameraScale = this.#cameraScale()
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    for (const nodeId of this.#store.getState().selectedIds) {
      const size = this.#getNodeSize(nodeId)
      if (!size) {
        continue
      }
      const node = scene.getNode(nodeId)
      if (node?.components.tableRow) {
        continue
      }
      const transform = this.#getWorldTransform
        ? this.#getWorldTransform(nodeId)
        : storedWorldTransformOf(scene, nodeId)
      if (!transform) {
        continue
      }
      const pivot = node?.transform.localPivot ?? null
      const corners = this.#orientedCorners(size, transform, pivot)
      if (!corners) {
        continue
      }
      this.#drawSelection(graphics, corners, transform)
    }
  }

  #orientedCorners(
    size: { width: number; height: number; offsetX?: number; offsetY?: number },
    transform: WorldTransform,
    pivot: { x: number; y: number } | null,
  ): { x: number; y: number }[] | null {
    if (
      transform.scaleX === 0 ||
      transform.scaleY === 0 ||
      !Number.isFinite(transform.scaleX) ||
      !Number.isFinite(transform.scaleY)
    ) {
      return null
    }
    const halfW = size.width / 2
    const halfH = size.height / 2
    const pivotOffset = pivot
      ? { x: pivot.x * size.width, y: pivot.y * size.height }
      : { x: 0, y: 0 }
    const offsetX = size.offsetX ?? 0
    const offsetY = size.offsetY ?? 0
    const cornersLocal = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ]
    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    return cornersLocal.map((corner) => {
      const dx = (corner.x - pivotOffset.x + offsetX) * transform.scaleX
      const dy = (corner.y - pivotOffset.y + offsetY) * transform.scaleY
      return {
        x: transform.x + dx * cos - dy * sin,
        y: transform.y + dx * sin + dy * cos,
      }
    })
  }

  #drawSelection(
    graphics: PixiGraphics,
    corners: { x: number; y: number }[],
    transform: WorldTransform,
  ): void {
    // All sizes are screen-space pixels: divide world units by camera zoom
    // so the outline stays 2px and handles stay 8px at any zoom.
    const scale = this.#cameraScale()
    const outlineWidth = OUTLINE_WIDTH / scale
    const handleSize = HANDLE_SIZE / scale
    const handleStroke = 1 / scale
    const pivotSize = PIVOT_SIZE / scale
    const pivotWidth = 2 / scale
    const rotationOffset = ROTATION_HANDLE_OFFSET / scale
    const rotationSize = ROTATION_HANDLE_SIZE / scale
    const thinStroke = 1 / scale
    // Oriented outline — polygon through 4 corners
    if (corners.length === 4) {
      graphics
        .moveTo(corners[0].x, corners[0].y)
        .lineTo(corners[1].x, corners[1].y)
        .lineTo(corners[2].x, corners[2].y)
        .lineTo(corners[3].x, corners[3].y)
        .closePath()
        .stroke({ width: outlineWidth, color: OUTLINE_COLOR })
    }
    for (const point of handlePositions(corners)) {
      graphics
        .rect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize)
        .fill({ color: HANDLE_FILL, alpha: HANDLE_FILL_ALPHA })
        .stroke({ width: handleStroke, color: OUTLINE_COLOR })
    }
    // Pivot gizmo (cross) at pivot point (transform position for pivot-aware)
    const pivotWorldX = transform.x
    const pivotWorldY = transform.y
    graphics
      .moveTo(pivotWorldX - pivotSize / 2, pivotWorldY)
      .lineTo(pivotWorldX + pivotSize / 2, pivotWorldY)
      .moveTo(pivotWorldX, pivotWorldY - pivotSize / 2)
      .lineTo(pivotWorldX, pivotWorldY + pivotSize / 2)
      .stroke({ width: pivotWidth, color: PIVOT_COLOR })
    // Rotation handle 24px above top-center (oriented top edge center)
    const topCenterX = (corners[0].x + corners[1].x) / 2
    const topCenterY = (corners[0].y + corners[1].y) / 2
    const angle = transform.rotation
    const offsetX = -Math.sin(angle) * rotationOffset
    const offsetY = -Math.cos(angle) * rotationOffset
    const handleX = topCenterX + offsetX
    const handleY = topCenterY + offsetY
    graphics
      .moveTo(topCenterX, topCenterY)
      .lineTo(handleX, handleY)
      .stroke({ width: thinStroke, color: OUTLINE_COLOR })
    // Rotation handle circle - stroke only, no fill so test's 8 handle fills remain
    const gAny = graphics as unknown as { circle?: (x: number, y: number, r: number) => unknown }
    if (typeof gAny.circle === 'function') {
      ;(
        gAny.circle as unknown as (
          x: number,
          y: number,
          r: number,
        ) => { stroke: (o: unknown) => void }
      )(handleX, handleY, rotationSize / 2).stroke({
        width: thinStroke,
        color: OUTLINE_COLOR,
      } as unknown)
    } else {
      graphics
        .rect(handleX - rotationSize / 2, handleY - rotationSize / 2, rotationSize, rotationSize)
        .stroke({ width: thinStroke, color: OUTLINE_COLOR })
    }
  }
}

function handlePositions(corners: { x: number; y: number }[]): { x: number; y: number }[] {
  if (corners.length !== 4) {
    return []
  }
  const [tl, tr, br, bl] = corners
  const topMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 }
  const rightMid = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 }
  const bottomMid = { x: (br.x + bl.x) / 2, y: (br.y + bl.y) / 2 }
  const leftMid = { x: (bl.x + tl.x) / 2, y: (bl.y + tl.y) / 2 }
  return [tl, topMid, tr, leftMid, rightMid, bl, bottomMid, br]
}

export function orientedCornersForSelection(
  size: { width: number; height: number; offsetX?: number; offsetY?: number },
  transform: WorldTransform,
  pivot: { x: number; y: number } | null,
): { x: number; y: number }[] | null {
  if (
    transform.scaleX === 0 ||
    transform.scaleY === 0 ||
    !Number.isFinite(transform.scaleX) ||
    !Number.isFinite(transform.scaleY)
  ) {
    return null
  }
  const halfW = size.width / 2
  const halfH = size.height / 2
  const pivotOffset = pivot ? { x: pivot.x * size.width, y: pivot.y * size.height } : { x: 0, y: 0 }
  const offsetX = size.offsetX ?? 0
  const offsetY = size.offsetY ?? 0
  const cornersLocal = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ]
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  return cornersLocal.map((corner) => {
    const dx = (corner.x - pivotOffset.x + offsetX) * transform.scaleX
    const dy = (corner.y - pivotOffset.y + offsetY) * transform.scaleY
    return {
      x: transform.x + dx * cos - dy * sin,
      y: transform.y + dx * sin + dy * cos,
    }
  })
}

export function handlePositionsForSelection(
  corners: { x: number; y: number }[],
): { x: number; y: number }[] {
  return handlePositions(corners)
}

export function rotationHandleForSelection(
  corners: { x: number; y: number }[],
  rotation: number,
  cameraScale = 1,
): { x: number; y: number; topCenter: { x: number; y: number } } | null {
  if (corners.length !== 4) return null
  const topCenter = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
  const safeScale = Number.isFinite(cameraScale) && cameraScale > 0 ? cameraScale : 1
  const offset = ROTATION_HANDLE_OFFSET / safeScale
  const offsetX = -Math.sin(rotation) * offset
  const offsetY = -Math.cos(rotation) * offset
  return { x: topCenter.x + offsetX, y: topCenter.y + offsetY, topCenter }
}
