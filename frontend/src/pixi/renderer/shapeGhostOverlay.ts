import type { EnginePublic, Scene } from '../../engine'
import type { MeshData } from '../../engine/mesh'
import { walkPreOrder } from '../../engine/sceneNode'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useShapeGhostStore, GHOST_WIRE_ALPHA } from '../../stores/shapeGhostStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldTransform } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransformSource } from './hitTest'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'

// Ghost uses distinct warm hue vs MeshOverlay blue (0x1a73e8)
// Filled alpha from store (default 0.28), wire alpha 0.55
const GHOST_WIREFRAME_WIDTH = 1

function computeBoneWorldTransforms(
  scene: Scene,
  getWorldTransform?: WorldTransformSource,
): Map<string, WorldTransform> {
  const transforms = new Map<string, WorldTransform>()
  for (const node of walkPreOrder(scene.root)) {
    if (!node.components.bone) continue
    const wt = getWorldTransform ? getWorldTransform(node.id) : worldTransformOf(scene, node.id)
    if (wt) transforms.set(node.id, wt)
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

export interface ShapeGhostOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getWorldTransform?: WorldTransformSource
}

export class ShapeGhostOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getWorldTransform?: WorldTransformSource
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeGhost: (() => void) | null = null
  #unsubscribeMeshEdit: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null

  constructor(context: ShapeGhostOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getWorldTransform = context.getWorldTransform
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    const graphics = new this.#pixi.Graphics()
    graphics.label = 'shape-ghost-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    this.#unsubscribeGhost = useShapeGhostStore.subscribe(() => this.redraw())
    this.#unsubscribeMeshEdit = useMeshEditStore.subscribe(() => this.redraw())
    this.#unsubscribeEngine = this.#engine.subscribe((event) => {
      if (
        event.type === 'MeshChanged' ||
        event.type === 'TransformChanged' ||
        event.type === 'NodeRemoved' ||
        event.type === 'SlideActivated' ||
        event.type === 'ProjectLoaded'
      ) {
        this.redraw()
      }
    })
    this.redraw()
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#unsubscribeGhost?.()
    this.#unsubscribeGhost = null
    this.#unsubscribeMeshEdit?.()
    this.#unsubscribeMeshEdit = null
    this.#unsubscribeEngine?.()
    this.#unsubscribeEngine = null
    this.#graphics?.destroy()
    this.#graphics = null
  }

  bringToFront(): void {
    const g = this.#graphics
    if (g) this.#world.addChild(g)
  }

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) return
    graphics.clear()

    const { meshEditNodeId, meshEditTool, activeShapeId } = useMeshEditStore.getState()
    const { ghostShapeId, ghostColor, ghostAlpha } = useShapeGhostStore.getState()

    // Sculpt-only, single ghost, same mesh node
    if (!meshEditNodeId) return
    if (meshEditTool !== 'sculpt') return
    if (!ghostShapeId) return
    if (ghostShapeId === activeShapeId) return

    const scene = this.#getScene()
    if (!scene) return

    let node: ReturnType<Scene['getNode']>
    try {
      node = scene.getNode(meshEditNodeId)
    } catch {
      return
    }
    const meshComp = node?.components.mesh
    if (!meshComp) return

    const ghostShape = meshComp.shapes?.find((s) => s.id === ghostShapeId)
    if (!ghostShape) {
      // stale id (deleted) — clear
      queueMicrotask(() => useShapeGhostStore.getState().clearGhost())
      return
    }

    const baseMesh = meshComp.mesh
    const ghostMesh: MeshData = {
      ...baseMesh,
      vertices: ghostShape.vertices as unknown as MeshData['vertices'],
    }

    let meshTransform: WorldTransform | null
    if (this.#getWorldTransform) {
      meshTransform = this.#getWorldTransform(meshEditNodeId)
    } else {
      meshTransform = worldTransformOf(scene, meshEditNodeId)
    }
    if (!meshTransform) return

    const deformed = getDeformedVertices(ghostMesh, scene, meshTransform, this.#getWorldTransform)
    const worldVertices = deformed.map((v) => localToWorld(v.x, v.y, meshTransform!))

    // Draw filled ghost behind wire
    for (const face of ghostMesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1 && v2) {
        graphics
          .moveTo(v0.x, v0.y)
          .lineTo(v1.x, v1.y)
          .lineTo(v2.x, v2.y)
          .closePath()
          .fill({ color: ghostColor, alpha: ghostAlpha })
      }
    }
    // Wire on top of fill
    for (const face of ghostMesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1) {
        graphics
          .moveTo(v0.x, v0.y)
          .lineTo(v1.x, v1.y)
          .stroke({ width: GHOST_WIREFRAME_WIDTH, color: ghostColor, alpha: GHOST_WIRE_ALPHA })
      }
      if (v1 && v2) {
        graphics
          .moveTo(v1.x, v1.y)
          .lineTo(v2.x, v2.y)
          .stroke({ width: GHOST_WIREFRAME_WIDTH, color: ghostColor, alpha: GHOST_WIRE_ALPHA })
      }
      if (v2 && v0) {
        graphics
          .moveTo(v2.x, v0.y)
          .lineTo(v0.x, v0.y)
          .stroke({ width: GHOST_WIREFRAME_WIDTH, color: ghostColor, alpha: GHOST_WIRE_ALPHA })
      }
    }
  }
}
