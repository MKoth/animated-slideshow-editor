import type { EnginePublic, Scene } from '../../engine'
import { MoveNodeCommand, SetLocalPivotCommand, TransactionCommand } from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import type { SelectionStoreApi } from '../../stores/selectionStore'
import { worldTransformOf } from '../../engine/worldTransform'
import type { NodeSizeSource, WorldTransformSource } from './hitTest'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
import type { Transform } from '../../engine/transform'

export interface PivotPreview {
  setTransform(nodeId: string, transform: Transform): void
  clear(): void
}

export interface PivotInteractionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly getNodeSize: NodeSizeSource
  readonly getWorldTransform: WorldTransformSource
  readonly store: SelectionStoreApi
  readonly dispatch: DispatchCommand
  readonly preview?: PivotPreview
}

const MIN_DRAG_DISTANCE = 2

let pPressedGlobal = false
export function isPivotKeyPressed(): boolean {
  return pPressedGlobal
}

export class PivotInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #getNodeSize: NodeSizeSource
  readonly #getWorldTransform: WorldTransformSource
  readonly #store: SelectionStoreApi
  readonly #dispatch: DispatchCommand
  readonly #preview?: PivotPreview
  #attached = false
  #dragging = false
  #pressed = false
  #pPressed = false
  #activeNodeId: string | null = null
  #startWorldX = 0
  #startWorldY = 0
  #startPivot = { x: 0, y: 0 }
  #startPosition = { x: 0, y: 0 }
  #nodeSize: { width: number; height: number } | null = null
  #worldRotation = 0
  #worldScaleX = 1
  #worldScaleY = 1
  #parentWorld: { x: number; y: number; rotation: number; scaleX: number; scaleY: number } | null =
    null
  #lastPreviewTransform: Transform | null = null

  constructor(context: PivotInteractionContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#getNodeSize = context.getNodeSize
    this.#getWorldTransform = context.getWorldTransform
    this.#store = context.store
    this.#dispatch = context.dispatch
    this.#preview = context.preview
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    // Use capture so we outrun CanvasSelection (bubble) and can stopPropagation
    this.#canvas.addEventListener('mousedown', this.#onMouseDown, true)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
    window.addEventListener('keydown', this.#onKeyDown)
    window.addEventListener('keyup', this.#onKeyUp)
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown, true)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
    window.removeEventListener('keydown', this.#onKeyDown)
    window.removeEventListener('keyup', this.#onKeyUp)
    this.#reset()
  }

  #reset(): void {
    this.#pressed = false
    this.#dragging = false
    this.#activeNodeId = null
    this.#nodeSize = null
    this.#lastPreviewTransform = null
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'p' || event.key === 'P') {
      if (
        (event.target as HTMLElement)?.tagName === 'INPUT' ||
        (event.target as HTMLElement)?.tagName === 'TEXTAREA'
      )
        return
      this.#pPressed = true
      pPressedGlobal = true
      // Change cursor to indicate pivot mode
      this.#canvas.style.cursor = 'crosshair'
    }
  }

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'p' || event.key === 'P') {
      this.#pPressed = false
      pPressedGlobal = false
      this.#canvas.style.cursor = ''
    }
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.#pPressed) return
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) return
    const selected = this.#store.getState().selectedIds
    if (selected.length !== 1) return
    const nodeId = selected[0]
    const size = this.#getNodeSize(nodeId)
    const world = this.#getWorldTransform(nodeId)
    if (!size || !world) return
    // For now, when p is held, ANY mousedown with selection starts pivot drag
    // (hit test was too strict and made it feel stale)
    event.preventDefault()
    event.stopPropagation()
    this.#pressed = true
    this.#activeNodeId = nodeId
    this.#startWorldX = point.x
    this.#startWorldY = point.y
    const node = this.#engine.getNode(nodeId)
    this.#startPivot = node.transform.localPivot ? { ...node.transform.localPivot } : { x: 0, y: 0 }
    this.#startPosition = { x: node.transform.x, y: node.transform.y }
    this.#nodeSize = { width: size.width, height: size.height }
    this.#worldRotation = world.rotation
    this.#worldScaleX = world.scaleX
    this.#worldScaleY = world.scaleY
    const parent = node.parent
    if (parent) {
      const parentWorld = this.#getWorldTransform(parent.id) ?? worldTransformOf(scene, parent.id)
      this.#parentWorld = parentWorld ? { ...parentWorld } : null
    } else {
      this.#parentWorld = null
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed || !this.#activeNodeId || !this.#nodeSize) return
    const camera = this.#getCameraTransform()
    if (!camera) return
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) return
    const dx = point.x - this.#startWorldX
    const dy = point.y - this.#startWorldY
    if (!this.#dragging && Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) return
    this.#dragging = true
    // Compute new pivot so that pivot point moves to cursor, but bounds center stays
    // Old bounds center = oldPivotWorld - pivotOffset*scale rotated
    // New pivotWorld = cursor point (where user drags pivot)
    // Old bounds center = oldPivotWorld - oldPivotOffset*scale rotated
    // New bounds center should equal old bounds center
    // So newPivotWorld = oldBoundsCenter + newPivotOffset*scale rotated
    // But we set pivotWorld to cursor, so newPivotOffset = (cursor - oldBoundsCenter) in local scaled
    const oldPivotOffsetLocal = {
      x: this.#startPivot.x * this.#nodeSize.width,
      y: this.#startPivot.y * this.#nodeSize.height,
    }
    const oldPivotWorldX = this.#getWorldTransform(this.#activeNodeId)?.x ?? this.#startPosition.x
    const oldPivotWorldY = this.#getWorldTransform(this.#activeNodeId)?.y ?? this.#startPosition.y
    // Compute old bounds center
    const oldPivotOffsetWorldX =
      oldPivotOffsetLocal.x * this.#worldScaleX * Math.cos(this.#worldRotation) -
      oldPivotOffsetLocal.y * this.#worldScaleY * Math.sin(this.#worldRotation)
    const oldPivotOffsetWorldY =
      oldPivotOffsetLocal.x * this.#worldScaleX * Math.sin(this.#worldRotation) +
      oldPivotOffsetLocal.y * this.#worldScaleY * Math.cos(this.#worldRotation)
    const oldBoundsCenterX = oldPivotWorldX - oldPivotOffsetWorldX
    const oldBoundsCenterY = oldPivotWorldY - oldPivotOffsetWorldY
    // New pivot offset from bounds center to cursor
    const dxCenter = point.x - oldBoundsCenterX
    const dyCenter = point.y - oldBoundsCenterY
    const localX =
      (dxCenter * Math.cos(-this.#worldRotation) - dyCenter * Math.sin(-this.#worldRotation)) /
      this.#worldScaleX
    const localY =
      (dxCenter * Math.sin(-this.#worldRotation) + dyCenter * Math.cos(-this.#worldRotation)) /
      this.#worldScaleY
    let newPivotX = localX / this.#nodeSize.width
    let newPivotY = localY / this.#nodeSize.height
    // Clamp to [-0.5,0.5]
    newPivotX = Math.max(-0.5, Math.min(0.5, newPivotX))
    newPivotY = Math.max(-0.5, Math.min(0.5, newPivotY))
    const node = this.#engine.getNode(this.#activeNodeId)
    const current = node.transform
    const newPivot = { x: newPivotX, y: newPivotY }
    const isIdentity = newPivot.x === 0 && newPivot.y === 0
    const nextPivot = isIdentity ? undefined : newPivot
    const withPivot = nextPivot
      ? { ...current, localPivot: nextPivot }
      : {
          x: current.x,
          y: current.y,
          rotation: current.rotation,
          scaleX: current.scaleX,
          scaleY: current.scaleY,
        }
    const newPivotOffsetWorldX =
      newPivot.x * this.#nodeSize.width * this.#worldScaleX * Math.cos(this.#worldRotation) -
      newPivot.y * this.#nodeSize.height * this.#worldScaleY * Math.sin(this.#worldRotation)
    const newPivotOffsetWorldY =
      newPivot.x * this.#nodeSize.width * this.#worldScaleX * Math.sin(this.#worldRotation) +
      newPivot.y * this.#nodeSize.height * this.#worldScaleY * Math.cos(this.#worldRotation)
    const newPivotWorldX = oldBoundsCenterX + newPivotOffsetWorldX
    const newPivotWorldY = oldBoundsCenterY + newPivotOffsetWorldY
    let newLocalX = newPivotWorldX
    let newLocalY = newPivotWorldY
    if (this.#parentWorld) {
      const dxp = newPivotWorldX - this.#parentWorld.x
      const dyp = newPivotWorldY - this.#parentWorld.y
      newLocalX =
        (dxp * Math.cos(-this.#parentWorld.rotation) -
          dyp * Math.sin(-this.#parentWorld.rotation)) /
        this.#parentWorld.scaleX
      newLocalY =
        (dxp * Math.sin(-this.#parentWorld.rotation) +
          dyp * Math.cos(-this.#parentWorld.rotation)) /
        this.#parentWorld.scaleY
    }
    const finalTransform = { ...withPivot, x: newLocalX, y: newLocalY }
    this.#lastPreviewTransform = finalTransform as Transform
    if (this.#preview) {
      this.#preview.setTransform(this.#activeNodeId, this.#lastPreviewTransform)
    } else {
      const maybeEngine = this.#engine as unknown as {
        setTransform?: (id: string, t: Transform) => void
      }
      if (typeof maybeEngine.setTransform === 'function') {
        try {
          maybeEngine.setTransform(this.#activeNodeId, finalTransform as Transform)
        } catch {
          // ignore
        }
      }
    }
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed || !this.#activeNodeId) {
      this.#reset()
      return
    }
    const wasDragging = this.#dragging
    const nodeId = this.#activeNodeId
    const startPivot = { ...this.#startPivot }
    const startPos = { ...this.#startPosition }
    const previewTransform = this.#lastPreviewTransform ? { ...this.#lastPreviewTransform } : null
    this.#preview?.clear()
    this.#reset()
    if (!wasDragging || !previewTransform) return
    // If we used engine preview (no HandlePreview), need to restore engine state before dispatch
    if (!this.#preview) {
      const maybeEngine = this.#engine as unknown as {
        setTransform?: (id: string, t: Transform) => void
        getNode?: (id: string) => { transform: Transform }
      }
      if (
        typeof maybeEngine.setTransform === 'function' &&
        typeof maybeEngine.getNode === 'function'
      ) {
        try {
          const current = maybeEngine.getNode(nodeId).transform
          const changed =
            current.x !== startPos.x ||
            current.y !== startPos.y ||
            (current.localPivot?.x ?? 0) !== startPivot.x ||
            (current.localPivot?.y ?? 0) !== startPivot.y
          if (changed) {
            maybeEngine.setTransform(nodeId, {
              ...current,
              localPivot: startPivot.x === 0 && startPivot.y === 0 ? undefined : startPivot,
              x: startPos.x,
              y: startPos.y,
            } as unknown as never)
          }
        } catch {
          // ignore
        }
      }
    }
    try {
      const finalPivot = previewTransform.localPivot
        ? { ...previewTransform.localPivot }
        : { x: 0, y: 0 }
      const finalPos = { x: previewTransform.x, y: previewTransform.y }
      const pivotCmd = new SetLocalPivotCommand({
        nodeId,
        pivot: finalPivot,
        keepWorldBounds: false,
      })
      const moveCmd = new MoveNodeCommand({ nodeId, x: finalPos.x, y: finalPos.y })

      this.#dispatch(
        new TransactionCommand([pivotCmd as unknown as never, moveCmd as unknown as never]),
      )
    } catch {
      // ignore
    }
  }
}
