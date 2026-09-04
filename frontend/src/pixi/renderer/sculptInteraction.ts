import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { MoveShapeVertexCommand, TransactionCommand } from '../../engine/commands'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { cursorToWorld } from './screenToWorld'
import { deformedMeshWorldVertices } from './deformedMeshWorld'
import type { ViewportTransform, WorldTransform } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransformSource } from './hitTest'
import { computeSculptOffsets, isBrushOverMesh } from '../../engine/sculptBrush'
import type { MeshOverlay } from './meshOverlay'

export interface SculptContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly meshOverlay: MeshOverlay
  readonly getWorldTransform?: WorldTransformSource
}

export class SculptInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #meshOverlay: MeshOverlay
  readonly #getWorldTransform?: WorldTransformSource
  #attached = false
  #pressed = false
  #lastWorldX = 0
  #lastWorldY = 0
  #lastClientX = 0
  #lastClientY = 0
  // original shape rest positions at stroke start (for per-stroke commit diff)
  #originalRestPositions = new Map<number, { x: number; y: number }>()
  // current preview positions (rest space) that are displayed via overlay
  #previewPositions = new Map<number, { x: number; y: number }>()
  // mutable base for accumulation (starts as original, updated per dab)
  #basePositions = new Map<number, { x: number; y: number }>()

  constructor(ctx: SculptContext) {
    this.#canvas = ctx.canvas
    this.#getScene = ctx.getScene
    this.#getCameraTransform = ctx.getCameraTransform
    this.#dispatch = ctx.dispatch
    this.#meshOverlay = ctx.meshOverlay
    this.#getWorldTransform = ctx.getWorldTransform
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#reset()
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
  }

  #resolveMeshTransform(scene: Scene, nodeId: string): WorldTransform | null {
    if (this.#getWorldTransform) {
      return this.#getWorldTransform(nodeId)
    }
    return worldTransformOf(scene, nodeId)
  }

  readonly #onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    const { meshEditNodeId, meshEditTool, activeShapeId } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'sculpt') return
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const pt = cursorToWorld(this.#canvas, camera, e.clientX, e.clientY)
    if (!pt) return
    const node = scene.getNode(meshEditNodeId)
    if (!node?.components.mesh) return
    // Require active shape — if not set, pick first shape or bail
    let shapeId = activeShapeId
    if (!shapeId) {
      const first = node.components.mesh.shapes?.[0]
      if (!first) return
      shapeId = first.id
      useMeshEditStore.getState().setActiveShapeId(shapeId)
    }
    const shape = node.components.mesh.shapes?.find((s) => s.id === shapeId)
    if (!shape) return

    this.#pressed = true
    this.#lastClientX = e.clientX
    this.#lastClientY = e.clientY
    this.#lastWorldX = pt.x
    this.#lastWorldY = pt.y

    // Seed base/original positions from shape rest vertices
    this.#originalRestPositions.clear()
    this.#basePositions.clear()
    this.#previewPositions.clear()
    for (let i = 0; i < shape.vertices.length; i++) {
      const v = shape.vertices[i]
      if (!v) continue
      const pos = { x: v.x, y: v.y }
      this.#originalRestPositions.set(i, pos)
      this.#basePositions.set(i, pos)
    }
    // No initial dab on mousedown — sculpt occurs on drag (per spec drag-direction)
    // But we still want face guard check on mousedown? Defer to mousemove.
  }

  readonly #onMouseMove = (e: MouseEvent): void => {
    if (!this.#pressed) return
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'sculpt') return
    // throttle like weightPaint: ignore <3px screen moves
    if (Math.hypot(e.clientX - this.#lastClientX, e.clientY - this.#lastClientY) < 3) return
    const prevWorldX = this.#lastWorldX
    const prevWorldY = this.#lastWorldY
    this.#lastClientX = e.clientX
    this.#lastClientY = e.clientY
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const pt = cursorToWorld(this.#canvas, camera, e.clientX, e.clientY)
    if (!pt) return
    this.#lastWorldX = pt.x
    this.#lastWorldY = pt.y

    const dragDeltaWorld = { x: pt.x - prevWorldX, y: pt.y - prevWorldY }
    const invert = e.shiftKey || e.altKey
    this.#applyBrush(pt.x, pt.y, dragDeltaWorld, scene, meshEditNodeId, invert, camera)
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed) return
    this.#commit()
    this.#reset()
  }

  #applyBrush(
    worldX: number,
    worldY: number,
    dragDeltaWorld: { x: number; y: number },
    scene: Scene,
    nodeId: string,
    invert: boolean,
    camera: ViewportTransform,
  ): void {
    const node = scene.getNode(nodeId)
    if (!node?.components.mesh) return
    const mesh = node.components.mesh.mesh
    const { activeShapeId, sculptRadius, sculptStrength, sculptFalloff } =
      useMeshEditStore.getState()
    if (!activeShapeId) return
    const shape = node.components.mesh.shapes?.find((s) => s.id === activeShapeId)
    if (!shape) return
    const worldTransform = this.#resolveMeshTransform(scene, nodeId)
    if (!worldTransform) return

    // Build active shape mesh for deformed evaluation (shape shares topology)
    const activeShapeMesh = { ...mesh, vertices: shape.vertices as unknown as typeof mesh.vertices }
    const worldVerts = deformedMeshWorldVertices(
      activeShapeMesh,
      scene,
      worldTransform,
      this.#getWorldTransform,
    )

    // Face guard — don't sculpt empty space (must be over visible face)
    if (!isBrushOverMesh(worldX, worldY, worldVerts, mesh.faces)) return

    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.1)
    const radiusScreen = sculptRadius

    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: worldX, y: worldY },
      radiusScreen,
      scale,
      falloff: sculptFalloff,
      strength: sculptStrength,
      dragDeltaWorld,
      invert,
    })

    if (offsets.size === 0) return

    // Apply offsets to basePositions (accumulating per dab) and update preview
    for (const [idx, off] of offsets) {
      const base = this.#basePositions.get(idx)
      if (!base) continue
      const nx = base.x + off.dx
      const ny = base.y + off.dy
      this.#basePositions.set(idx, { x: nx, y: ny })
      this.#previewPositions.set(idx, { x: nx, y: ny })
    }

    // Ensure preview contains all vertices that have been moved at least once
    // (basePositions already has all indices, but previewPositions only those touched)
    this.#meshOverlay.setPreviewVertices(this.#previewPositions)
    this.#meshOverlay.redraw()
  }

  #commit(): void {
    const { meshEditNodeId, activeShapeId } = useMeshEditStore.getState()
    if (!meshEditNodeId || !activeShapeId || this.#previewPositions.size === 0) return
    // Build Transaction of per-vertex moves (per-stroke, not per-dab)
    const cmds: MoveShapeVertexCommand[] = []
    for (const [idx, pos] of this.#previewPositions) {
      const orig = this.#originalRestPositions.get(idx)
      if (!orig) continue
      // Only commit if changed (with epsilon)
      if (Math.hypot(pos.x - orig.x, pos.y - orig.y) < 1e-9) continue
      cmds.push(
        new MoveShapeVertexCommand({
          nodeId: meshEditNodeId,
          shapeId: activeShapeId,
          vertexIndex: idx,
          x: pos.x,
          y: pos.y,
        }),
      )
    }
    if (cmds.length === 0) return
    if (cmds.length === 1) this.#dispatch(cmds[0])
    else this.#dispatch(new TransactionCommand(cmds))
  }

  #reset(): void {
    this.#pressed = false
    this.#previewPositions.clear()
    this.#basePositions.clear()
    this.#originalRestPositions.clear()
    this.#meshOverlay.clearPreviewVertices()
    this.#meshOverlay.redraw()
  }
}
