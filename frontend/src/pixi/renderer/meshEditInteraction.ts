import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  MoveVertexCommand,
  DeleteVerticesCommand,
  TransactionCommand,
  ExtrudeFacesCommand,
  ExtrudeEdgesCommand,
  SubdivideFacesCommand,
  MirrorMeshCommand,
} from '../../engine/commands'
import { useMeshEditStore } from '../../stores/meshEditStore'
import type { MeshSelectMode } from '../../stores/meshEditStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform, WorldPoint } from './worldGeometry'
import { rectOf } from './worldGeometry'
import type { MeshOverlay } from './meshOverlay'

export interface MeshEditContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly meshOverlay: MeshOverlay
}

const MOVE_START_DISTANCE = 2
const MARQUEE_START_DISTANCE = 4

export class MeshEditInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #meshOverlay: MeshOverlay
  #attached = false
  #pressed = false
  #pressedOnMeshElement = false
  #dragVertexIndices: number[] = []
  #startWorldX = 0
  #startWorldY = 0
  #startClientX = 0
  #startClientY = 0
  #moveActive = false
  #marqueeActive = false
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
    window.addEventListener('keydown', this.#onKeyDown)
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
    window.removeEventListener('keydown', this.#onKeyDown)
  }

  deleteSelected(): void {
    const { selectMode } = useMeshEditStore.getState()
    if (selectMode === 'vertex') {
      this.#deleteSelectedVertices()
    } else if (selectMode === 'edge') {
      this.#deleteSelectedEdges()
    } else if (selectMode === 'face') {
      this.#deleteSelectedFaces()
    }
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Delete' || event.key === 'Backspace' || event.key === 'd') {
      const { meshEditNodeId } = useMeshEditStore.getState()
      if (!meshEditNodeId) {
        return
      }
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.tagName === 'INPUT' ||
          event.target.tagName === 'TEXTAREA')
      ) {
        return
      }
      this.deleteSelected()
    }
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return
    }
    const { meshEditNodeId, meshEditTool, selectMode } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool === 'weightPaint') {
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

    if (meshEditTool === 'delete') {
      this.#handleDeleteClick(point.x, point.y, scene, meshEditNodeId, selectMode)
      useMeshEditStore.getState().setMeshEditTool('select')
      return
    }

    if (meshEditTool === 'extrude') {
      this.#handleExtrudeClick(meshEditNodeId, selectMode)
      useMeshEditStore.getState().setMeshEditTool('select')
      return
    }

    if (meshEditTool === 'subdivide') {
      this.#handleSubdivideClick(meshEditNodeId, selectMode)
      useMeshEditStore.getState().setMeshEditTool('select')
      return
    }

    if (meshEditTool === 'mirror') {
      this.#handleMirrorClick(meshEditNodeId)
      useMeshEditStore.getState().setMeshEditTool('select')
      return
    }

    if (selectMode === 'vertex') {
      this.#handleVertexClick(point.x, point.y, scene, meshEditNodeId, event)
    } else if (selectMode === 'edge') {
      this.#handleEdgeClick(point.x, point.y, scene, meshEditNodeId, event)
    } else if (selectMode === 'face') {
      this.#handleFaceClick(point.x, point.y, scene, meshEditNodeId, event)
    }
  }

  #handleVertexClick(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    event: MouseEvent,
  ): void {
    const vertexIndex = this.#meshOverlay.hitTestVertex(worldX, worldY, scene, meshEditNodeId)
    if (vertexIndex === null) {
      this.#startMarquee(worldX, worldY, event)
      return
    }
    this.#pressed = true
    this.#pressedOnMeshElement = true
    this.#startWorldX = worldX
    this.#startWorldY = worldY

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
    this.#dragVertexIndices = [vertexIndex]
  }

  #handleEdgeClick(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    event: MouseEvent,
  ): void {
    const edge = this.#meshOverlay.hitTestEdge(worldX, worldY, scene, meshEditNodeId)
    if (!edge) {
      this.#startMarquee(worldX, worldY, event)
      return
    }
    this.#pressed = true
    this.#pressedOnMeshElement = true
    this.#startWorldX = worldX
    this.#startWorldY = worldY

    if (event.ctrlKey || event.metaKey) {
      useMeshEditStore.getState().toggleEdge(edge)
    } else if (event.shiftKey) {
      useMeshEditStore.getState().extendEdge(edge)
    } else {
      useMeshEditStore.getState().selectEdge(edge)
    }
    const { selectedEdgeIndices } = useMeshEditStore.getState()
    const vertexSet = new Set<number>()
    for (const e of selectedEdgeIndices) {
      vertexSet.add(e.v0)
      vertexSet.add(e.v1)
    }
    this.#dragVertexIndices = [...vertexSet]
  }

  #handleFaceClick(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    event: MouseEvent,
  ): void {
    const faceIndex = this.#meshOverlay.hitTestFace(worldX, worldY, scene, meshEditNodeId)
    if (faceIndex === null) {
      this.#startMarquee(worldX, worldY, event)
      return
    }
    this.#pressed = true
    this.#pressedOnMeshElement = true
    this.#startWorldX = worldX
    this.#startWorldY = worldY

    if (event.ctrlKey || event.metaKey) {
      useMeshEditStore.getState().toggleFace(faceIndex)
    } else if (event.shiftKey) {
      useMeshEditStore.getState().extendFace(faceIndex)
    } else {
      useMeshEditStore.getState().selectFace(faceIndex)
    }

    const node = scene.getNode(meshEditNodeId)
    const mesh = node?.components.mesh?.mesh
    if (mesh) {
      const { selectedFaceIndices } = useMeshEditStore.getState()
      const vertexSet = new Set<number>()
      for (const fi of selectedFaceIndices) {
        const face = mesh.faces[fi]
        if (face) {
          vertexSet.add(face.v0)
          vertexSet.add(face.v1)
          vertexSet.add(face.v2)
        }
      }
      this.#dragVertexIndices = [...vertexSet]
    }
  }

  #startMarquee(worldX: number, worldY: number, event: MouseEvent): void {
    this.#pressed = true
    this.#pressedOnMeshElement = false
    this.#startWorldX = worldX
    this.#startWorldY = worldY
    this.#startClientX = event.clientX
    this.#startClientY = event.clientY
    this.#marqueeActive = false
  }

  #handleDeleteClick(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    selectMode: string,
  ): void {
    if (selectMode === 'vertex') {
      const vertexIndex = this.#meshOverlay.hitTestVertex(worldX, worldY, scene, meshEditNodeId)
      if (vertexIndex !== null) {
        useMeshEditStore.getState().selectVertex(vertexIndex)
        this.#deleteSelectedVertices()
      }
    } else if (selectMode === 'edge') {
      const edge = this.#meshOverlay.hitTestEdge(worldX, worldY, scene, meshEditNodeId)
      if (edge) {
        useMeshEditStore.getState().selectEdge(edge)
        this.#deleteSelectedEdges()
      }
    } else if (selectMode === 'face') {
      const faceIndex = this.#meshOverlay.hitTestFace(worldX, worldY, scene, meshEditNodeId)
      if (faceIndex !== null) {
        useMeshEditStore.getState().selectFace(faceIndex)
        this.#deleteSelectedFaces()
      }
    }
  }

  #handleExtrudeClick(meshEditNodeId: string, selectMode: MeshSelectMode): void {
    if (selectMode === 'face') {
      this.#extrudeSelectedFaces(meshEditNodeId)
    } else if (selectMode === 'edge') {
      this.#extrudeSelectedEdges(meshEditNodeId)
    }
  }

  #handleSubdivideClick(meshEditNodeId: string, selectMode: MeshSelectMode): void {
    if (selectMode === 'face') {
      this.#subdivideSelectedFaces(meshEditNodeId)
    }
  }

  #handleMirrorClick(meshEditNodeId: string): void {
    const { mirrorAxis } = useMeshEditStore.getState()
    this.#dispatch(new MirrorMeshCommand({ nodeId: meshEditNodeId, axis: mirrorAxis }))
  }

  #extrudeSelectedFaces(meshEditNodeId: string): void {
    const { selectedFaceIndices } = useMeshEditStore.getState()
    if (selectedFaceIndices.length === 0) {
      return
    }
    this.#dispatch(
      new ExtrudeFacesCommand({
        nodeId: meshEditNodeId,
        faceIndices: selectedFaceIndices,
        distance: 20,
      }),
    )
    useMeshEditStore.getState().clearFaceSelection()
  }

  #extrudeSelectedEdges(meshEditNodeId: string): void {
    const { selectedEdgeIndices } = useMeshEditStore.getState()
    if (selectedEdgeIndices.length === 0) {
      return
    }
    this.#dispatch(
      new ExtrudeEdgesCommand({
        nodeId: meshEditNodeId,
        edgeIndices: selectedEdgeIndices,
        distance: 20,
      }),
    )
    useMeshEditStore.getState().clearEdgeSelection()
  }

  #subdivideSelectedFaces(meshEditNodeId: string): void {
    const { selectedFaceIndices } = useMeshEditStore.getState()
    if (selectedFaceIndices.length === 0) {
      return
    }
    this.#dispatch(
      new SubdivideFacesCommand({
        nodeId: meshEditNodeId,
        faceIndices: selectedFaceIndices,
      }),
    )
    useMeshEditStore.getState().clearFaceSelection()
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed) {
      return
    }

    const { meshEditNodeId, meshEditTool, selectMode } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool === 'weightPaint') {
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

    if (this.#pressedOnMeshElement && this.#dragVertexIndices.length > 0) {
      this.#handleDrag(point.x, point.y, scene, meshEditNodeId)
    } else if (!this.#pressedOnMeshElement) {
      this.#handleMarquee(event, point, scene, meshEditNodeId, selectMode)
    }
  }

  #handleDrag(worldX: number, worldY: number, scene: Scene, meshEditNodeId: string): void {
    const dx = worldX - this.#startWorldX
    const dy = worldY - this.#startWorldY
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
    const indices = new Set(this.#dragVertexIndices)
    for (const idx of selectedVertexIndices) {
      indices.add(idx)
    }
    for (const idx of indices) {
      const original = mesh.vertices[idx]
      if (original) {
        this.#previewPositions.set(idx, { x: original.x + dx, y: original.y + dy })
      }
    }
    this.#meshOverlay.setPreviewVertices(this.#previewPositions)
    this.#meshOverlay.redraw()
  }

  #handleMarquee(
    event: MouseEvent,
    point: WorldPoint,
    scene: Scene,
    meshEditNodeId: string,
    selectMode: MeshSelectMode,
  ): void {
    const dx = event.clientX - this.#startClientX
    const dy = event.clientY - this.#startClientY
    if (!this.#marqueeActive && Math.hypot(dx, dy) < MARQUEE_START_DISTANCE) {
      return
    }
    this.#marqueeActive = true
    const startWorld: WorldPoint = { x: this.#startWorldX, y: this.#startWorldY }
    const rect = rectOf(startWorld, point)

    if (selectMode === 'vertex') {
      const hits = this.#meshOverlay.verticesInRect(rect, scene, meshEditNodeId)
      useMeshEditStore.getState().selectVertices(hits)
    } else if (selectMode === 'edge') {
      const hits = this.#meshOverlay.edgesInRect(rect, scene, meshEditNodeId)
      useMeshEditStore.getState().selectEdges(hits)
    } else if (selectMode === 'face') {
      const hits = this.#meshOverlay.facesInRect(rect, scene, meshEditNodeId)
      useMeshEditStore.getState().selectFaces(hits)
    }

    this.#meshOverlay.redraw()
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed) {
      return
    }
    if (this.#moveActive && this.#dragVertexIndices.length > 0) {
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
      commands.push(
        new MoveVertexCommand({ nodeId: meshEditNodeId, vertexIndex: index, x: pos.x, y: pos.y }),
      )
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
    this.#dispatch(
      new DeleteVerticesCommand({ nodeId: meshEditNodeId, vertexIndices: selectedVertexIndices }),
    )
    useMeshEditStore.getState().clearVertexSelection()
  }

  #deleteSelectedEdges(): void {
    const { meshEditNodeId, selectedEdgeIndices } = useMeshEditStore.getState()
    if (!meshEditNodeId || selectedEdgeIndices.length === 0) {
      return
    }
    const vertexIndices = new Set<number>()
    for (const edge of selectedEdgeIndices) {
      vertexIndices.add(edge.v0)
      vertexIndices.add(edge.v1)
    }
    this.#dispatch(
      new DeleteVerticesCommand({ nodeId: meshEditNodeId, vertexIndices: [...vertexIndices] }),
    )
    useMeshEditStore.getState().clearEdgeSelection()
  }

  #deleteSelectedFaces(): void {
    const { meshEditNodeId, selectedFaceIndices } = useMeshEditStore.getState()
    if (!meshEditNodeId || selectedFaceIndices.length === 0) {
      return
    }
    const scene = this.#getScene()
    if (!scene) return
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) return
    const mesh = node.components.mesh.mesh
    const faceSet = new Set(selectedFaceIndices)
    const remainingFaces = mesh.faces.filter((_, i) => !faceSet.has(i))
    if (remainingFaces.length === mesh.faces.length) {
      return
    }
    const usedVertices = new Set<number>()
    for (const face of remainingFaces) {
      usedVertices.add(face.v0)
      usedVertices.add(face.v1)
      usedVertices.add(face.v2)
    }
    const vertexIndices: number[] = []
    for (const faceIdx of selectedFaceIndices) {
      const face = mesh.faces[faceIdx]
      if (face && !usedVertices.has(face.v0)) vertexIndices.push(face.v0)
      if (face && !usedVertices.has(face.v1)) vertexIndices.push(face.v1)
      if (face && !usedVertices.has(face.v2)) vertexIndices.push(face.v2)
    }
    const uniqueIndices = [...new Set(vertexIndices)]
    if (uniqueIndices.length > 0) {
      this.#dispatch(
        new DeleteVerticesCommand({ nodeId: meshEditNodeId, vertexIndices: uniqueIndices }),
      )
    }
    useMeshEditStore.getState().clearFaceSelection()
  }

  #reset(): void {
    this.#pressed = false
    this.#pressedOnMeshElement = false
    this.#dragVertexIndices = []
    this.#moveActive = false
    this.#marqueeActive = false
    this.#previewPositions.clear()
    this.#meshOverlay.clearPreviewVertices()
  }
}
