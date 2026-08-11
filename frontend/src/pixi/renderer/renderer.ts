import type { EngineReadOnly } from '../../engine'
import type { EngineEvent } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { Camera } from './camera'
import { createAxisLines } from './axisLines'
import { DevOverlay } from './devOverlay'
import { ErrorOverlay } from './errorOverlay'
import { DEFAULT_MAJOR_COLOR, DEFAULT_MINOR_COLOR, GridRenderer } from './gridRenderer'
import { realPixi } from './pixi'
import type { PixiApplication, RendererPixi } from './pixi'
import { SceneRenderer } from './sceneRenderer'

const DEFAULT_CANVAS_BACKGROUND = 0xffffff

interface GridColors {
  minorColor: number
  majorColor: number
  canvasBackground: number
}

export class Renderer {
  readonly #host: HTMLElement
  readonly #engine: EngineReadOnly
  readonly #pixi: RendererPixi
  #app: PixiApplication | null = null
  #sceneRenderer: SceneRenderer | null = null
  #camera: Camera | null = null
  #grid: GridRenderer | null = null
  #gridColors: GridColors = {
    minorColor: DEFAULT_MINOR_COLOR,
    majorColor: DEFAULT_MAJOR_COLOR,
    canvasBackground: DEFAULT_CANVAS_BACKGROUND,
  }
  #themeKey: string | null = null
  #overlay: ErrorOverlay | null = null
  #devOverlay: DevOverlay | null = null
  #unsubscribe: Unsubscribe | null = null
  #started = false
  #disposed = false

  constructor(host: HTMLElement, engine: EngineReadOnly, pixi: RendererPixi = realPixi) {
    this.#host = host
    this.#engine = engine
    this.#pixi = pixi
  }

  async start(): Promise<void> {
    if (this.#started) {
      return
    }
    this.#started = true
    this.#overlay = new ErrorOverlay(this.#host)
    try {
      const app = new this.#pixi.Application()
      await app.init({
        background: '#ffffff',
        resizeTo: this.#host,
        autoDensity: true,
        antialias: true,
      })
      if (this.#disposed) {
        app.destroy()
        return
      }
      this.#app = app
      this.#host.appendChild(app.canvas)

      const world = new this.#pixi.Container()
      world.label = 'world'
      this.#camera = new Camera(world)
      this.#grid = new GridRenderer(this.#pixi, world)
      world.addChild(createAxisLines(this.#pixi))
      app.stage.addChild(world)

      this.#sceneRenderer = new SceneRenderer(this.#engine, world, this.#pixi)
      this.#unsubscribe = this.#engine.subscribe((event) => this.#handleEvent(event))
      this.#syncScene(this.#sceneRenderer)

      app.ticker.add(this.#tick)
      if (import.meta.env.DEV) {
        this.#devOverlay = new DevOverlay(this.#host)
      }
      this.#tick()
    } catch (error) {
      this.#reportFailure(error)
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#sceneRenderer = null
    const app = this.#app
    app?.ticker.remove(this.#tick)
    this.#app = null
    this.#devOverlay?.hide()
    this.#devOverlay = null
    this.#overlay?.hide()
    this.#overlay = null
    if (app) {
      app.canvas.remove()
      app.destroy()
    }
  }

  readonly #tick = (): void => {
    try {
      this.#applyTick()
      this.#overlay?.hide()
    } catch (error) {
      this.#reportFailure(error)
    }
  }

  #applyTick(): void {
    const app = this.#app
    const sceneRenderer = this.#sceneRenderer
    const camera = this.#camera
    const grid = this.#grid
    if (!app || !sceneRenderer || !camera || !grid) {
      return
    }
    const cameraNode = sceneRenderer.boundCamera
    const transform = cameraNode?.transform
    const x = transform?.x ?? 0
    const y = transform?.y ?? 0
    const zoomX = transform?.scaleX ?? 1
    const zoomY = transform?.scaleY ?? 1
    this.#refreshGridColors()
    camera.apply(cameraNode)
    grid.update({
      cameraX: x,
      cameraY: y,
      zoomX,
      zoomY,
      viewWidth: app.screen.width,
      viewHeight: app.screen.height,
      minorColor: this.#gridColors.minorColor,
      majorColor: this.#gridColors.majorColor,
      pixelRatio: window.devicePixelRatio || 1,
    })
    app.renderer.background.color = this.#gridColors.canvasBackground
    const devOverlay = this.#devOverlay
    if (devOverlay) {
      devOverlay.update({
        fps: app.ticker.FPS,
        cameraX: x,
        cameraY: y,
        zoom: zoomX,
        nodeCount: sceneRenderer.renderedNodeCount,
      })
    }
  }

  #refreshGridColors(): void {
    const themeKey = document.documentElement.getAttribute('data-theme')
    if (themeKey === this.#themeKey) {
      return
    }
    this.#themeKey = themeKey
    this.#gridColors = resolveGridColors(this.#host)
  }
  #handleEvent(event: EngineEvent): void {
    if (!this.#app) {
      return
    }
    try {
      this.#applyEvent(event)
      this.#overlay?.hide()
    } catch (error) {
      this.#reportFailure(error)
    }
  }

  #applyEvent(event: EngineEvent): void {
    const sceneRenderer = this.#sceneRenderer
    if (!sceneRenderer) {
      return
    }
    switch (event.type) {
      case 'ProjectCreated':
      case 'SlideCreated':
      case 'SlideRemoved':
        this.#syncScene(sceneRenderer)
        break
      case 'NodeCreated':
        sceneRenderer.handleNodeCreated(event.nodeId)
        break
      case 'NodeRemoved':
        sceneRenderer.handleNodeRemoved(event.nodeId)
        break
      case 'TransformChanged':
        sceneRenderer.handleTransformChanged(event.nodeId)
        break
      case 'VisibilityChanged':
        sceneRenderer.handleVisibilityChanged(event.nodeId)
        break
    }
  }

  #syncScene(sceneRenderer: SceneRenderer): void {
    const firstSlide = this.#engine.project?.slides[0]
    const scene = firstSlide ? firstSlide.scene : null
    if (sceneRenderer.boundSceneId !== (scene?.id ?? null)) {
      sceneRenderer.bind(scene)
    }
  }

  #reportFailure(error: unknown): void {
    this.#overlay?.show(error)
    console.error('[renderer] rendering failure:', error)
  }
}

function resolveGridColors(host: HTMLElement): GridColors {
  const style = getComputedStyle(host)
  return {
    minorColor: parseGridColor(style.getPropertyValue('--grid-minor')) ?? DEFAULT_MINOR_COLOR,
    majorColor: parseGridColor(style.getPropertyValue('--grid-major')) ?? DEFAULT_MAJOR_COLOR,
    canvasBackground:
      parseGridColor(style.getPropertyValue('--canvas-background')) ?? DEFAULT_CANVAS_BACKGROUND,
  }
}

function parseGridColor(value: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim())
  return match ? parseInt(match[1], 16) : null
}
