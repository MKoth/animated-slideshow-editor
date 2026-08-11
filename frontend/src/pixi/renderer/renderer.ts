import type { EngineReadOnly } from '../../engine'
import type { EngineEvent } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { createAxisLines } from './axisLines'
import { ErrorOverlay } from './errorOverlay'
import { realPixi } from './pixi'
import type { PixiApplication, RendererPixi } from './pixi'
import { SceneRenderer } from './sceneRenderer'

export class Renderer {
  readonly #host: HTMLElement
  readonly #engine: EngineReadOnly
  readonly #pixi: RendererPixi
  #app: PixiApplication | null = null
  #sceneRenderer: SceneRenderer | null = null
  #overlay: ErrorOverlay | null = null
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
        backgroundAlpha: 0,
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
      world.addChild(createAxisLines(this.#pixi))
      app.stage.addChild(world)

      this.#sceneRenderer = new SceneRenderer(this.#engine, world, this.#pixi)
      this.#unsubscribe = this.#engine.subscribe((event) => this.#handleEvent(event))
      this.#syncScene(this.#sceneRenderer)
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
    this.#app = null
    this.#overlay?.hide()
    this.#overlay = null
    if (app) {
      app.canvas.remove()
      app.destroy()
    }
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
