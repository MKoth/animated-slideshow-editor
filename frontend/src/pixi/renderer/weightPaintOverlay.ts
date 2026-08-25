import type { EnginePublic, Scene } from '../../engine'
import type { MeshData } from '../../engine/mesh'
import type { WorldTransform } from './worldGeometry'
import { useMeshEditStore } from '../../stores/meshEditStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import { worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransformSource } from './hitTest'
import { deformedMeshWorldVertices } from './deformedMeshWorld'
import type { Unsubscribe } from '../../engine'

// Heatmap color gradient: blue (0) -> cyan -> green -> yellow -> red (1)
function weightToColor(weight: number): number {
  const t = Math.max(0, Math.min(1, weight))
  if (t < 0.25) {
    // blue to cyan
    const s = t / 0.25
    return lerpColor(0x0000ff, 0x00ffff, s)
  } else if (t < 0.5) {
    // cyan to green
    const s = (t - 0.25) / 0.25
    return lerpColor(0x00ffff, 0x00ff00, s)
  } else if (t < 0.75) {
    // green to yellow
    const s = (t - 0.5) / 0.25
    return lerpColor(0x00ff00, 0xffff00, s)
  } else {
    // yellow to red
    const s = (t - 0.75) / 0.25
    return lerpColor(0xffff00, 0xff0000, s)
  }
}

function lerpColor(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 0xff
  const g1 = (c1 >> 8) & 0xff
  const b1 = c1 & 0xff
  const r2 = (c2 >> 16) & 0xff
  const g2 = (c2 >> 8) & 0xff
  const b2 = c2 & 0xff
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return (r << 16) | (g << 8) | b
}

export interface WeightPaintOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getWorldTransform?: WorldTransformSource
  readonly subscribeTime?: (listener: () => void) => Unsubscribe
}

export class WeightPaintOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getWorldTransform?: WorldTransformSource
  readonly #subscribeTime?: (listener: () => void) => Unsubscribe
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeMeshEdit: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null
  #unsubscribeTime: Unsubscribe | null = null

  constructor(context: WeightPaintOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getWorldTransform = context.getWorldTransform
    this.#subscribeTime = context.subscribeTime
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    const graphics = new this.#pixi.Graphics()
    graphics.label = 'weight-paint-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    this.#unsubscribeMeshEdit = useMeshEditStore.subscribe(() => this.redraw())
    this.#unsubscribeEngine = this.#engine.subscribe((event) => {
      if (
        event.type === 'MeshChanged' ||
        event.type === 'TransformChanged' ||
        event.type === 'IKTargetChanged' ||
        event.type === 'IKPoleTargetChanged'
      ) {
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
    this.#unsubscribeMeshEdit?.()
    this.#unsubscribeMeshEdit = null
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
    const { meshEditNodeId, meshEditTool, selectedBoneId, heatmapVisible } =
      useMeshEditStore.getState()
    if (!meshEditNodeId || meshEditTool !== 'weightPaint' || !heatmapVisible || !selectedBoneId) {
      return
    }
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#getWorldTransform
      ? this.#getWorldTransform(meshEditNodeId)
      : worldTransformOf(scene, meshEditNodeId)
    if (!transform) {
      return
    }
    this.#drawHeatmap(graphics, mesh, transform, selectedBoneId, scene)
  }

  #drawHeatmap(
    graphics: PixiGraphics,
    mesh: MeshData,
    transform: WorldTransform,
    boneId: string,
    scene: Scene,
  ): void {
    const worldVertices = deformedMeshWorldVertices(mesh, scene, transform, this.#getWorldTransform)

    // Draw filled triangles with heatmap colors
    for (const face of mesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (!v0 || !v1 || !v2) continue

      // Get weights for each vertex
      const w0 = this.#getWeightForBone(mesh, face.v0, boneId)
      const w1 = this.#getWeightForBone(mesh, face.v1, boneId)
      const w2 = this.#getWeightForBone(mesh, face.v2, boneId)

      // Use average color for the triangle
      const avgWeight = (w0 + w1 + w2) / 3
      const color = weightToColor(avgWeight)

      graphics
        .moveTo(v0.x, v0.y)
        .lineTo(v1.x, v1.y)
        .lineTo(v2.x, v2.y)
        .closePath()
        .fill({ color, alpha: 0.7 })
    }
  }

  #getWeightForBone(mesh: MeshData, vertexIndex: number, boneId: string): number {
    if (!mesh.boneWeights) return 0
    const vertexWeights = mesh.boneWeights[vertexIndex]
    if (!vertexWeights) return 0
    const weight = vertexWeights.find((w) => w.boneId === boneId)
    return weight ? weight.weight : 0
  }
}
