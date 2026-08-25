import type { EnginePublic, Scene } from '../../engine'
import type { MeshData, MeshEdge } from '../../engine/mesh'
import { extractEdges, edgeKey } from '../../engine/mesh'
import { walkPreOrder } from '../../engine/sceneNode'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useSelectionStore } from '../../stores/selectionStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldTransform, WorldRect } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransformSource } from './hitTest'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'

const WIREFRAME_COLOR = 0x1a73e8
const WIREFRAME_WIDTH = 1.5
const VERTEX_RADIUS = 4
const VERTEX_FILL = 0x1a73e8
const VERTEX_SELECTED_FILL = 0xff0000
const VERTEX_STROKE_COLOR = 0x1a73e8
const VERTEX_STROKE_WIDTH = 1.5

const EDGE_SELECTED_COLOR = 0x34a853
const EDGE_SELECTED_WIDTH = 3

const FACE_SELECTED_COLOR = 0x34a853
const FACE_SELECTED_ALPHA = 0.2

const EDGE_HIT_THRESHOLD = 8

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

export interface MeshOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getWorldTransform?: WorldTransformSource
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

function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const closestX = ax + t * dx
  const closestY = ay + t * dy
  return (px - closestX) ** 2 + (py - closestY) ** 2
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

export class MeshOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getWorldTransform?: WorldTransformSource
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeMeshEdit: (() => void) | null = null
  #unsubscribeSelection: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null
  #previewVertices: Map<number, { x: number; y: number }> | null = null

  constructor(context: MeshOverlayContext) {
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
    graphics.label = 'mesh-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    this.#unsubscribeMeshEdit = useMeshEditStore.subscribe(() => this.redraw())
    this.#unsubscribeSelection = useSelectionStore.subscribe(() => this.redraw())
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
    this.#unsubscribeSelection?.()
    this.#unsubscribeSelection = null
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

  #resolveTransform(scene: Scene, nodeId: string): WorldTransform | null {
    if (this.#getWorldTransform) {
      return this.#getWorldTransform(nodeId)
    }
    return worldTransformOf(scene, nodeId)
  }

  setPreviewVertices(positions: Map<number, { x: number; y: number }>): void {
    this.#previewVertices = positions
  }

  clearPreviewVertices(): void {
    this.#previewVertices = null
  }

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      const node = scene.getNode(meshEditNodeId)
      if (!node || !node.components.mesh) {
        return
      }
      const mesh = node.components.mesh.mesh
      const transform = this.#resolveTransform(scene, meshEditNodeId)
      if (!transform) {
        return
      }
      this.#drawMesh(graphics, mesh, transform, scene)
    } else {
      for (const node of walkPreOrder(scene.root)) {
        if (!node.components.mesh || !node.visible) {
          continue
        }
        const transform = this.#resolveTransform(scene, node.id)
        if (!transform) {
          continue
        }
        this.#drawWireframe(graphics, node.components.mesh.mesh, transform, scene)
      }
    }
  }

  #drawWireframe(
    graphics: PixiGraphics,
    mesh: MeshData,
    transform: WorldTransform,
    scene: Scene,
  ): void {
    const deformed = getDeformedVertices(mesh, scene, transform, this.#getWorldTransform)
    const worldVertices = deformed.map((v) => localToWorld(v.x, v.y, transform))
    for (const face of mesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1) {
        graphics
          .moveTo(v0.x, v0.y)
          .lineTo(v1.x, v1.y)
          .stroke({ width: WIREFRAME_WIDTH, color: WIREFRAME_COLOR })
      }
      if (v1 && v2) {
        graphics
          .moveTo(v1.x, v1.y)
          .lineTo(v2.x, v2.y)
          .stroke({ width: WIREFRAME_WIDTH, color: WIREFRAME_COLOR })
      }
      if (v2 && v0) {
        graphics
          .moveTo(v2.x, v2.y)
          .lineTo(v0.x, v0.y)
          .stroke({ width: WIREFRAME_WIDTH, color: WIREFRAME_COLOR })
      }
    }
  }

  #drawMesh(graphics: PixiGraphics, mesh: MeshData, transform: WorldTransform, scene: Scene): void {
    const {
      selectedVertexIndices,
      selectedEdgeIndices,
      selectedFaceIndices,
      selectMode,
      meshEditTool,
    } = useMeshEditStore.getState()
    const isWeightPaint = meshEditTool === 'weightPaint'
    const selectedVertexSet = new Set(selectedVertexIndices)
    const selectedEdgeSet = new Set(selectedEdgeIndices.map((e) => edgeKey(e.v0, e.v1)))
    const selectedFaceSet = new Set(selectedFaceIndices)
    const preview = this.#previewVertices
    const deformed = getDeformedVertices(mesh, scene, transform, this.#getWorldTransform)
    const worldVertices = deformed.map((v, i) => {
      const p = preview?.get(i)
      return localToWorld(p ? p.x : v.x, p ? p.y : v.y, transform)
    })

    if (!isWeightPaint) {
      // Draw selected faces (filled triangles)
      if (selectMode === 'face') {
        for (let fi = 0; fi < mesh.faces.length; fi++) {
          if (!selectedFaceSet.has(fi)) continue
          const face = mesh.faces[fi]
          const v0 = worldVertices[face.v0]
          const v1 = worldVertices[face.v1]
          const v2 = worldVertices[face.v2]
          if (v0 && v1 && v2) {
            graphics
              .moveTo(v0.x, v0.y)
              .lineTo(v1.x, v1.y)
              .lineTo(v2.x, v2.y)
              .closePath()
              .fill({ color: FACE_SELECTED_COLOR, alpha: FACE_SELECTED_ALPHA })
          }
        }
      }
    }

    // Draw wireframe edges
    for (const face of mesh.faces) {
      const edges: { va: number; vb: number; ax: number; ay: number; bx: number; by: number }[] = []
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1) edges.push({ va: face.v0, vb: face.v1, ax: v0.x, ay: v0.y, bx: v1.x, by: v1.y })
      if (v1 && v2) edges.push({ va: face.v1, vb: face.v2, ax: v1.x, ay: v1.y, bx: v2.x, by: v2.y })
      if (v2 && v0) edges.push({ va: face.v2, vb: face.v0, ax: v2.x, ay: v2.y, bx: v0.x, by: v0.y })

      for (const edge of edges) {
        const key = edgeKey(edge.va, edge.vb)
        const isEdgeSelected = !isWeightPaint && selectMode === 'edge' && selectedEdgeSet.has(key)
        graphics
          .moveTo(edge.ax, edge.ay)
          .lineTo(edge.bx, edge.by)
          .stroke({
            width: isEdgeSelected ? EDGE_SELECTED_WIDTH : WIREFRAME_WIDTH,
            color: isEdgeSelected ? EDGE_SELECTED_COLOR : WIREFRAME_COLOR,
          })
      }
    }

    if (!isWeightPaint) {
      // Draw vertices (only in vertex mode)
      if (selectMode === 'vertex') {
        for (let i = 0; i < worldVertices.length; i++) {
          const v = worldVertices[i]
          const isSelected = selectedVertexSet.has(i)
          graphics
            .circle(v.x, v.y, VERTEX_RADIUS)
            .fill({ color: isSelected ? VERTEX_SELECTED_FILL : VERTEX_FILL })
            .stroke({ width: VERTEX_STROKE_WIDTH, color: VERTEX_STROKE_COLOR })
        }
      }
    }
  }

  hitTestVertex(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
  ): number | null {
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return null
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#resolveTransform(scene, meshEditNodeId)
    if (!transform) {
      return null
    }
    const hitRadius =
      VERTEX_RADIUS / Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY), 0.1) + 2
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i]
      const { x: wx, y: wy } = localToWorld(v.x, v.y, transform)
      const dist = Math.hypot(worldX - wx, worldY - wy)
      if (dist <= hitRadius) {
        return i
      }
    }
    return null
  }

  hitTestEdge(
    worldX: number,
    worldY: number,
    scene: Scene,
    meshEditNodeId: string,
  ): MeshEdge | null {
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return null
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#resolveTransform(scene, meshEditNodeId)
    if (!transform) {
      return null
    }
    const worldVertices = mesh.vertices.map((v) => localToWorld(v.x, v.y, transform))
    const threshold =
      EDGE_HIT_THRESHOLD / Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY), 0.1)
    const thresholdSq = threshold * threshold

    const edges = extractEdges(mesh)
    let bestDistSq = thresholdSq
    let bestEdge: MeshEdge | null = null

    for (const edge of edges) {
      const a = worldVertices[edge.v0]
      const b = worldVertices[edge.v1]
      if (!a || !b) continue
      const distSq = pointToSegmentDistanceSq(worldX, worldY, a.x, a.y, b.x, b.y)
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestEdge = edge
      }
    }
    return bestEdge
  }

  hitTestFace(worldX: number, worldY: number, scene: Scene, meshEditNodeId: string): number | null {
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return null
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#resolveTransform(scene, meshEditNodeId)
    if (!transform) {
      return null
    }
    const worldVertices = mesh.vertices.map((v) => localToWorld(v.x, v.y, transform))

    // Test faces in reverse order (topmost first)
    for (let i = mesh.faces.length - 1; i >= 0; i--) {
      const face = mesh.faces[i]
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

  verticesInRect(rect: WorldRect, scene: Scene, meshEditNodeId: string): number[] {
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return []
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#resolveTransform(scene, meshEditNodeId)
    if (!transform) {
      return []
    }
    const hits: number[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i]
      const { x: wx, y: wy } = localToWorld(v.x, v.y, transform)
      if (wx >= rect.minX && wx <= rect.maxX && wy >= rect.minY && wy <= rect.maxY) {
        hits.push(i)
      }
    }
    return hits
  }

  edgesInRect(rect: WorldRect, scene: Scene, meshEditNodeId: string): MeshEdge[] {
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return []
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#resolveTransform(scene, meshEditNodeId)
    if (!transform) {
      return []
    }
    const worldVertices = mesh.vertices.map((v) => localToWorld(v.x, v.y, transform))
    const edges = extractEdges(mesh)
    const hits: MeshEdge[] = []
    for (const edge of edges) {
      const a = worldVertices[edge.v0]
      const b = worldVertices[edge.v1]
      if (!a || !b) continue
      const aInside = a.x >= rect.minX && a.x <= rect.maxX && a.y >= rect.minY && a.y <= rect.maxY
      const bInside = b.x >= rect.minX && b.x <= rect.maxX && b.y >= rect.minY && b.y <= rect.maxY
      if (aInside || bInside) {
        hits.push({ v0: edge.v0, v1: edge.v1 })
      }
    }
    return hits
  }

  facesInRect(rect: WorldRect, scene: Scene, meshEditNodeId: string): number[] {
    const node = scene.getNode(meshEditNodeId)
    if (!node || !node.components.mesh) {
      return []
    }
    const mesh = node.components.mesh.mesh
    const transform = this.#resolveTransform(scene, meshEditNodeId)
    if (!transform) {
      return []
    }
    const worldVertices = mesh.vertices.map((v) => localToWorld(v.x, v.y, transform))
    const hits: number[] = []
    for (let i = 0; i < mesh.faces.length; i++) {
      const face = mesh.faces[i]
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (!v0 || !v1 || !v2) continue
      const inside = (p: { x: number; y: number }) =>
        p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
      if (inside(v0) && inside(v1) && inside(v2)) {
        hits.push(i)
      }
    }
    return hits
  }
}
