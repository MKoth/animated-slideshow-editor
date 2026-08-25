import type { EnginePublic, Scene } from '../../engine'
import type { MeshData } from '../../engine/mesh'
import { useMeshEditStore } from '../../stores/meshEditStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldTransform } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'
import { walkPreOrder } from '../../engine/sceneNode'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'
import type { WorldTransformSource } from './hitTest'

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

function localToWorld(
  localX: number,
  localY: number,
  transform: WorldTransform,
): { x: number; y: number } {
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  const scaledX = localX * transform.scaleX
  const scaledY = localY * transform.scaleY
  return {
    x: scaledX * cos - scaledY * sin + transform.x,
    y: scaledX * sin + scaledY * cos + transform.y,
  }
}

function computeBoneWorldTransforms(
  scene: Scene,
  getWorldTransform?: WorldTransformSource,
): Map<string, WorldTransform> {
  const transforms = new Map<string, WorldTransform>()
  for (const node of walkPreOrder(scene.root)) {
    if (!node.components.bone) continue
    const wt = getWorldTransform ? getWorldTransform(node.id) : worldTransformOf(scene, node.id)
    if (wt) {
      transforms.set(node.id, wt)
    }
  }
  return transforms
}

function getDeformedVertices(
  mesh: MeshData,
  scene: Scene,
  meshTransform: WorldTransform,
  getWorldTransform?: WorldTransformSource,
): { x: number; y: number }[] {
  if (!mesh.boneWeights || mesh.boneWeights.length === 0) {
    return mesh.vertices.map((v) => ({ x: v.x, y: v.y }))
  }
  const boneTransforms = computeBoneWorldTransforms(scene, getWorldTransform)
  if (boneTransforms.size === 0) {
    return mesh.vertices.map((v) => ({ x: v.x, y: v.y }))
  }
  const result = evaluateMeshDeformation(mesh, boneTransforms, meshTransform)
  return result.deformedVertices.map((v) => ({ x: v.x, y: v.y }))
}

export interface WeightPaintOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getWorldTransform?: WorldTransformSource
}

export class WeightPaintOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getWorldTransform?: WorldTransformSource
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeMeshEdit: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null

  constructor(context: WeightPaintOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getWorldTransform = context.getWorldTransform
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
      if (event.type === 'MeshChanged' || event.type === 'TransformChanged') {
        this.redraw()
      }
    })
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
    const transform = worldTransformOf(scene, meshEditNodeId)
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
    const deformed = getDeformedVertices(mesh, scene, transform, this.#getWorldTransform)
    const worldVertices = deformed.map((v) => localToWorld(v.x, v.y, transform))

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
