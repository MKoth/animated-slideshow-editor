import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  PaintWeightCommand,
  SmoothWeightsCommand,
  BlurWeightsCommand,
  FillWeightsCommand,
  AutoWeightsCommand,
  TransactionCommand,
} from '../../engine/commands'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
import type { WorldTransformSource } from './hitTest'
import { worldTransformOf } from '../../engine/worldTransform'
import { deformedMeshWorldVertices } from './deformedMeshWorld'

export interface WeightPaintContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly getWorldTransform?: WorldTransformSource
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function hitTestFace(
  worldX: number,
  worldY: number,
  worldVertices: readonly { x: number; y: number }[],
  faces: readonly { v0: number; v1: number; v2: number }[],
): number | null {
  for (let i = faces.length - 1; i >= 0; i--) {
    const face = faces[i]
    const v0 = worldVertices[face.v0]
    const v1 = worldVertices[face.v1]
    const v2 = worldVertices[face.v2]
    if (!v0 || !v1 || !v2) continue
    if (pointInTriangle(worldX, worldY, v0.x, v0.y, v1.x, v1.y, v2.x, v2.y)) {
      return i
    }
  }
  return null
}

export class WeightPaintInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #getWorldTransform?: WorldTransformSource
  #attached = false
  #pressed = false
  #lastWorldX = 0
  #lastWorldY = 0
  #tooltip: HTMLDivElement | null = null

  constructor(context: WeightPaintContext) {
    this.#canvas = context.canvas
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
    this.#getWorldTransform = context.getWorldTransform
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
    this.#canvas.addEventListener('mousemove', this.#onHover)
    this.#canvas.addEventListener('mouseleave', this.#hideTooltip)
    this.#ensureTooltip()
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
    this.#canvas.removeEventListener('mousemove', this.#onHover)
    this.#canvas.removeEventListener('mouseleave', this.#hideTooltip)
    this.#hideTooltip()
    if (this.#tooltip) {
      this.#tooltip.remove()
      this.#tooltip = null
    }
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return
    }
    const { meshEditNodeId, meshEditTool, selectedBoneId, weightPaintTool } =
      useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'weightPaint' || !selectedBoneId) {
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

    this.#pressed = true
    this.#lastWorldX = point.x
    this.#lastWorldY = point.y

    const isErase = event.shiftKey || event.altKey
    const mode = isErase ? 'remove' : 'add'

    if (weightPaintTool === 'paint') {
      this.#handlePaintBrush(point.x, point.y, scene, meshEditNodeId, selectedBoneId, mode)
    } else if (weightPaintTool === 'smooth') {
      this.#handleSmoothBrush(point.x, point.y, scene, meshEditNodeId)
    } else if (weightPaintTool === 'fill') {
      this.#handleFillBrush(point.x, point.y, scene, meshEditNodeId, selectedBoneId)
    } else if (weightPaintTool === 'blur') {
      this.#handleBlurBrush(meshEditNodeId)
    } else if (weightPaintTool === 'autoWeights') {
      this.#handleAutoWeights(meshEditNodeId)
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed) {
      return
    }
    const { meshEditNodeId, meshEditTool, selectedBoneId, weightPaintTool } =
      useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'weightPaint' || !selectedBoneId) {
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

    // Throttle by screen distance (avoid spamming when mouse barely moves)
    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.001)
    const dx = point.x - this.#lastWorldX
    const dy = point.y - this.#lastWorldY
    const screenDist = Math.hypot(dx, dy) * scale
    if (screenDist < 3) {
      return
    }

    this.#lastWorldX = point.x
    this.#lastWorldY = point.y

    const isErase = event.shiftKey || event.altKey
    const mode = isErase ? 'remove' : 'add'

    if (weightPaintTool === 'paint') {
      this.#handlePaintBrush(point.x, point.y, scene, meshEditNodeId, selectedBoneId, mode)
    } else if (weightPaintTool === 'smooth') {
      this.#handleSmoothBrush(point.x, point.y, scene, meshEditNodeId)
    }
  }

  readonly #onMouseUp = (): void => {
    this.#pressed = false
  }

  readonly #onHover = (event: MouseEvent): void => {
    const { meshEditNodeId, meshEditTool, selectedBoneId } = useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'weightPaint' || !selectedBoneId) {
      this.#hideTooltip()
      return
    }
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) {
      this.#hideTooltip()
      return
    }
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      this.#hideTooltip()
      return
    }
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      this.#hideTooltip()
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = this.#resolveMeshTransform(scene, meshEditNodeId)
    if (!worldTransform) {
      this.#hideTooltip()
      return
    }
    const worldVertices = deformedMeshWorldVertices(
      mesh,
      scene,
      worldTransform,
      this.#getWorldTransform,
    )
    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.001)
    // Find nearest vertex
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < worldVertices.length; i++) {
      const v = worldVertices[i]
      const d = Math.hypot(point.x - v.x, point.y - v.y) * scale
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    if (bestIdx === -1) {
      this.#hideTooltip()
      return
    }
    // Only show if cursor is over mesh (face hit) or close to vertex (within 100px)
    const faceHit = hitTestFace(point.x, point.y, worldVertices, mesh.faces)
    if (faceHit === null && bestDist > 80) {
      this.#hideTooltip()
      return
    }
    const weight = this.#getWeightForBone(mesh, bestIdx, selectedBoneId)
    const text = `${(weight * 100).toFixed(0)}% (${weight.toFixed(2)})`
    this.#showTooltip(event.clientX, event.clientY, text)
  }

  #ensureTooltip(): void {
    if (this.#tooltip) return
    const el = document.createElement('div')
    el.className = 'weight-paint-tooltip'
    el.style.position = 'fixed'
    el.style.pointerEvents = 'none'
    el.style.background = 'rgba(0,0,0,0.75)'
    el.style.color = 'white'
    el.style.padding = '4px 6px'
    el.style.borderRadius = '4px'
    el.style.fontSize = '11px'
    el.style.zIndex = '999'
    el.style.display = 'none'
    el.style.whiteSpace = 'nowrap'
    document.body.appendChild(el)
    this.#tooltip = el
  }

  #showTooltip(clientX: number, clientY: number, text: string): void {
    if (!this.#tooltip) this.#ensureTooltip()
    const el = this.#tooltip!
    el.textContent = text
    el.style.left = `${clientX + 12}px`
    el.style.top = `${clientY + 12}px`
    el.style.display = 'block'
  }

  #hideTooltip = (): void => {
    if (this.#tooltip) {
      this.#tooltip.style.display = 'none'
    }
  }

  #getWeightForBone(
    mesh: { boneWeights?: readonly (readonly { boneId: string; weight: number }[])[] },
    vertexIndex: number,
    boneId: string,
  ): number {
    if (!mesh.boneWeights) return 0
    const vw = mesh.boneWeights[vertexIndex]
    if (!vw) return 0
    const w = vw.find((entry) => entry.boneId === boneId)
    return w ? w.weight : 0
  }

  #handlePaintBrush(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    boneId: string,
    mode: 'add' | 'remove' = 'add',
  ): void {
    const { brushRadius, brushStrength, brushFalloff } = useMeshEditStore.getState()
    const camera = this.#getCameraTransform()
    if (!camera) return
    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.001)
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = this.#resolveMeshTransform(scene, meshEditNodeId)
    if (!worldTransform) {
      return
    }

    const worldVertices = deformedMeshWorldVertices(
      mesh,
      scene,
      worldTransform,
      this.#getWorldTransform,
    )

    // Face-hit guard: must be over mesh to paint (fixes dense mesh miss)
    const faceHit = hitTestFace(worldX, worldY, worldVertices, mesh.faces)
    if (faceHit === null) {
      return
    }

    const radiusScreen = brushRadius // screen pixels

    type Affected = { index: number; strength: number }
    const affected: Affected[] = []
    for (let i = 0; i < worldVertices.length; i++) {
      const vertex = worldVertices[i]
      const distWorld = Math.hypot(worldX - vertex.x, worldY - vertex.y)
      const distScreen = distWorld * scale
      if (distScreen <= radiusScreen) {
        let factor = 1 - distScreen / radiusScreen
        if (brushFalloff !== 1) {
          factor = Math.pow(Math.max(0, factor), brushFalloff)
        }
        const delta = brushStrength * factor
        // Clamp delta to [0,1] already ensured
        if (delta > 0.001) {
          affected.push({ index: i, strength: delta })
        }
      }
    }

    if (affected.length === 0) {
      return
    }

    // Create commands for each affected vertex with per-vertex falloff strength
    const commands = affected.map(
      ({ index, strength }) =>
        new PaintWeightCommand({
          nodeId: meshEditNodeId,
          vertexIndex: index,
          boneId,
          strength,
          mode,
        }),
    )

    if (commands.length === 1) {
      this.#dispatch(commands[0])
    } else if (commands.length > 1) {
      this.#dispatch(new TransactionCommand(commands))
    }
  }

  #handleSmoothBrush(worldX: number, worldY: number, scene: Scene, meshEditNodeId: string): void {
    const { brushRadius } = useMeshEditStore.getState()
    const camera = this.#getCameraTransform()
    if (!camera) return
    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.001)
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = this.#resolveMeshTransform(scene, meshEditNodeId)
    if (!worldTransform) {
      return
    }

    const worldVertices = deformedMeshWorldVertices(
      mesh,
      scene,
      worldTransform,
      this.#getWorldTransform,
    )
    const radiusScreen = brushRadius
    const affectedVertices: number[] = []
    for (let i = 0; i < worldVertices.length; i++) {
      const vertex = worldVertices[i]
      const distScreen = Math.hypot(worldX - vertex.x, worldY - vertex.y) * scale
      if (distScreen <= radiusScreen) {
        affectedVertices.push(i)
      }
    }

    if (affectedVertices.length === 0) {
      return
    }

    this.#dispatch(
      new SmoothWeightsCommand({
        nodeId: meshEditNodeId,
        vertexIndices: affectedVertices,
        iterations: 1,
      }),
    )
  }

  #handleFillBrush(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    boneId: string,
  ): void {
    const { brushRadius, brushStrength } = useMeshEditStore.getState()
    const camera = this.#getCameraTransform()
    if (!camera) return
    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.001)
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = this.#resolveMeshTransform(scene, meshEditNodeId)
    if (!worldTransform) {
      return
    }

    const worldVertices = deformedMeshWorldVertices(
      mesh,
      scene,
      worldTransform,
      this.#getWorldTransform,
    )
    const radiusScreen = brushRadius
    const affectedVertices: number[] = []
    for (let i = 0; i < worldVertices.length; i++) {
      const vertex = worldVertices[i]
      const distScreen = Math.hypot(worldX - vertex.x, worldY - vertex.y) * scale
      if (distScreen <= radiusScreen) {
        affectedVertices.push(i)
      }
    }

    if (affectedVertices.length === 0) {
      return
    }

    this.#dispatch(
      new FillWeightsCommand({
        nodeId: meshEditNodeId,
        vertexIndices: affectedVertices,
        boneId,
        weight: brushStrength,
      }),
    )
  }

  #handleBlurBrush(meshEditNodeId: string): void {
    this.#dispatch(
      new BlurWeightsCommand({
        nodeId: meshEditNodeId,
        iterations: 1,
        strength: 0.5,
      }),
    )
  }

  #handleAutoWeights(meshEditNodeId: string): void {
    // Get all bone ids from the scene
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }

    // Find all bone nodes in the scene
    const boneIds: string[] = []
    const walk = (nodeId: string) => {
      const n = scene.getNode(nodeId)
      if (!n) return
      if (n.components.bone) {
        boneIds.push(nodeId)
      }
      for (const child of n.children) {
        walk(child.id)
      }
    }
    walk(scene.root.id)

    if (boneIds.length === 0) {
      return
    }

    this.#dispatch(
      new AutoWeightsCommand({
        nodeId: meshEditNodeId,
        boneIds,
        falloff: 2,
      }),
    )
  }

  #resolveMeshTransform(scene: Scene, nodeId: string) {
    return this.#getWorldTransform?.(nodeId) ?? worldTransformOf(scene, nodeId)
  }

  #reset(): void {
    this.#pressed = false
  }
}
