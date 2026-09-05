import type { EnginePublic, Scene } from '../../engine'
import { useMeshEditStore } from '../../stores/meshEditStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform, WorldPoint } from './worldGeometry'

export interface BrushOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
}

// Colors match MeshOverlay wireframe but distinct for brush
const SCULPT_OUTER_COLOR = 0x1a73e8
const SCULPT_INNER_COLOR = 0x8ab4f8
const WEIGHT_OUTER_COLOR = 0x00acc1

export class BrushOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  #graphics: PixiGraphics | null = null
  #attached = false
  #cursor: WorldPoint | null = null
  #unsubscribeStore: (() => void) | null = null
  #unsubscribeEngine: (() => void) | null = null
  #lastScale: number | null = null

  constructor(context: BrushOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    const graphics = new this.#pixi.Graphics()
    graphics.label = 'brush-overlay'
    // Ensure it doesn't intercept pointer events (Pixi Graphics hitArea null by default)
    this.#graphics = graphics
    this.#world.addChild(graphics)

    this.#canvas.addEventListener('mousemove', this.#onMouseMove)
    this.#canvas.addEventListener('mouseleave', this.#onMouseLeave)
    // wheel/zoom without mouse move should still resize the world-space circle
    this.#canvas.addEventListener('wheel', this.#onWheel, { passive: true })
    window.addEventListener('resize', this.#onResize)

    this.#unsubscribeStore = useMeshEditStore.subscribe(() => this.redraw())
    this.#unsubscribeEngine = this.#engine.subscribe((event) => {
      if (event.type === 'MeshChanged' || event.type === 'NodeRemoved' || event.type === 'NodeCreated') {
        this.redraw()
      }
    })

    this.redraw()
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#canvas.removeEventListener('mousemove', this.#onMouseMove)
    this.#canvas.removeEventListener('mouseleave', this.#onMouseLeave)
    this.#canvas.removeEventListener('wheel', this.#onWheel)
    window.removeEventListener('resize', this.#onResize)
    this.#unsubscribeStore?.()
    this.#unsubscribeStore = null
    this.#unsubscribeEngine?.()
    this.#unsubscribeEngine = null
    this.#graphics?.destroy()
    this.#graphics = null
    this.#cursor = null
    this.#lastScale = null
  }

  bringToFront(): void {
    const g = this.#graphics
    if (g) this.#world.addChild(g)
  }

  /** Called every ticker frame — keeps radius in sync with camera zoom even without mouse move */
  handleTick(): void {
    if (!this.#attached || !this.#cursor) return
    const cam = this.#getCameraTransform()
    if (!cam) return
    const scale = Math.max(Math.abs(cam.scaleX), Math.abs(cam.scaleY), 0.1)
    if (this.#lastScale === null || Math.abs(scale - this.#lastScale) > 1e-6) {
      this.redraw()
    }
  }

  redraw(): void {
    const graphics = this.#graphics
    if (!graphics) return
    graphics.clear()

    const { meshEditNodeId, meshEditTool, sculptRadius, sculptFalloff, brushRadius } =
      useMeshEditStore.getState()

    if (!meshEditNodeId) {
      this.#cursor = null
      this.#lastScale = null
      return
    }
    if (meshEditTool !== 'sculpt' && meshEditTool !== 'weightPaint') {
      // Not a brush tool — hide cursor but keep last position for fast re-entry
      this.#lastScale = null
      return
    }
    const scene = this.#getScene()
    if (!scene) return
    // Ensure the node still exists and is a mesh (avoid showing brush over non-mesh)
    try {
      const node = scene.getNode(meshEditNodeId)
      if (!node?.components.mesh) return
    } catch {
      return
    }
    if (!this.#cursor) return

    const camera = this.#getCameraTransform()
    if (!camera) return
    const scale = Math.max(Math.abs(camera.scaleX), Math.abs(camera.scaleY), 0.1)
    this.#lastScale = scale

    const isSculpt = meshEditTool === 'sculpt'
    const radiusScreen = isSculpt ? sculptRadius : brushRadius
    if (radiusScreen <= 0) return
    const radiusWorld = radiusScreen / scale
    const cursor = this.#cursor
    const strokeW = 1.5 / scale
    const dotR = 2 / scale
    const cross = 6 / scale

    if (isSculpt) {
      // Outer = full brush extent (pow falloff reaches 0)
      graphics.circle(cursor.x, cursor.y, radiusWorld).stroke({
        width: strokeW,
        color: SCULPT_OUTER_COLOR,
        alpha: 0.95,
      })
      // Inner = 50% strength radius: solve pow(1 - d/R, falloff)=0.5 => d = R*(1 - 0.5^(1/falloff))
      const f = Math.max(0.2, sculptFalloff)
      const innerFactor = 1 - Math.pow(0.5, 1 / f)
      const innerRadius = radiusWorld * innerFactor
      // Only draw inner if visibly distinct from outer and from dot
      if (innerRadius > dotR * 1.5 && innerRadius < radiusWorld - strokeW) {
        graphics.circle(cursor.x, cursor.y, innerRadius).stroke({
          width: strokeW * 0.85,
          color: SCULPT_INNER_COLOR,
          alpha: 0.75,
        })
      }
      // Center dot
      graphics.circle(cursor.x, cursor.y, dotR).fill({ color: SCULPT_OUTER_COLOR, alpha: 0.95 })
      // Light crosshair for direction hint
      graphics
        .moveTo(cursor.x - cross, cursor.y)
        .lineTo(cursor.x + cross, cursor.y)
        .stroke({ width: strokeW * 0.7, color: SCULPT_OUTER_COLOR, alpha: 0.45 })
      graphics
        .moveTo(cursor.x, cursor.y - cross)
        .lineTo(cursor.x, cursor.y + cross)
        .stroke({ width: strokeW * 0.7, color: SCULPT_OUTER_COLOR, alpha: 0.45 })
    } else {
      // Weight paint — single circle
      graphics.circle(cursor.x, cursor.y, radiusWorld).stroke({
        width: strokeW,
        color: WEIGHT_OUTER_COLOR,
        alpha: 0.9,
      })
      graphics.circle(cursor.x, cursor.y, dotR).fill({ color: WEIGHT_OUTER_COLOR, alpha: 0.9 })
    }
  }

  readonly #onMouseMove = (e: MouseEvent): void => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (!meshEditNodeId || (meshEditTool !== 'sculpt' && meshEditTool !== 'weightPaint')) {
      if (this.#cursor) {
        this.#cursor = null
        this.redraw()
      }
      return
    }
    const camera = this.#getCameraTransform()
    if (!camera) return
    const pt = cursorToWorld(this.#canvas, camera, e.clientX, e.clientY)
    if (!pt) return
    this.#cursor = pt
    this.redraw()
  }

  readonly #onMouseLeave = (): void => {
    if (this.#cursor) {
      this.#cursor = null
      this.redraw()
    }
  }

  readonly #onWheel = (): void => {
    // Defer one frame so camera transform has updated
    requestAnimationFrame(() => this.redraw())
  }

  readonly #onResize = (): void => {
    this.redraw()
  }
}
