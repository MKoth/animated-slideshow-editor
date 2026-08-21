import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldRect } from './worldGeometry'

const MARQUEE_FILL_COLOR = 0x1a73e8
const MARQUEE_FILL_ALPHA = 0.08
const MARQUEE_STROKE_COLOR = 0x1a73e8
const MARQUEE_STROKE_ALPHA = 0.6
const MARQUEE_STROKE_WIDTH = 1

export class MarqueeOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  #graphics: PixiGraphics | null = null
  #attached = false

  constructor(pixi: RendererPixi, world: PixiContainer) {
    this.#pixi = pixi
    this.#world = world
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

  show(rect: WorldRect): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    const x = rect.minX
    const y = rect.minY
    const w = rect.maxX - rect.minX
    const h = rect.maxY - rect.minY
    graphics.rect(x, y, w, h).fill({ color: MARQUEE_FILL_COLOR, alpha: MARQUEE_FILL_ALPHA })
    graphics
      .rect(x, y, w, h)
      .stroke({
        width: MARQUEE_STROKE_WIDTH,
        color: MARQUEE_STROKE_COLOR,
        alpha: MARQUEE_STROKE_ALPHA,
      })
  }

  clear(): void {
    this.#graphics?.clear()
  }
}
