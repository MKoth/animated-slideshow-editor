import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  PaintWeightCommand,
  BlurWeightsCommand,
  FillWeightsCommand,
  AutoWeightsCommand,
  TransactionCommand,
} from '../../engine/commands'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'

export interface WeightPaintContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
}

export class WeightPaintInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  #attached = false
  #pressed = false
  #lastWorldX = 0
  #lastWorldY = 0

  constructor(context: WeightPaintContext) {
    this.#canvas = context.canvas
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
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

    if (weightPaintTool === 'paint') {
      this.#handlePaintBrush(point.x, point.y, scene, meshEditNodeId, selectedBoneId)
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
    const { meshEditNodeId, meshEditTool, selectedBoneId, weightPaintTool, brushRadius } =
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

    // Only paint if mouse has moved enough (brush radius threshold)
    const dx = point.x - this.#lastWorldX
    const dy = point.y - this.#lastWorldY
    const distance = Math.hypot(dx, dy)
    if (distance < brushRadius * 0.5) {
      return
    }

    this.#lastWorldX = point.x
    this.#lastWorldY = point.y

    if (weightPaintTool === 'paint') {
      this.#handlePaintBrush(point.x, point.y, scene, meshEditNodeId, selectedBoneId)
    } else if (weightPaintTool === 'smooth') {
      this.#handleSmoothBrush(point.x, point.y, scene, meshEditNodeId)
    }
  }

  readonly #onMouseUp = (): void => {
    this.#pressed = false
  }

  #handlePaintBrush(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
    boneId: string,
  ): void {
    const { brushRadius, brushStrength } = useMeshEditStore.getState()
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = scene.getNode(meshEditNodeId)?._cachedWorldTransform
    if (!worldTransform) {
      return
    }

    // Find vertices within brush radius
    const affectedVertices: number[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i]
      // Convert vertex to world space
      const cos = Math.cos(worldTransform.rotation)
      const sin = Math.sin(worldTransform.rotation)
      const scaledX = v.x * worldTransform.scaleX
      const scaledY = v.y * worldTransform.scaleY
      const wx = scaledX * cos - scaledY * sin + worldTransform.x
      const wy = scaledX * sin + scaledY * cos + worldTransform.y

      const dist = Math.hypot(worldX - wx, worldY - wy)
      if (dist <= brushRadius) {
        affectedVertices.push(i)
      }
    }

    if (affectedVertices.length === 0) {
      return
    }

    // Create commands for each affected vertex
    const commands = affectedVertices.map(
      (vertexIndex) =>
        new PaintWeightCommand({
          nodeId: meshEditNodeId,
          vertexIndex,
          boneId,
          strength: brushStrength,
          mode: 'add',
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
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = scene.getNode(meshEditNodeId)?._cachedWorldTransform
    if (!worldTransform) {
      return
    }

    // Find vertices within brush radius
    const affectedVertices: number[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i]
      const cos = Math.cos(worldTransform.rotation)
      const sin = Math.sin(worldTransform.rotation)
      const scaledX = v.x * worldTransform.scaleX
      const scaledY = v.y * worldTransform.scaleY
      const wx = scaledX * cos - scaledY * sin + worldTransform.x
      const wy = scaledX * sin + scaledY * cos + worldTransform.y

      const dist = Math.hypot(worldX - wx, worldY - wy)
      if (dist <= brushRadius) {
        affectedVertices.push(i)
      }
    }

    if (affectedVertices.length === 0) {
      return
    }

    this.#dispatch(
      new BlurWeightsCommand({
        nodeId: meshEditNodeId,
        iterations: 1,
        strength: 0.5,
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
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const worldTransform = scene.getNode(meshEditNodeId)?._cachedWorldTransform
    if (!worldTransform) {
      return
    }

    // Find vertices within brush radius
    const affectedVertices: number[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i]
      const cos = Math.cos(worldTransform.rotation)
      const sin = Math.sin(worldTransform.rotation)
      const scaledX = v.x * worldTransform.scaleX
      const scaledY = v.y * worldTransform.scaleY
      const wx = scaledX * cos - scaledY * sin + worldTransform.x
      const wy = scaledX * sin + scaledY * cos + worldTransform.y

      const dist = Math.hypot(worldX - wx, worldY - wy)
      if (dist <= brushRadius) {
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

  #reset(): void {
    this.#pressed = false
  }
}
