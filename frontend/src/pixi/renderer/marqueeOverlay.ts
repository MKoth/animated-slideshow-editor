import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { ViewportTransform, WorldRect } from './worldGeometry'

const MARQUEE_FILL_COLOR = 0x1a73e8
const MARQUEE_FILL_ALPHA = 0.08
const MARQUEE_STROKE_COLOR = 0x1a73e8
const MARQUEE_STROKE_ALPHA = 0.6
const MARQUEE_STROKE_WIDTH = 1

export class MarqueeOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #getCameraTransform?: () => ViewportTransform | null
  #graphics: PixiGraphics | null = null
  #attached = false
  #lastRect: WorldRect | null = null
  #lastCameraScale: number | null = null

  constructor(
    pixi: RendererPixi,
    world: PixiContainer,
    getCameraTransform?: () => ViewportTransform | null,
  ) {
    this.#pixi = pixi
    this.#world = world
    this.#getCameraTransform = getCameraTransform
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
    graphics.label = 'marquee-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#graphics?.destroy()
    this.#graphics = null
  }

  bringToFront(): void {
    const graphics = this.#graphics
    if (graphics) {
      this.#world.addChild(graphics)
    }
  }

  handleTick(): void {
    if (!this.#attached || !this.#lastRect) return
    const scale = this.#cameraScale()
    if (this.#lastCameraScale === null || Math.abs(scale - this.#lastCameraScale) > 1e-6) {
      this.show(this.#lastRect)
    }
  }

  show(rect: WorldRect): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    this.#lastRect = rect
    this.#lastCameraScale = this.#cameraScale()
    const strokeWidth = MARQUEE_STROKE_WIDTH / this.#lastCameraScale
    graphics.clear()
    const x = rect.minX
    const y = rect.minY
    const w = rect.maxX - rect.minX
    const h = rect.maxY - rect.minY
    graphics.rect(x, y, w, h).fill({ color: MARQUEE_FILL_COLOR, alpha: MARQUEE_FILL_ALPHA })
    graphics.rect(x, y, w, h).stroke({
      width: strokeWidth,
      color: MARQUEE_STROKE_COLOR,
      alpha: MARQUEE_STROKE_ALPHA,
    })
  }

  clear(): void {
    this.#lastRect = null
    this.#lastCameraScale = null
    this.#graphics?.clear()
  }
}
