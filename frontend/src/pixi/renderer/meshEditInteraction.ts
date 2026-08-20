import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { MoveVertexCommand, DeleteVerticesCommand, TransactionCommand } from '../../engine/commands'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
import type { MeshOverlay } from './meshOverlay'

export interface MeshEditContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly meshOverlay: MeshOverlay
}

const MOVE_START_DISTANCE = 2

export class MeshEditInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #meshOverlay: MeshOverlay
  #attached = false
  #pressed = false
  #dragVertexIndex: number | null = null
  #startWorldX = 0
  #startWorldY = 0
  #moveActive = false
  #previewPositions = new Map<number, { x: number; y: number }>()

  constructor(context: MeshEditContext) {
    this.#canvas = context.canvas
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
    this.#meshOverlay = context.meshOverlay
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#reset()
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return
    }
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (!meshEditNodeId) {
      return
    }
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const camera = this.#getCameraTransform()
    if (!camera) {
      return
    }
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      return
    }
    const vertexIndex = this.#meshOverlay.hitTestVertex(point.x, point.y, scene, meshEditNodeId)
    if (vertexIndex === null) {
      return
    }
    this.#pressed = true
    this.#startWorldX = point.x
    this.#startWorldY = point.y

    if (meshEditTool === 'select') {
      if (event.ctrlKey || event.metaKey) {
        useMeshEditStore.getState().toggleVertex(vertexIndex)
      } else if (event.shiftKey) {
        useMeshEditStore.getState().extendVertex(vertexIndex)
      } else {
        const selected = useMeshEditStore.getState().selectedVertexIndices
        if (!selected.includes(vertexIndex)) {
          useMeshEditStore.getState().selectVertex(vertexIndex)
        }
      }
      this.#dragVertexIndex = vertexIndex
    } else if (meshEditTool === 'delete') {
      useMeshEditStore.getState().selectVertex(vertexIndex)
      this.#deleteSelectedVertices()
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed || this.#dragVertexIndex === null) {
      return
    }
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (!meshEditNodeId) {
      return
    }
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) {
      return
    }
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      return
    }
    const dx = point.x - this.#startWorldX
    const dy = point.y - this.#startWorldY
    if (!this.#moveActive && Math.hypot(dx, dy) < MOVE_START_DISTANCE) {
      return
    }
    this.#moveActive = true
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const { selectedVertexIndices } = useMeshEditStore.getState()
    const indices = selectedVertexIndices.includes(this.#dragVertexIndex)
      ? selectedVertexIndices
      : [this.#dragVertexIndex]
    for (const idx of indices) {
      const original = mesh.vertices[idx]
      if (original) {
        this.#previewPositions.set(idx, { x: original.x + dx, y: original.y + dy })
      }
    }
    this.#meshOverlay.redraw()
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed) {
      return
    }
    if (this.#moveActive && this.#dragVertexIndex !== null) {
      this.#commitMove()
    }
    this.#reset()
  }

  #commitMove(): void {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (!meshEditNodeId || this.#previewPositions.size === 0) {
      return
    }
    const commands: MoveVertexCommand[] = []
    for (const [index, pos] of this.#previewPositions) {
      commands.push(new MoveVertexCommand({ nodeId: meshEditNodeId, vertexIndex: index, x: pos.x, y: pos.y }))
    }
    if (commands.length === 1) {
      this.#dispatch(commands[0])
    } else if (commands.length > 1) {
      this.#dispatch(new TransactionCommand(commands))
    }
  }

  #deleteSelectedVertices(): void {
    const { meshEditNodeId, selectedVertexIndices } = useMeshEditStore.getState()
    if (!meshEditNodeId || selectedVertexIndices.length === 0) {
      return
    }
    this.#dispatch(new DeleteVerticesCommand({ nodeId: meshEditNodeId, vertexIndices: selectedVertexIndices }))
    useMeshEditStore.getState().clearVertexSelection()
  }

  #reset(): void {
    this.#pressed = false
    this.#dragVertexIndex = null
    this.#moveActive = false
    this.#previewPositions.clear()
  }
}
