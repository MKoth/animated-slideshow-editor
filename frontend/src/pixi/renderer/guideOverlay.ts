import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldRect } from './worldGeometry'

export const GUIDE_COLOR = 0xff3b5c
export const GUIDE_WIDTH = 2

export class GuideOverlay {
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

  show(vertical: readonly number[], horizontal: readonly number[], span: WorldRect): void {
    const graphics = this.#graphics
    if (!graphics) {
      return
    }
    graphics.clear()
    for (const x of vertical) {
      graphics
        .moveTo(x, span.minY)
        .lineTo(x, span.maxY)
        .stroke({ width: GUIDE_WIDTH, color: GUIDE_COLOR })
    }
    for (const y of horizontal) {
      graphics
        .moveTo(span.minX, y)
        .lineTo(span.maxX, y)
        .stroke({ width: GUIDE_WIDTH, color: GUIDE_COLOR })
    }
  }

  clear(): void {
    this.#graphics?.clear()
  }
}
