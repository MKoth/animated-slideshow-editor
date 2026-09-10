import type { EnginePublic, Scene } from '../../engine'
import type { MeshData, MeshEdge } from '../../engine/mesh'
import { extractEdges, edgeKey } from '../../engine/mesh'
import { walkPreOrder } from '../../engine/sceneNode'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useMeshPreviewStore } from '../../stores/meshPreviewStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'
import { useShapePreviewStore } from '../../stores/shapePreviewStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { ViewportTransform, WorldTransform, WorldRect } from './worldGeometry'
import {
  worldTransformOf,
  pivotOffsetAndSizeFor,
  localToWorldWithPivot,
} from '../../engine/worldTransform'
import type { WorldTransformSource } from './hitTest'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'

const WIREFRAME_COLOR = 0x1a73e8
const WIREFRAME_WIDTH = 1.5
const VERTEX_FILL = 0x1a73e8
const VERTEX_SELECTED_FILL = 0xff0000
const VERTEX_STROKE_COLOR = 0x1a73e8
const VERTEX_STROKE_WIDTH = 1.5

const EDGE_SELECTED_COLOR = 0x34a853
const EDGE_SELECTED_WIDTH = 3

const FACE_SELECTED_COLOR = 0x34a853
const FACE_SELECTED_ALPHA = 0.2

const PREVIEW_FILL_COLOR = 0x8ab4f8
const PREVIEW_FILL_ALPHA = 0.3
const PREVIEW_WIREFRAME_COLOR = 0x1a73e8
const PREVIEW_WIREFRAME_ALPHA = 0.5
const PREVIEW_WIREFRAME_WIDTH = 1

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

function activeShapeFallback(
  mesh: MeshData,
  nodeId: string,
  engine: EnginePublic,
): MeshData | null {
  try {
    const state = useMeshEditStore.getState()
    if (state.meshEditNodeId !== nodeId || !state.activeShapeId) return null
    const node = engine.getNode(nodeId)
    try {
      const binding = (
        engine as unknown as { getMorphBinding?: (id: string) => unknown }
      ).getMorphBinding?.(nodeId) as { fromShapeId: string | null; toShapeId: string | null } | null
      if (binding && binding.fromShapeId && binding.toShapeId) return null
    } catch {
      // ignore
    }
    const shape = node.components.mesh?.shapes?.find((s) => s.id === state.activeShapeId)
    if (shape) return { ...mesh, vertices: shape.vertices as unknown as MeshData['vertices'] }
  } catch {
    // ignore
  }
  return null
}

function getDeformedVertices(
  mesh: MeshData,
  scene: Scene,
  meshTransform: WorldTransform,
  getWorldTransform?: WorldTransformSource,
  engine?: EnginePublic,
  nodeId?: string,
  time?: number,
): { x: number; y: number }[] {
  // Shape preview (inspector) has highest priority — bypass morph
  if (engine && nodeId) {
    const previewMesh = effectiveMeshForPreview(mesh, nodeId, engine)
    if (previewMesh !== mesh) {
      const boneTransforms = computeBoneWorldTransforms(scene, getWorldTransform)
      if (
        !previewMesh.boneWeights ||
        previewMesh.boneWeights.length === 0 ||
        boneTransforms.size === 0
      ) {
        return previewMesh.vertices.map((v) => ({ x: v.x, y: v.y }))
      }
      const result = evaluateMeshDeformation(previewMesh, boneTransforms, meshTransform)
      return result.deformedVertices.map((v) => ({ x: v.x, y: v.y }))
    }
  }
  // If engine is available and nodeId/time provided, use engine's morph-aware deformation (morph-then-bones)
  if (engine && nodeId !== undefined && time !== undefined) {
    try {
      const boneTransforms = computeBoneWorldTransforms(scene, getWorldTransform)
      const result = engine.evaluateMeshDeformation(nodeId, time, boneTransforms, meshTransform)
      if (result) {
        const deformed = result.deformedVertices.map((v) => ({ x: v.x, y: v.y }))
        // Fallback: show activeShape immediately without morph binding (visible without coeff)
        if (engine && nodeId) {
          const fallbackMesh = activeShapeFallback(mesh, nodeId, engine)
          if (fallbackMesh) {
            const rawDeformed = (() => {
              if (!mesh.boneWeights || mesh.boneWeights.length === 0)
                return mesh.vertices.map((v) => ({ x: v.x, y: v.y }))
              const bt = computeBoneWorldTransforms(scene, getWorldTransform)
              if (bt.size === 0) return mesh.vertices.map((v) => ({ x: v.x, y: v.y }))
              return evaluateMeshDeformation(mesh, bt, meshTransform).deformedVertices.map((v) => ({
                x: v.x,
                y: v.y,
              }))
            })()
            let isUnmorphed = deformed.length === rawDeformed.length
            if (isUnmorphed) {
              for (let i = 0; i < deformed.length; i++) {
                if (
                  Math.abs(deformed[i].x - rawDeformed[i].x) > 1e-6 ||
                  Math.abs(deformed[i].y - rawDeformed[i].y) > 1e-6
                ) {
                  isUnmorphed = false
                  break
                }
              }
            }
            if (isUnmorphed) {
              const bt2 = computeBoneWorldTransforms(scene, getWorldTransform)
              const fb = evaluateMeshDeformation(
                fallbackMesh,
                bt2,
                meshTransform,
              ).deformedVertices.map((v) => ({ x: v.x, y: v.y }))
              let differs = fb.length !== deformed.length
              if (!differs) {
                for (let i = 0; i < fb.length; i++) {
                  if (
                    Math.abs(fb[i].x - deformed[i].x) > 1e-6 ||
                    Math.abs(fb[i].y - deformed[i].y) > 1e-6
                  ) {
                    differs = true
                    break
                  }
                }
              }
              if (differs) return fb
            }
          }
        }
        return deformed
      }
    } catch {
      // fall through to non-morph path
    }
  }
  // Non-engine path but still apply fallback for activeShape when no preview
  if (engine && nodeId) {
    const fallback = activeShapeFallback(mesh, nodeId, engine)
    if (fallback) {
      const bt = computeBoneWorldTransforms(scene, getWorldTransform)
      if (!fallback.boneWeights || fallback.boneWeights.length === 0 || bt.size === 0) {
        return fallback.vertices.map((v) => ({ x: v.x, y: v.y }))
      }
      const r = evaluateMeshDeformation(fallback, bt, meshTransform)
      return r.deformedVertices.map((v) => ({ x: v.x, y: v.y }))
    }
  }
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

function effectiveMeshForPreview(mesh: MeshData, nodeId: string, engine: EnginePublic): MeshData {
  const preview = useShapePreviewStore.getState()
  if (preview.previewNodeId !== nodeId || !preview.previewShapeId) return mesh
  try {
    const node = engine.getNode(nodeId)
    const shapes = node.components.mesh?.shapes
    const shape = shapes?.find((s) => s.id === preview.previewShapeId)
    if (shape) {
      return { ...mesh, vertices: shape.vertices as unknown as MeshData['vertices'] }
    }
  } catch (_e) {
    void _e
  }
  return mesh
}

export interface MeshOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getWorldTransform?: WorldTransformSource
  readonly getCameraTransform?: () => ViewportTransform | null
  readonly getTime?: () => number
}

const localToWorld = localToWorldWithPivot

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
  readonly #getCameraTransform?: () => ViewportTransform | null
  readonly #getTime?: () => number
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeMeshEdit: (() => void) | null = null
  #unsubscribeSelection: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null
  #previewVertices: Map<number, { x: number; y: number }> | null = null
  #unsubscribePreview: (() => void) | null = null
  #unsubscribeShapePreview: (() => void) | null = null
  #unsubscribeVisibility: (() => void) | null = null
  #lastCameraScale: number | null = null

  constructor(context: MeshOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getWorldTransform = context.getWorldTransform
    this.#getCameraTransform = context.getCameraTransform
    this.#getTime = context.getTime
  }

  #currentTime(): number {
    try {
      const t = this.#getTime?.()
      if (typeof t === 'number' && Number.isFinite(t)) return t
    } catch {
      // ignore
    }
    // fallback: try to get from engine active slide time via worldTransform source? Use 0
    return 0
  }

  #cameraScale(): number {
    const cam = this.#getCameraTransform?.()
    if (!cam) return 1
    return Math.max(Math.abs(cam.scaleX), Math.abs(cam.scaleY), 0.1)
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
    this.#unsubscribePreview = useMeshPreviewStore.subscribe(() => this.redraw())
    this.#unsubscribeShapePreview = useShapePreviewStore.subscribe(() => this.redraw())
    this.#unsubscribeVisibility = useOverlayVisibilityStore.subscribe(() => this.redraw())
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
    this.#unsubscribePreview?.()
    this.#unsubscribePreview = null
    this.#unsubscribeShapePreview?.()
    this.#unsubscribeShapePreview = null
    this.#unsubscribeVisibility?.()
    this.#unsubscribeVisibility = null
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

  #worldVerticesFor(
    scene: Scene,
    nodeId: string,
    preview?: Map<number, { x: number; y: number }> | null,
  ): { x: number; y: number }[] | null {
    const node = scene.getNode(nodeId)
    if (!node || !node.components.mesh) return null
    const mesh = effectiveMeshForPreview(node.components.mesh.mesh, nodeId, this.#engine)
    const transform = this.#resolveTransform(scene, nodeId)
    if (!transform) return null
    const time = this.#currentTime()
    const deformed = getDeformedVertices(
      mesh,
      scene,
      transform,
      this.#getWorldTransform,
      this.#engine,
      nodeId,
      time,
    )
    const pivotOffset = pivotOffsetAndSizeFor(deformed, node)
    // When a preview drag is active, the preview positions are in mesh-local
    // but the pivot offset must still be derived from the base deformed bbox,
    // otherwise the wireframe drifts from the rendered mesh when pivot != 0.
    return deformed.map((v, i) => {
      const p = preview?.get(i)
      const lx = p ? p.x : v.x
      const ly = p ? p.y : v.y
      // For preview points, use the same pivotOffset (from base deformed) so
      // the dragged vertex stays correctly offset from the pivot.
      return localToWorld(lx, ly, transform, pivotOffset)
    })
  }

  setPreviewVertices(positions: Map<number, { x: number; y: number }>): void {
    this.#previewVertices = positions
  }

  clearPreviewVertices(): void {
    this.#previewVertices = null
  }

  worldVerticesFor(
    scene: Scene,
    nodeId: string,
    preview?: Map<number, { x: number; y: number }> | null,
  ): { x: number; y: number }[] | null {
    return this.#worldVerticesFor(scene, nodeId, preview ?? this.#previewVertices)
  }

  deformedLocalVertices(scene: Scene, nodeId: string): { x: number; y: number }[] | null {
    const node = scene.getNode(nodeId)
    if (!node || !node.components.mesh) return null
    const mesh = effectiveMeshForPreview(node.components.mesh.mesh, nodeId, this.#engine)
    const transform = this.#resolveTransform(scene, nodeId)
    if (!transform) return null
    const time = this.#currentTime()
    return getDeformedVertices(
      mesh,
      scene,
      transform,
      this.#getWorldTransform,
      this.#engine,
      nodeId,
      time,
    )
  }

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    if (!useOverlayVisibilityStore.getState().meshVisible) {
      return
    }
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
      const rawMesh = node.components.mesh.mesh
      const mesh = effectiveMeshForPreview(rawMesh, meshEditNodeId, this.#engine)
      const transform = this.#resolveTransform(scene, meshEditNodeId)
      if (!transform) {
        return
      }
      this.#drawMesh(graphics, mesh, transform, scene, meshEditNodeId)
    } else {
      for (const node of walkPreOrder(scene.root)) {
        if (!node.components.mesh || !node.visible) {
          continue
        }
        const transform = this.#resolveTransform(scene, node.id)
        if (!transform) {
          continue
        }
        const rawMesh = node.components.mesh.mesh
        const mesh = effectiveMeshForPreview(rawMesh, node.id, this.#engine)
        this.#drawWireframe(graphics, mesh, transform, scene, node.id)
      }
    }
    const { previewMesh, nodeId: previewNodeId } = useMeshPreviewStore.getState()
    if (previewMesh && previewNodeId) {
      const node = scene.getNode(previewNodeId)
      if (node) {
        const transform = this.#resolveTransform(scene, previewNodeId)
        if (transform) {
          this.#drawPreview(graphics, previewMesh, transform, previewNodeId)
        }
      }
    }
  }

  #drawWireframe(
    graphics: PixiGraphics,
    mesh: MeshData,
    transform: WorldTransform,
    scene: Scene,
    nodeId?: string,
  ): void {
    const time = this.#currentTime()
    const deformed = getDeformedVertices(
      mesh,
      scene,
      transform,
      this.#getWorldTransform,
      this.#engine,
      nodeId,
      time,
    )
    const pivotOffset = nodeId
      ? pivotOffsetAndSizeFor(deformed, scene.getNode(nodeId) ?? null)
      : null
    const worldVertices = deformed.map((v) => localToWorld(v.x, v.y, transform, pivotOffset))
    const scale = this.#cameraScale()
    const wireWidth = WIREFRAME_WIDTH / scale
    for (const face of mesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1) {
        graphics
          .moveTo(v0.x, v0.y)
          .lineTo(v1.x, v1.y)
          .stroke({ width: wireWidth, color: WIREFRAME_COLOR })
      }
      if (v1 && v2) {
        graphics
          .moveTo(v1.x, v1.y)
          .lineTo(v2.x, v2.y)
          .stroke({ width: wireWidth, color: WIREFRAME_COLOR })
      }
      if (v2 && v0) {
        graphics
          .moveTo(v2.x, v2.y)
          .lineTo(v0.x, v0.y)
          .stroke({ width: wireWidth, color: WIREFRAME_COLOR })
      }
    }
  }

  #drawMesh(
    graphics: PixiGraphics,
    mesh: MeshData,
    transform: WorldTransform,
    scene: Scene,
    nodeId?: string,
  ): void {
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
    const time = this.#currentTime()
    const deformed = getDeformedVertices(
      mesh,
      scene,
      transform,
      this.#getWorldTransform,
      this.#engine,
      nodeId,
      time,
    )
    const pivotOffset = nodeId
      ? pivotOffsetAndSizeFor(deformed, scene.getNode(nodeId) ?? null)
      : null
    const worldVertices = deformed.map((v, i) => {
      const p = preview?.get(i)
      return localToWorld(p ? p.x : v.x, p ? p.y : v.y, transform, pivotOffset)
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

    // Draw wireframe edges (zoom-invariant)
    const scale = this.#cameraScale()
    const wireWidth = WIREFRAME_WIDTH / scale
    const edgeSelectedWidth = EDGE_SELECTED_WIDTH / scale
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
            width: isEdgeSelected ? edgeSelectedWidth : wireWidth,
            color: isEdgeSelected ? EDGE_SELECTED_COLOR : WIREFRAME_COLOR,
          })
      }
    }

    if (!isWeightPaint) {
      // Draw vertices (only in vertex mode) — radius is screen pixels
      if (selectMode === 'vertex') {
        const vertexSize = useOverlayVisibilityStore.getState().vertexSize
        const radiusWorld = vertexSize / scale
        const strokeWorld = VERTEX_STROKE_WIDTH / scale
        for (let i = 0; i < worldVertices.length; i++) {
          const v = worldVertices[i]
          const isSelected = selectedVertexSet.has(i)
          graphics
            .circle(v.x, v.y, radiusWorld)
            .fill({ color: isSelected ? VERTEX_SELECTED_FILL : VERTEX_FILL })
            .stroke({ width: strokeWorld, color: VERTEX_STROKE_COLOR })
        }
      }
    }
  }

  #drawPreview(
    graphics: PixiGraphics,
    mesh: MeshData,
    transform: WorldTransform,
    nodeId?: string,
  ): void {
    const scale = this.#cameraScale()
    const previewWireWidth = PREVIEW_WIREFRAME_WIDTH / scale
    const pivotOffset =
      nodeId && this.#getScene()?.getNode(nodeId)
        ? pivotOffsetAndSizeFor(
            mesh.vertices as unknown as { x: number; y: number }[],
            this.#getScene()!.getNode(nodeId)!,
          )
        : null
    const worldVertices = mesh.vertices.map((v) => localToWorld(v.x, v.y, transform, pivotOffset))
    for (const face of mesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1 && v2) {
        graphics
          .moveTo(v0.x, v0.y)
          .lineTo(v1.x, v1.y)
          .lineTo(v2.x, v2.y)
          .closePath()
          .fill({ color: PREVIEW_FILL_COLOR, alpha: PREVIEW_FILL_ALPHA })
      }
    }
    for (const face of mesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1) {
        graphics.moveTo(v0.x, v0.y).lineTo(v1.x, v1.y).stroke({
          width: previewWireWidth,
          color: PREVIEW_WIREFRAME_COLOR,
          alpha: PREVIEW_WIREFRAME_ALPHA,
        })
      }
      if (v1 && v2) {
        graphics.moveTo(v1.x, v1.y).lineTo(v2.x, v2.y).stroke({
          width: previewWireWidth,
          color: PREVIEW_WIREFRAME_COLOR,
          alpha: PREVIEW_WIREFRAME_ALPHA,
        })
      }
      if (v2 && v0) {
        graphics.moveTo(v2.x, v2.y).lineTo(v0.x, v0.y).stroke({
          width: previewWireWidth,
          color: PREVIEW_WIREFRAME_COLOR,
          alpha: PREVIEW_WIREFRAME_ALPHA,
        })
      }
    }
  }

  handleTick(): void {
    if (!this.#attached) return
    const scale = this.#cameraScale()
    if (this.#lastCameraScale === null || Math.abs(scale - this.#lastCameraScale) > 1e-6) {
      this.#lastCameraScale = scale
      this.redraw()
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
    // screen-constant picking based on camera zoom + vertexSize
    const scale = this.#cameraScale()
    const vertexSize = useOverlayVisibilityStore.getState().vertexSize
    const hitRadius = (vertexSize + 2) / scale + 3 / scale
    const worldVertices = this.#worldVerticesFor(scene, meshEditNodeId, this.#previewVertices)
    if (!worldVertices) return null
    // Return nearest within radius, not first in array order (fixes edge vs interior snap)
    let bestIdx: number | null = null
    let bestDist = Infinity
    for (let i = 0; i < worldVertices.length; i++) {
      const v = worldVertices[i]
      const dist = Math.hypot(worldX - v.x, worldY - v.y)
      if (dist <= hitRadius && dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    return bestIdx
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
    const worldVertices = this.#worldVerticesFor(scene, meshEditNodeId, this.#previewVertices)
    if (!worldVertices) return null
    const scale = this.#cameraScale()
    const threshold = EDGE_HIT_THRESHOLD / scale
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
    const worldVertices = this.#worldVerticesFor(scene, meshEditNodeId, this.#previewVertices)
    if (!worldVertices) return null

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
    const worldVertices = this.#worldVerticesFor(scene, meshEditNodeId, null)
    if (!worldVertices) return []
    const hits: number[] = []
    for (let i = 0; i < worldVertices.length; i++) {
      const v = worldVertices[i]
      if (v.x >= rect.minX && v.x <= rect.maxX && v.y >= rect.minY && v.y <= rect.maxY) {
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
    const worldVertices = this.#worldVerticesFor(scene, meshEditNodeId, null)
    if (!worldVertices) return []
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
    const worldVertices = this.#worldVerticesFor(scene, meshEditNodeId, null)
    if (!worldVertices) return []
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
