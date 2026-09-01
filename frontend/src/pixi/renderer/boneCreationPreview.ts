import type { RendererPixi, PixiContainer, PixiGraphics } from './pixi'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { useBoneCreationStore } from '../../stores/boneCreationStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'

export interface BoneCreationPreviewContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly canvas: HTMLCanvasElement
  readonly getCameraTransform: () => ViewportTransform | null
}

export class BoneCreationPreview {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #canvas: HTMLCanvasElement
  readonly #getCameraTransform: () => ViewportTransform | null
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeMode: (() => void) | null = null
  #unsubscribeBone: (() => void) | null = null

  constructor(context: BoneCreationPreviewContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#canvas = context.canvas
    this.#getCameraTransform = context.getCameraTransform
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    const graphics = new this.#pixi.Graphics()
    graphics.label = 'bone-creation-preview'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    window.addEventListener('mousemove', this.#onMouseMove)
    this.#unsubscribeMode = useEditingModeStore.subscribe(({ mode }) => {
      if (mode !== 'boneCreation') {
        useBoneCreationStore.getState().clear()
        this.#graphics?.clear()
      }
    })
    this.#unsubscribeBone = useBoneCreationStore.subscribe((state) => {
      if (!state.pendingStart) {
        this.#graphics?.clear()
      }
    })
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    window.removeEventListener('mousemove', this.#onMouseMove)
    this.#unsubscribeMode?.()
    this.#unsubscribeMode = null
    this.#unsubscribeBone?.()
    this.#unsubscribeBone = null
    this.#graphics?.destroy()
    this.#graphics = null
  }

  bringToFront(): void {
    if (this.#graphics) this.#world.addChild(this.#graphics)
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    const { mode } = useEditingModeStore.getState()
    const pendingStart = useBoneCreationStore.getState().pendingStart
    if (mode !== 'boneCreation' || !pendingStart) {
      return
    }
    const camera = this.#getCameraTransform()
    if (!camera) {
      this.#graphics?.clear()
      return
    }
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      this.#graphics?.clear()
      return
    }
    this.#redraw(pendingStart, point)
  }

  #redraw(
    start: import('./worldGeometry').WorldPoint,
    end: import('./worldGeometry').WorldPoint,
  ): void {
    const g = this.#graphics
    if (!g) return
    g.clear()
    // dashed shaft
    const dx = end.x - start.x
    const dy = end.y - start.y
    const len = Math.hypot(dx, dy)
    if (len < 0.01) {
      g.circle(start.x, start.y, 5)
        .fill({ color: 0xff0000, alpha: 0.35 })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.7 })
      return
    }
    const nx = dx / len
    const ny = dy / len
    const dash = 10
    const gap = 6
    let pos = 0
    while (pos < len) {
      const sX = start.x + nx * pos
      const sY = start.y + ny * pos
      const ePos = Math.min(pos + dash, len)
      const eX = start.x + nx * ePos
      const eY = start.y + ny * ePos
      g.moveTo(sX, sY).lineTo(eX, eY).stroke({ width: 4, color: 0xff0000, alpha: 0.55 })
      pos += dash + gap
    }
    // endpoint handles semi-transparent
    g.circle(start.x, start.y, 6)
      .fill({ color: 0xff0000, alpha: 0.35 })
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 })
    g.circle(end.x, end.y, 6)
      .fill({ color: 0xff0000, alpha: 0.35 })
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 })
    // length hint at midpoint
    // midpoint line already, no text (pixi text would need extra)
  }
}
