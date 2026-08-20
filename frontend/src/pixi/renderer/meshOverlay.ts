import type { EnginePublic, Scene } from '../../engine'
import type { MeshData } from '../../engine/mesh'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useSelectionStore } from '../../stores/selectionStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldTransform } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'

const WIREFRAME_COLOR = 0x1a73e8
const WIREFRAME_WIDTH = 1.5
const VERTEX_RADIUS = 4
const VERTEX_FILL = 0xffffff
const VERTEX_SELECTED_FILL = 0x1a73e8
const VERTEX_STROKE_COLOR = 0x1a73e8
const VERTEX_STROKE_WIDTH = 1.5

export interface MeshOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
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

export class MeshOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeMeshEdit: (() => void) | null = null
  #unsubscribeSelection: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null

  constructor(context: MeshOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#engine = context.engine
    this.#getScene = context.getScene
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

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (!meshEditNodeId) {
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
    this.#drawMesh(graphics, mesh, transform)
  }

  #drawMesh(
    graphics: PixiGraphics,
    mesh: MeshData,
    transform: WorldTransform,
  ): void {
    const { selectedVertexIndices } = useMeshEditStore.getState()
    const selectedSet = new Set(selectedVertexIndices)
    const worldVertices = mesh.vertices.map((v) => localToWorld(v.x, v.y, transform))

    for (const face of mesh.faces) {
      const v0 = worldVertices[face.v0]
      const v1 = worldVertices[face.v1]
      const v2 = worldVertices[face.v2]
      if (v0 && v1) {
        graphics.moveTo(v0.x, v0.y).lineTo(v1.x, v1.y).stroke({ width: WIREFRAME_WIDTH, color: WIREFRAME_COLOR })
      }
      if (v1 && v2) {
        graphics.moveTo(v1.x, v1.y).lineTo(v2.x, v2.y).stroke({ width: WIREFRAME_WIDTH, color: WIREFRAME_COLOR })
      }
      if (v2 && v0) {
        graphics.moveTo(v2.x, v2.y).lineTo(v0.x, v0.y).stroke({ width: WIREFRAME_WIDTH, color: WIREFRAME_COLOR })
      }
    }

    for (let i = 0; i < worldVertices.length; i++) {
      const v = worldVertices[i]
      const isSelected = selectedSet.has(i)
      graphics
        .circle(v.x, v.y, VERTEX_RADIUS)
        .fill({ color: isSelected ? VERTEX_SELECTED_FILL : VERTEX_FILL })
        .stroke({ width: VERTEX_STROKE_WIDTH, color: VERTEX_STROKE_COLOR })
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
    const transform = worldTransformOf(scene, meshEditNodeId)
    if (!transform) {
      return null
    }
    const hitRadius = VERTEX_RADIUS / Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY), 0.1) + 2
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
}
