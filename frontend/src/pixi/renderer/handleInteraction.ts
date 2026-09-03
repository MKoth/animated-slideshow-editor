import type { EnginePublic, Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  MoveNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  TransactionCommand,
} from '../../engine/commands'
import { relativeTransform, worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransform } from '../../engine/worldTransform'
import type { SelectionStoreApi } from '../../stores/selectionStore'
import {
  handlePositionsForSelection,
  orientedCornersForSelection,
  rotationHandleForSelection,
} from './selectionOverlay'
import type { NodeSizeSource, WorldTransformSource } from './hitTest'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform, WorldPoint } from './worldGeometry'
import { isPivotKeyPressed } from './pivotInteraction'
import { useBoneEditStore } from '../../stores/boneEditStore'
import { useEditingModeStore } from '../../stores/editingModeStore'
import type { Transform } from '../../engine/transform'
import { isGroupNode } from '../../engine/sceneNode'

export interface HandlePreview {
  setTransform(nodeId: string, transform: Transform): void
  clear(): void
}

export interface HandleInteractionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly getNodeSize: NodeSizeSource
  readonly getWorldTransform: WorldTransformSource
  readonly store: SelectionStoreApi
  readonly dispatch: DispatchCommand
  readonly preview?: HandlePreview
}

type HandleKind = 'tl' | 't' | 'tr' | 'l' | 'r' | 'bl' | 'b' | 'br' | 'rotation'

const HANDLE_HIT_RADIUS = 10
const MIN_SCALE = 0.05

interface HandleHit {
  kind: HandleKind
  world: WorldPoint
}

export class HandleInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #getNodeSize: NodeSizeSource
  readonly #getWorldTransform: WorldTransformSource
  readonly #store: SelectionStoreApi
  readonly #dispatch: DispatchCommand
  readonly #preview?: HandlePreview
  #attached = false
  #dragging = false
  #activeHandle: HandleKind | null = null
  #nodeId: string | null = null
  #size: { width: number; height: number; offsetX?: number; offsetY?: number } | null = null
  #pivot: { x: number; y: number } | null = null
  #initialLocal: Transform | null = null
  #initialWorld: WorldTransform | null = null
  #parentWorld: WorldTransform | null = null
  #centerWorld: WorldPoint | null = null
  #anchorOppositeWorld: WorldPoint | null = null
  #anchorCenterWorld: WorldPoint | null = null
  #anchorLocal: { x: number; y: number } | null = null
  #handleLocal: { x: number; y: number } | null = null
  #startMouseWorld: WorldPoint | null = null
  #lastPreviewTransform: Transform | null = null
  #startAngle = 0

  constructor(context: HandleInteractionContext) {
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
    this.#canvas.addEventListener('mousedown', this.#onMouseDown, true)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown, true)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
    this.#reset()
  }

  #reset(): void {
    this.#dragging = false
    this.#activeHandle = null
    this.#nodeId = null
    this.#size = null
    this.#pivot = null
    this.#initialLocal = null
    this.#initialWorld = null
    this.#parentWorld = null
    this.#centerWorld = null
    this.#anchorOppositeWorld = null
    this.#anchorCenterWorld = null
    this.#anchorLocal = null
    this.#handleLocal = null
    this.#startMouseWorld = null
    this.#lastPreviewTransform = null
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || isPivotKeyPressed()) return
    const { mode } = useEditingModeStore.getState()
    const { isEditing: boneEditing } = useBoneEditStore.getState()
    if (
      mode === 'boneCreation' ||
      mode === 'ikTarget' ||
      mode === 'poleVector' ||
      mode === 'meshEdit' ||
      mode === 'weightPaint' ||
      boneEditing
    ) {
      return
    }
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const selected = this.#store.getState().selectedIds
    if (selected.length !== 1) return
    const nodeId = selected[0]
    const sceneNode = scene.getNode(nodeId)
    if (sceneNode?.components.tableRow) return
    const size = this.#getNodeSize(nodeId)
    const world = this.#getWorldTransform(nodeId)
    if (!size || !world) return
    const node = this.#engine.getNode(nodeId)
    const pivot = node.transform.localPivot ?? null
    const corners = orientedCornersForSelection(size, world, pivot)
    if (!corners) return
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) return
    const handles = handlePositionsForSelection(corners)
    const rotationHandle = rotationHandleForSelection(corners, world.rotation)
    const hits: HandleHit[] = []
    const handleKinds: HandleKind[] = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']
    for (let i = 0; i < handles.length; i++) {
      hits.push({ kind: handleKinds[i], world: handles[i] })
    }
    if (rotationHandle) {
      hits.push({ kind: 'rotation', world: { x: rotationHandle.x, y: rotationHandle.y } })
    }
    let best: HandleHit | null = null
    let bestDist = Infinity
    const cameraScale = camera.scaleX || 1
    const hitRadiusWorld = HANDLE_HIT_RADIUS / cameraScale
    for (const hit of hits) {
      const dist = Math.hypot(point.x - hit.world.x, point.y - hit.world.y)
      if (dist <= hitRadiusWorld && dist < bestDist) {
        bestDist = dist
        best = hit
      }
    }
    if (!best) return

    event.preventDefault()
    event.stopPropagation()
    this.#activeHandle = best.kind
    this.#nodeId = nodeId
    this.#size = { ...size }
    this.#pivot = pivot ? { ...pivot } : null
    this.#initialLocal = { ...node.transform }
    this.#initialWorld = { ...world }
    const parent = node.parent
    if (parent) {
      const pw = this.#getWorldTransform(parent.id) ?? worldTransformOf(scene, parent.id)
      this.#parentWorld = pw ? { ...pw } : null
    } else {
      this.#parentWorld = null
    }
    const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4
    const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
    this.#centerWorld = { x: cx, y: cy }
    this.#anchorCenterWorld = { ...this.#centerWorld }
    if (best.kind !== 'rotation') {
      const oppositeMap: Record<string, number> = {
        tl: 7,
        t: 6,
        tr: 5,
        l: 4,
        r: 3,
        bl: 2,
        b: 1,
        br: 0,
      }
      const oppIdx = oppositeMap[best.kind]
      this.#anchorOppositeWorld = { ...handles[oppIdx] }
      const halfW = size.width / 2
      const halfH = size.height / 2
      const handleLocals: Record<string, { x: number; y: number }> = {
        tl: { x: -halfW, y: -halfH },
        t: { x: 0, y: -halfH },
        tr: { x: halfW, y: -halfH },
        l: { x: -halfW, y: 0 },
        r: { x: halfW, y: 0 },
        bl: { x: -halfW, y: halfH },
        b: { x: 0, y: halfH },
        br: { x: halfW, y: halfH },
      }
      const anchorLocals: Record<string, { x: number; y: number }> = {
        tl: { x: halfW, y: halfH },
        t: { x: 0, y: halfH },
        tr: { x: -halfW, y: halfH },
        l: { x: halfW, y: 0 },
        r: { x: -halfW, y: 0 },
        bl: { x: halfW, y: -halfH },
        b: { x: 0, y: -halfH },
        br: { x: -halfW, y: -halfH },
      }
      this.#handleLocal = handleLocals[best.kind]
      this.#anchorLocal = anchorLocals[best.kind]
    } else {
      this.#startMouseWorld = { ...point }
      this.#startAngle = Math.atan2(point.y - world.y, point.x - world.x)
    }
    this.#dragging = false
    this.#startMouseWorld = { ...point }
    this.#updateCursor(best.kind)
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (
      !this.#activeHandle ||
      !this.#nodeId ||
      !this.#size ||
      !this.#initialWorld ||
      !this.#initialLocal
    )
      return
    const camera = this.#getCameraTransform()
    if (!camera) return
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) return
    if (!this.#dragging) {
      if (!this.#startMouseWorld) return
      const dx = point.x - this.#startMouseWorld.x
      const dy = point.y - this.#startMouseWorld.y
      if (Math.hypot(dx, dy) < 2) return
      this.#dragging = true
    }
    if (this.#activeHandle === 'rotation') {
      this.#handleRotation(point)
    } else {
      this.#handleScale(point, event)
    }
  }

  #handleRotation(point: WorldPoint): void {
    if (!this.#nodeId || !this.#initialWorld || !this.#initialLocal) return
    const pivotWorld = { x: this.#initialWorld.x, y: this.#initialWorld.y }
    const currentAngle = Math.atan2(point.y - pivotWorld.y, point.x - pivotWorld.x)
    const delta = currentAngle - this.#startAngle
    const newWorldRotation = this.#initialWorld.rotation + delta
    const newWorld: WorldTransform = {
      x: pivotWorld.x,
      y: pivotWorld.y,
      rotation: newWorldRotation,
      scaleX: this.#initialWorld.scaleX,
      scaleY: this.#initialWorld.scaleY,
    }
    const local = this.#worldToLocal(newWorld)
    if (!local) return
    const next: Transform = {
      ...this.#initialLocal,
      x: local.x,
      y: local.y,
      rotation: local.rotation,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
    }
    this.#lastPreviewTransform = next
    this.#applyPreview(next)
  }

  #handleScale(point: WorldPoint, event: MouseEvent): void {
    if (
      !this.#nodeId ||
      !this.#size ||
      !this.#initialWorld ||
      !this.#initialLocal ||
      !this.#anchorLocal ||
      !this.#handleLocal ||
      !this.#centerWorld ||
      !this.#anchorOppositeWorld ||
      !this.#anchorCenterWorld
    )
      return
    const size = this.#size
    const pivot = this.#pivot
    const pivotOffset = pivot
      ? { x: pivot.x * size.width, y: pivot.y * size.height }
      : { x: 0, y: 0 }
    const offsetX = size.offsetX ?? 0
    const offsetY = size.offsetY ?? 0
    const isAlt = event.altKey
    const isShift = event.shiftKey
    const handleKind = this.#activeHandle!
    const isCorner = ['tl', 'tr', 'bl', 'br'].includes(handleKind)
    const scene = this.#getScene()
    const node = scene?.getNode(this.#nodeId)
    const isUniform = isCorner || isShift || (node ? isGroupNode(node) : false)

    const anchorWorld = isAlt ? this.#anchorCenterWorld : this.#anchorOppositeWorld
    const anchorLocal = isAlt ? { x: 0, y: 0 } : this.#anchorLocal
    const deltaLocalUnscaled = {
      x: this.#handleLocal.x - anchorLocal.x,
      y: this.#handleLocal.y - anchorLocal.y,
    }

    const worldRotation = this.#initialWorld.rotation
    const cos = Math.cos(-worldRotation)
    const sin = Math.sin(-worldRotation)
    const dxWorld = point.x - anchorWorld.x
    const dyWorld = point.y - anchorWorld.y
    const mx = dxWorld * cos - dyWorld * sin
    const my = dxWorld * sin + dyWorld * cos

    let newWorldScaleX = this.#initialWorld.scaleX
    let newWorldScaleY = this.#initialWorld.scaleY

    if (isUniform) {
      if (isCorner) {
        const initialDeltaScaledX = deltaLocalUnscaled.x * this.#initialWorld.scaleX
        const initialDeltaScaledY = deltaLocalUnscaled.y * this.#initialWorld.scaleY
        const initialDist = Math.hypot(initialDeltaScaledX, initialDeltaScaledY)
        const mouseDist = Math.hypot(mx, my)
        if (initialDist < 1e-6) return
        const dot = mx * initialDeltaScaledX + my * initialDeltaScaledY
        const sign = dot >= 0 ? 1 : -1
        const factor = (mouseDist / initialDist) * sign
        const absFactor = Math.max(
          MIN_SCALE / Math.max(this.#initialWorld.scaleX, this.#initialWorld.scaleY),
          Math.abs(factor),
        )
        newWorldScaleX = this.#initialWorld.scaleX * absFactor
        newWorldScaleY = this.#initialWorld.scaleY * absFactor
        if (factor < 0) {
          // keep positive
        }
      } else {
        let factor = 1
        if (Math.abs(deltaLocalUnscaled.x) > 1e-6) {
          const newWSX = mx / deltaLocalUnscaled.x
          factor = newWSX / this.#initialWorld.scaleX
        } else if (Math.abs(deltaLocalUnscaled.y) > 1e-6) {
          const newWSY = my / deltaLocalUnscaled.y
          factor = newWSY / this.#initialWorld.scaleY
        }
        const absFactor = Math.max(0.01, Math.abs(factor))
        newWorldScaleX = this.#initialWorld.scaleX * absFactor
        newWorldScaleY = this.#initialWorld.scaleY * absFactor
      }
    } else {
      if (Math.abs(deltaLocalUnscaled.x) > 1e-6) {
        const newWSX = mx / deltaLocalUnscaled.x
        newWorldScaleX = Math.max(MIN_SCALE, Math.abs(newWSX)) * Math.sign(newWSX || 1)
        if (newWorldScaleX < 0) newWorldScaleX = Math.abs(newWorldScaleX)
      } else {
        newWorldScaleX = this.#initialWorld.scaleX
      }
      if (Math.abs(deltaLocalUnscaled.y) > 1e-6) {
        const newWSY = my / deltaLocalUnscaled.y
        newWorldScaleY = Math.max(MIN_SCALE, Math.abs(newWSY)) * Math.sign(newWSY || 1)
        if (newWorldScaleY < 0) newWorldScaleY = Math.abs(newWorldScaleY)
      } else {
        newWorldScaleY = this.#initialWorld.scaleY
      }
      newWorldScaleX = Math.max(MIN_SCALE, newWorldScaleX)
      newWorldScaleY = Math.max(MIN_SCALE, newWorldScaleY)
    }

    newWorldScaleX = Math.max(MIN_SCALE, newWorldScaleX)
    newWorldScaleY = Math.max(MIN_SCALE, newWorldScaleY)

    const anchorLocalForPivot = anchorLocal
    const dx = (anchorLocalForPivot.x - pivotOffset.x + offsetX) * newWorldScaleX
    const dy = (anchorLocalForPivot.y - pivotOffset.y + offsetY) * newWorldScaleY
    const cosR = Math.cos(worldRotation)
    const sinR = Math.sin(worldRotation)
    const anchorOffsetWorldX = dx * cosR - dy * sinR
    const anchorOffsetWorldY = dx * sinR + dy * cosR
    const newPivotWorldX = anchorWorld.x - anchorOffsetWorldX
    const newPivotWorldY = anchorWorld.y - anchorOffsetWorldY

    const newWorld: WorldTransform = {
      x: newPivotWorldX,
      y: newPivotWorldY,
      rotation: worldRotation,
      scaleX: newWorldScaleX,
      scaleY: newWorldScaleY,
    }
    const local = this.#worldToLocal(newWorld)
    if (!local) return
    const next: Transform = {
      ...this.#initialLocal,
      x: local.x,
      y: local.y,
      rotation: local.rotation,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
    }
    this.#lastPreviewTransform = next
    this.#applyPreview(next)
  }

  #applyPreview(transform: Transform): void {
    if (!this.#nodeId) return
    if (this.#preview) {
      this.#preview.setTransform(this.#nodeId, transform)
      return
    }
    // Fallback for tests / environments without preview (uses raw engine if available)
    const maybeEngine = this.#engine as unknown as {
      setTransform?: (id: string, t: Transform) => void
    }
    if (typeof maybeEngine.setTransform === 'function') {
      try {
        maybeEngine.setTransform(this.#nodeId, transform)
      } catch {
        // ignore
      }
    }
  }

  #worldToLocal(
    world: WorldTransform,
  ): { x: number; y: number; rotation: number; scaleX: number; scaleY: number } | null {
    if (!this.#parentWorld) {
      return {
        x: world.x,
        y: world.y,
        rotation: world.rotation,
        scaleX: world.scaleX,
        scaleY: world.scaleY,
      }
    }
    const relative = relativeTransform(world, this.#parentWorld)
    if (!relative) return null
    return {
      x: relative.x,
      y: relative.y,
      rotation: relative.rotation,
      scaleX: relative.scaleX,
      scaleY: relative.scaleY,
    }
  }

  readonly #onMouseUp = (): void => {
    if (!this.#activeHandle || !this.#nodeId || !this.#initialLocal) {
      this.#preview?.clear()
      this.#reset()
      this.#canvas.style.cursor = ''
      return
    }
    const wasDragging = this.#dragging
    const nodeId = this.#nodeId
    const initial = { ...this.#initialLocal }
    const previewTransform = this.#lastPreviewTransform ? { ...this.#lastPreviewTransform } : null
    this.#preview?.clear()
    this.#reset()
    this.#canvas.style.cursor = ''
    if (!wasDragging || !previewTransform) return
    // If we used engine preview (no HandlePreview), need to restore engine state before dispatch
    const maybeEngine = this.#engine as unknown as {
      setTransform?: (id: string, t: Transform) => void
      getNode?: (id: string) => { transform: Transform }
    }
    if (
      !this.#preview &&
      typeof maybeEngine.setTransform === 'function' &&
      typeof maybeEngine.getNode === 'function'
    ) {
      try {
        const current = maybeEngine.getNode(nodeId).transform
        // Only restore if preview actually mutated engine (check if current differs from initial)
        const changed =
          current.x !== initial.x ||
          current.y !== initial.y ||
          current.rotation !== initial.rotation ||
          current.scaleX !== initial.scaleX ||
          current.scaleY !== initial.scaleY
        if (changed) {
          maybeEngine.setTransform(nodeId, initial as never)
        }
      } catch {
        // ignore
      }
    }
    const final = previewTransform
    const commands: unknown[] = []
    if (final.x !== initial.x || final.y !== initial.y) {
      commands.push(new MoveNodeCommand({ nodeId, x: final.x, y: final.y }))
    }
    if (final.rotation !== initial.rotation) {
      commands.push(new RotateNodeCommand({ nodeId, rotation: final.rotation }))
    }
    if (final.scaleX !== initial.scaleX || final.scaleY !== initial.scaleY) {
      commands.push(new ScaleNodeCommand({ nodeId, scaleX: final.scaleX, scaleY: final.scaleY }))
    }
    if (commands.length === 0) return
    try {
      if (commands.length === 1) {
        this.#dispatch(commands[0] as never)
      } else {
        this.#dispatch(new TransactionCommand(commands as never))
      }
    } catch {
      // ignore
    }
  }

  #updateCursor(handle: HandleKind): void {
    const map: Record<HandleKind, string> = {
      tl: 'nwse-resize',
      tr: 'nesw-resize',
      bl: 'nesw-resize',
      br: 'nwse-resize',
      t: 'ns-resize',
      b: 'ns-resize',
      l: 'ew-resize',
      r: 'ew-resize',
      rotation: 'crosshair',
    }
    this.#canvas.style.cursor = map[handle] ?? 'default'
  }
}
