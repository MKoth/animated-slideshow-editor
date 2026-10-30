import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { ViewportTransform, WorldRect } from './worldGeometry'

export const CAMERA_FRAME_FILL_COLOR = 0x2f7bff
export const CAMERA_FRAME_FILL_ALPHA = 0.06
export const CAMERA_FRAME_STROKE_COLOR = 0x2f7bff
export const CAMERA_FRAME_STROKE_ALPHA = 0.9
export const CAMERA_FRAME_STROKE_WIDTH = 2

export class CameraFrameOverlay {
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
    graphics.label = 'camera-frame-overlay'
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
    this.#lastRect = null
    this.#lastCameraScale = null
  }

  bringToFront(): void {
    const graphics = this.#graphics
    if (graphics) {
      this.#world.addChild(graphics)
    }
  }

  setVisible(visible: boolean): void {
    if (this.#graphics) {
      this.#graphics.visible = visible
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
    const strokeWidth = CAMERA_FRAME_STROKE_WIDTH / this.#lastCameraScale
    graphics.clear()
    const x = rect.minX
    const y = rect.minY
    const w = rect.maxX - rect.minX
    const h = rect.maxY - rect.minY
    if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) {
      return
    }
    graphics
      .rect(x, y, w, h)
      .fill({ color: CAMERA_FRAME_FILL_COLOR, alpha: CAMERA_FRAME_FILL_ALPHA })
    graphics.rect(x, y, w, h).stroke({
      width: strokeWidth,
      color: CAMERA_FRAME_STROKE_COLOR,
      alpha: CAMERA_FRAME_STROKE_ALPHA,
    })
  }

  clear(): void {
    this.#lastRect = null
    this.#lastCameraScale = null
    this.#graphics?.clear()
  }
}
