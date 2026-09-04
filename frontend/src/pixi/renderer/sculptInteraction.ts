// PROTOTYPE — throwaway sculptInteraction for research/morph-brush
// Mirrors weightPaintInteraction.ts falloff + Transaction pattern, but edits rest vertices of the active Shape
// via MoveVertexCommand preview (meshOverlay.setPreviewVertices) then commit as Transaction(MoveVertex...).
// Preview uses deformedMeshWorldVertices so brush follows bone-deformed pose; mutation is mesh-local rest.
import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { MoveVertexCommand, TransactionCommand } from '../../engine/commands'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { cursorToWorld } from './screenToWorld'
import { deformedMeshWorldVertices } from './deformedMeshWorld'
import type { ViewportTransform, WorldTransform } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'
import type { MeshOverlay } from './meshOverlay'

export interface SculptContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly meshOverlay: MeshOverlay
}

function hitTestFace(
  px: number,
  py: number,
  worldVerts: { x: number; y: number }[],
  faces: readonly { v0: number; v1: number; v2: number }[],
): boolean {
  for (const f of faces) {
    const a = worldVerts[f.v0],
      b = worldVerts[f.v1],
      c = worldVerts[f.v2]
    if (!a || !b || !c) continue
    const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y)
    const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y)
    const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y)
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    if (!(hasNeg && hasPos)) return true
  }
  return false
}

export class SculptInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #meshOverlay: MeshOverlay
  #attached = false
  #pressed = false
  #lastClientX = 0
  #lastClientY = 0
  #previewPositions = new Map<number, { x: number; y: number }>()
  #basePositions = new Map<number, { x: number; y: number }>()

  constructor(ctx: SculptContext) {
    this.#canvas = ctx.canvas
    this.#getScene = ctx.getScene
    this.#getCameraTransform = ctx.getCameraTransform
    this.#dispatch = ctx.dispatch
    this.#meshOverlay = ctx.meshOverlay
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

  readonly #onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'sculpt') return
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const pt = cursorToWorld(this.#canvas, camera, e.clientX, e.clientY)
    if (!pt) return
    this.#pressed = true
    this.#lastClientX = e.clientX
    this.#lastClientY = e.clientY
    // seed base positions from deformedLocal (morph-then-bones preview base)
    const deformed = this.#meshOverlay.deformedLocalVertices(scene, meshEditNodeId)
    if (deformed) {
      for (let i = 0; i < deformed.length; i++)
        this.#basePositions.set(i, { x: deformed[i].x, y: deformed[i].y })
    }
    this.#applyBrush(
      pt.x,
      pt.y,
      scene,
      meshEditNodeId,
      e.shiftKey || e.altKey ? 'remove' : 'add',
      camera,
    )
  }

  readonly #onMouseMove = (e: MouseEvent): void => {
    if (!this.#pressed) return
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'sculpt') return
    // throttle like weightPaint: ignore <3px screen moves
    if (Math.hypot(e.clientX - this.#lastClientX, e.clientY - this.#lastClientY) < 3) return
    this.#lastClientX = e.clientX
    this.#lastClientY = e.clientY
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const pt = cursorToWorld(this.#canvas, camera, e.clientX, e.clientY)
    if (!pt) return
    this.#applyBrush(
      pt.x,
      pt.y,
      scene,
      meshEditNodeId,
      e.shiftKey || e.altKey ? 'remove' : 'add',
      camera,
    )
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed) return
    this.#commit()
    this.#reset()
  }

  #applyBrush(
    worldX: number,
    worldY: number,
    scene: Scene,
    nodeId: string,
    mode: 'add' | 'remove',
    camera: ViewportTransform,
  ): void {
    const node = scene.getNode(nodeId)
    if (!node?.components.mesh) return
    const mesh = node.components.mesh.mesh
    const worldTransform: WorldTransform | null = worldTransformOf(scene, nodeId)
    if (!worldTransform) return
    // use deformed world vertices for distance (so brush follows skin)
    const worldVerts = deformedMeshWorldVertices(mesh, scene, worldTransform)
    // face guard — don't sculpt empty space
    if (!hitTestFace(worldX, worldY, worldVerts, mesh.faces)) return

    const { sculptRadius, sculptStrength, sculptFalloff } = useMeshEditStore.getState()
    const radiusScreen = sculptRadius // 25px default per #272
    const radiusWorldScale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.1)
    // infer drag dir from last move: for prototype use upward push (0,-1) * strength; real dir = normalized drag vector
    const dirX = 0
    const dirY = mode === 'remove' ? 1 : -1 // invert with Shift

    for (let i = 0; i < worldVerts.length; i++) {
      const v = worldVerts[i]
      const distWorld = Math.hypot(v.x - worldX, v.y - worldY)
      const distScreen = distWorld * radiusWorldScale
      if (distScreen > radiusScreen) continue
      let factor = 1 - distScreen / radiusScreen // 1 - dist/radius
      if (sculptFalloff !== 1) factor = Math.pow(Math.max(0, factor), sculptFalloff) // pow(1-dist/radius, falloff) #272
      const delta = sculptStrength * factor
      const base = this.#basePositions.get(i) ?? { x: mesh.vertices[i].x, y: mesh.vertices[i].y }
      // vertex += dir * strength * falloff — world+screen hybrid, preview in mesh-local deformed space
      // For prototype we push along Y in world; mesh-local is approximated as same axis (valid when rotation≈0)
      const nx = base.x + dirX * delta * 10
      const ny = base.y + dirY * delta * 10
      this.#previewPositions.set(i, { x: nx, y: ny })
      this.#basePositions.set(i, { x: nx, y: ny }) // accumulate per dab
    }
    this.#meshOverlay.setPreviewVertices(this.#previewPositions)
    this.#meshOverlay.redraw()
  }

  #commit(): void {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (!meshEditNodeId || this.#previewPositions.size === 0) return
    // PROTOTYPE: commit as MoveVertexCommands on the activeShape — here we commit to base mesh for preview
    // Real impl would patch the active Shape's vertices via a dedicated SculptShapeCommand (see shape.ts)
    const cmds: MoveVertexCommand[] = []
    for (const [idx, pos] of this.#previewPositions) {
      cmds.push(
        new MoveVertexCommand({ nodeId: meshEditNodeId, vertexIndex: idx, x: pos.x, y: pos.y }),
      )
    }
    if (cmds.length === 1) this.#dispatch(cmds[0])
    else if (cmds.length > 1) this.#dispatch(new TransactionCommand(cmds))
  }

  #reset(): void {
    this.#pressed = false
    this.#previewPositions.clear()
    // keep basePositions across drag? clear on mouse up
    this.#basePositions.clear()
    this.#meshOverlay.clearPreviewVertices()
  }
}
