import type { EnginePublic } from '../../engine'
import type { Scene } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { useIKSelectionStore } from '../../stores/ikSelectionStore'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'

export const TARGET_COLOR = 0x1a73e8
export const TARGET_SELECTED_COLOR = 0xff6d00
const TARGET_SIZE = 10
export const POLE_COLOR = 0x9c27b0
export const POLE_SELECTED_COLOR = 0xff6d00
const POLE_SIZE = 8

export interface IkOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
}

export class IkOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  #graphics: PixiGraphics | null = null
  #unsubscribeEngine: Unsubscribe | null = null
  #unsubscribeSelection: Unsubscribe | null = null
  #attached = false

  constructor(context: IkOverlayContext) {
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
    graphics.label = 'ik-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    this.#unsubscribeEngine = this.#engine.subscribe((event) => {
      if (
        event.type === 'IKTargetChanged' ||
        event.type === 'IKPoleTargetChanged' ||
        event.type === 'IKChainCreated' ||
        event.type === 'IKChainDeleted' ||
        event.type === 'TransformChanged' ||
        event.type === 'ProjectLoaded' ||
        event.type === 'SlideActivated'
      ) {
        useIKSelectionStore.getState().selectChain(null)
        this.redraw()
      }
    })
    this.#unsubscribeSelection = useIKSelectionStore.subscribe(() => this.redraw())
    this.redraw()
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#unsubscribeEngine?.()
    this.#unsubscribeEngine = null
    this.#unsubscribeSelection?.()
    this.#unsubscribeSelection = null
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
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const slide = this.#engine.getActiveSlide()
    if (!slide) {
      return
    }
    const ikManager = this.#engine.getIKManager()
    const chains = ikManager.getChainsForSlide(slide.id)
    const selectedChainId = useIKSelectionStore.getState().selectedChainId

    for (const chain of chains) {
      const isSelected = chain.id === selectedChainId
      this.#drawTarget(graphics, chain.target.position.x, chain.target.position.y, isSelected)
      if (chain.poleTarget) {
        this.#drawPole(
          graphics,
          chain.poleTarget.position.x,
          chain.poleTarget.position.y,
          isSelected,
        )
      }
    }
  }

  #drawTarget(graphics: PixiGraphics, x: number, y: number, selected: boolean): void {
    const color = selected ? TARGET_SELECTED_COLOR : TARGET_COLOR
    const s = TARGET_SIZE
    graphics
      .moveTo(x, y - s)
      .lineTo(x + s, y)
      .lineTo(x, y + s)
      .lineTo(x - s, y)
      .closePath()
      .fill({ color, alpha: 0.9 })
      .stroke({ width: 2, color: 0xffffff })
  }

  #drawPole(graphics: PixiGraphics, x: number, y: number, selected: boolean): void {
    const color = selected ? POLE_SELECTED_COLOR : POLE_COLOR
    const s = POLE_SIZE
    graphics
      .moveTo(x, y - s)
      .lineTo(x + s, y + s)
      .lineTo(x - s, y + s)
      .closePath()
      .fill({ color, alpha: 0.9 })
      .stroke({ width: 2, color: 0xffffff })
  }

  hitTestTarget(
    worldX: number,
    worldY: number,
  ): { chainId: string; kind: 'target' | 'pole' } | null {
    const slide = this.#engine.getActiveSlide()
    if (!slide) {
      return null
    }
    const ikManager = this.#engine.getIKManager()
    const chains = ikManager.getChainsForSlide(slide.id)
    const threshold = TARGET_SIZE + 4

    for (const chain of chains) {
      const tx = chain.target.position.x
      const ty = chain.target.position.y
      if (Math.hypot(worldX - tx, worldY - ty) <= threshold) {
        return { chainId: chain.id, kind: 'target' }
      }
      if (chain.poleTarget) {
        const px = chain.poleTarget.position.x
        const py = chain.poleTarget.position.y
        if (Math.hypot(worldX - px, worldY - py) <= threshold) {
          return { chainId: chain.id, kind: 'pole' }
        }
      }
    }
    return null
  }
}
