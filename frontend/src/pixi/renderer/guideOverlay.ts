import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { ViewportTransform, WorldRect } from './worldGeometry'

export const GUIDE_COLOR = 0xff3b5c
export const GUIDE_WIDTH = 2

export class GuideOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #getCameraTransform?: () => ViewportTransform | null
  #graphics: PixiGraphics | null = null
  #attached = false
  #lastArgs: {
    vertical: readonly number[]
    horizontal: readonly number[]
    span: WorldRect
  } | null = null
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
    graphics.label = 'guides'
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
    if (!this.#attached || !this.#lastArgs) return
    const scale = this.#cameraScale()
    if (this.#lastCameraScale === null || Math.abs(scale - this.#lastCameraScale) > 1e-6) {
      const { vertical, horizontal, span } = this.#lastArgs
      this.show(vertical, horizontal, span)
    }
  }

  show(vertical: readonly number[], horizontal: readonly number[], span: WorldRect): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    this.#lastArgs = { vertical, horizontal, span }
    this.#lastCameraScale = this.#cameraScale()
    const width = GUIDE_WIDTH / this.#lastCameraScale
    graphics.clear()
    for (const x of vertical) {
      graphics.moveTo(x, span.minY).lineTo(x, span.maxY).stroke({ width, color: GUIDE_COLOR })
    }
    for (const y of horizontal) {
      graphics.moveTo(span.minX, y).lineTo(span.maxX, y).stroke({ width, color: GUIDE_COLOR })
    }
  }

  clear(): void {
    this.#lastArgs = null
    this.#lastCameraScale = null
    this.#graphics?.clear()
  }
}
