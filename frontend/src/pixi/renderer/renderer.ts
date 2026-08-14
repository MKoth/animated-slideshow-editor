import type { EnginePublic } from '../../engine'
import type { EngineEvent } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { walkPreOrder } from '../../engine/sceneNode'
import type { CommandResult, DispatchCommand } from '../../engine/commands'
import type { EvaluatedNodeScratch } from '../../engine/animationEvaluator'
import { evaluatedNodeScratch } from '../../engine/animationEvaluator'
import { EvaluatedWorldTransformSource } from '../../engine/worldTransform'
import type { ViewportTransform } from './worldGeometry'
import { useSelectionStore } from '../../stores/selectionStore'
import { useUiStore } from '../../stores/uiStore'
import { CameraControls } from './cameraControls'
import { Camera } from './camera'
import { CanvasSelection } from './canvasSelection'
import { createAxisLines } from './axisLines'
import { DevOverlay } from './devOverlay'
import { DropPlacement } from './dropPlacement'
import { ErrorOverlay } from './errorOverlay'
import { DEFAULT_GRID_STEP } from './gridSnap'
import { DEFAULT_MAJOR_COLOR, DEFAULT_MINOR_COLOR, GridRenderer } from './gridRenderer'
import { GuideOverlay } from './guideOverlay'
import { realPixi } from './pixi'
import type { PixiApplication, RendererPixi } from './pixi'
import { SceneRenderer } from './sceneRenderer'
import type { CurrentTimeSource } from './sceneRenderer'
import { ALWAYS_ZERO_TIME } from './sceneRenderer'
import { SelectionOverlay } from './selectionOverlay'
import type { ResolveAssetUrl } from './textureCache'
import { TextureCache } from './textureCache'
import { ThumbnailRecorder } from './thumbnailRecorder'
import { extractCanvasCapture } from './thumbnailRecorder'
import type { CanvasCapture } from './thumbnailRecorder'

const DEFAULT_CANVAS_BACKGROUND = 0xffffff

interface GridColors {
  minorColor: number
  majorColor: number
  canvasBackground: number
}

export class Renderer {
  readonly #host: HTMLElement
  readonly #engine: EnginePublic
  readonly #dispatch: DispatchCommand
  readonly #pixi: RendererPixi
  #app: PixiApplication | null = null
  #sceneRenderer: SceneRenderer | null = null
  #textureCache: TextureCache | null = null
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
  #controls: CameraControls | null = null
  #dropPlacement: DropPlacement | null = null
  #selection: CanvasSelection | null = null
  #selectionOverlay: SelectionOverlay | null = null
  #guideOverlay: GuideOverlay | null = null
  #transformSource: EvaluatedWorldTransformSource | null = null
  #previewPositions = new Map<string, { x: number; y: number }>()
  readonly #cameraScratch: EvaluatedNodeScratch = evaluatedNodeScratch()
  readonly #viewportScratch: ViewportTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
  #cameraPreview: ViewportTransform | null = null
  #unsubscribe: Unsubscribe | null = null
  #unsubscribeTime: Unsubscribe | null = null
  #resizeObserver: ResizeObserver | null = null
  #started = false
  #disposed = false
  readonly #resolveAssetUrl: ResolveAssetUrl
  readonly #currentTime: CurrentTimeSource
  readonly #isAssetMissing: (definitionId: string) => boolean
  readonly #thumbnails: ThumbnailRecorder

  constructor(
    host: HTMLElement,
    engine: EnginePublic,
    dispatch: DispatchCommand = noopDispatch,
    pixi: RendererPixi = realPixi,
    resolveAssetUrl: ResolveAssetUrl = () => null,
    currentTime: CurrentTimeSource = ALWAYS_ZERO_TIME,
    isAssetMissing: (definitionId: string) => boolean = () => false,
    captureThumbnail: CanvasCapture = extractCanvasCapture,
  ) {
    this.#host = host
    this.#engine = engine
    this.#dispatch = dispatch
    this.#pixi = pixi
    this.#resolveAssetUrl = resolveAssetUrl
    this.#currentTime = currentTime
    this.#isAssetMissing = isAssetMissing
    this.#thumbnails = new ThumbnailRecorder(captureThumbnail)
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

      const resizeObserver = new ResizeObserver(() => {
        app.renderer.resize(this.#host.clientWidth, this.#host.clientHeight)
      })
      resizeObserver.observe(this.#host)
      this.#resizeObserver = resizeObserver

      const world = new this.#pixi.Container()
      world.label = 'world'
      this.#camera = new Camera(world)
      this.#grid = new GridRenderer(this.#pixi, world)
      world.addChild(createAxisLines(this.#pixi))
      app.stage.addChild(world)

      this.#textureCache = new TextureCache(this.#pixi)
      this.#sceneRenderer = new SceneRenderer(
        this.#engine,
        world,
        this.#pixi,
        this.#textureCache,
        this.#resolveAssetUrl,
        () => this.#selectionOverlay?.redraw(),
        this.#currentTime,
        this.#isAssetMissing,
      )
      this.#thumbnails.attach(app)
      this.#unsubscribe = this.#engine.subscribe((event) => this.#handleEvent(event))
      this.#unsubscribeTime = this.#currentTime.subscribe(() => this.#handleTimeChanged())
      this.#syncScene(this.#sceneRenderer)

      this.#transformSource = new EvaluatedWorldTransformSource(
        this.#engine,
        () => {
          const slideId = this.#sceneRenderer?.boundSlideId ?? null
          return slideId ? this.#currentTime.getTime(slideId) : 0
        },
        this.#previewPositions,
      )
      const transformOf = (nodeId: string) => this.#transformSource?.transformOf(nodeId) ?? null

      this.#selectionOverlay = new SelectionOverlay({
        pixi: this.#pixi,
        world,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getNodeSize: (nodeId) => this.#sceneRenderer?.nodeSize(nodeId) ?? null,
        getWorldTransform: transformOf,
        subscribeTime: (listener) => this.#currentTime.subscribe(listener),
        store: useSelectionStore,
      })
      this.#selectionOverlay.attach()

      this.#guideOverlay = new GuideOverlay(this.#pixi, world)
      this.#guideOverlay.attach()
      this.#guideOverlay.bringToFront()

      this.#selection = new CanvasSelection({
        canvas: app.canvas,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getCameraTransform: () => this.#cameraTransform(),
        getNodeSize: (nodeId) => this.#sceneRenderer?.nodeSize(nodeId) ?? null,
        store: useSelectionStore.getState(),
        dispatch: this.#dispatch,
        preview: {
          setPosition: (nodeId, x, y) => {
            this.#previewPositions.set(nodeId, { x, y })
            this.#sceneRenderer?.previewTransform(nodeId, x, y)
          },
          clear: () => this.#previewPositions.clear(),
        },
        guides: {
          show: (vertical, horizontal, span) =>
            this.#guideOverlay?.show(vertical, horizontal, span),
          clear: () => this.#guideOverlay?.clear(),
        },
        onMove: () => this.#selectionOverlay?.redraw(),
        getMoveOptions: () => ({
          gridSnap: useUiStore.getState().gridSnap,
          gridStep: DEFAULT_GRID_STEP,
        }),
        getAnimationMode: () => useUiStore.getState().animationMode,
        getWorldTransform: transformOf,
      })
      this.#selection.attach()

      this.#controls = new CameraControls({
        canvas: app.canvas,
        engine: this.#engine,
        getCamera: () => this.#sceneRenderer?.boundCamera ?? null,
        getCameraTransform: () => this.#cameraTransform(),
        setCameraPreview: (transform) => {
          this.#cameraPreview = transform
        },
        getCameraAnimationMode: () => useUiStore.getState().cameraAnimationMode,
        getTime: () => {
          const slideId = this.#sceneRenderer?.boundSlideId
          return slideId ? this.#currentTime.getTime(slideId) : 0
        },
        dispatch: this.#dispatch,
      })
      this.#controls.attach()

      this.#dropPlacement = new DropPlacement({
        canvas: app.canvas,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getCameraTransform: () => this.#cameraTransform(),
        dispatch: this.#dispatch,
        getGridSnap: () => useUiStore.getState().gridSnap,
      })
      this.#dropPlacement.attach()

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
    this.#unsubscribeTime?.()
    this.#unsubscribeTime = null
    this.#thumbnails.detach()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#sceneRenderer = null
    this.#transformSource = null
    this.#controls?.detach()
    this.#controls = null
    this.#dropPlacement?.detach()
    this.#dropPlacement = null
    this.#selection?.detach()
    this.#selection = null
    this.#selectionOverlay?.detach()
    this.#selectionOverlay = null
    this.#guideOverlay?.detach()
    this.#guideOverlay = null
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
    this.#textureCache?.dispose()
    this.#textureCache = null
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
    const transform = this.#cameraTransform()
    const x = transform?.x ?? 0
    const y = transform?.y ?? 0
    const zoomX = transform?.scaleX ?? 1
    const zoomY = transform?.scaleY ?? 1
    this.#refreshGridColors()
    camera.apply(transform)
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

  #cameraTransform(): ViewportTransform | null {
    const sceneRenderer = this.#sceneRenderer
    const cameraNode = sceneRenderer?.boundCamera ?? null
    const slideId = sceneRenderer?.boundSlideId ?? null
    if (!cameraNode || !slideId) {
      return null
    }
    const out = this.#viewportScratch
    if (!useUiStore.getState().cameraAnimationMode) {
      let stored
      try {
        stored = this.#engine.getNode(cameraNode.id).transform
      } catch {
        return null
      }
      out.x = stored.x
      out.y = stored.y
      out.scaleX = stored.scaleX
      out.scaleY = stored.scaleY
    } else {
      let state
      try {
        state = this.#engine.evaluateNode(
          cameraNode.id,
          this.#currentTime.getTime(slideId),
          this.#cameraScratch,
        )
      } catch {
        return null
      }
      out.x = state.transform.x
      out.y = state.transform.y
      out.scaleX = state.transform.scaleX
      out.scaleY = state.transform.scaleY
    }
    if (out.scaleX <= 0 || out.scaleY <= 0) {
      return null
    }
    const preview = this.#cameraPreview
    if (preview) {
      out.x = preview.x
      out.y = preview.y
      out.scaleX = preview.scaleX
      out.scaleY = preview.scaleY
    }
    return out
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

  readonly #handleTimeChanged = (): void => {
    if (!this.#app) {
      return
    }
    try {
      this.#sceneRenderer?.handleTimeChanged()
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
        this.#syncScene(sceneRenderer)
        break
      case 'ProjectLoaded':
        this.#thumbnails.handleEvent(event)
        this.#syncScene(sceneRenderer)
        break
      case 'SlideCreated':
        this.#thumbnails.handleEvent(event)
        this.#syncScene(sceneRenderer)
        break
      case 'SlideActivated':
        this.#syncScene(sceneRenderer)
        this.#thumbnails.handleEvent(event)
        break
      case 'SlideRemoved':
        this.#thumbnails.handleEvent(event)
        this.#syncScene(sceneRenderer)
        break
      case 'NodeCreated':
        sceneRenderer.handleNodeCreated(event.nodeId)
        break
      case 'NodeRemoved':
        sceneRenderer.handleNodeRemoved(event.nodeId)
        this.#pruneSelectionToBoundScene()
        break
      case 'NodeReparented':
        sceneRenderer.handleNodeReparented(event.nodeId)
        break
      case 'NodeOrderChanged':
        sceneRenderer.handleNodeOrderChanged(event.nodeId)
        break
      case 'TransformChanged':
        sceneRenderer.handleTransformChanged(event.nodeId)
        break
      case 'VisibilityChanged':
        sceneRenderer.handleVisibilityChanged(event.nodeId)
        break
      case 'NodeRenamed':
        sceneRenderer.handleNodeRenamed(event.nodeId)
        break
      case 'OpacityChanged':
        sceneRenderer.handleOpacityChanged(event.nodeId)
        break
      case 'KeyframeAdded':
      case 'KeyframeRemoved':
      case 'KeyframeMoved':
      case 'KeyframeValueChanged':
        sceneRenderer.handleKeyframeChanged(event.nodeId)
        break
    }
  }

  #syncScene(sceneRenderer: SceneRenderer): void {
    const slide = this.#engine.getActiveSlide()
    const scene = slide ? slide.scene : null
    if (sceneRenderer.boundSceneId !== (scene?.id ?? null)) {
      this.#controls?.reset()
      this.#cameraPreview = null
      sceneRenderer.bind(scene, slide ? slide.id : null)
      this.#thumbnails.setBoundSlideId(slide ? slide.id : null)
      this.#selectionOverlay?.bringToFront()
      this.#guideOverlay?.bringToFront()
      useSelectionStore.getState().clear()
    }
  }

  #pruneSelectionToBoundScene(): void {
    const scene = this.#sceneRenderer?.boundScene
    const valid = new Set<string>()
    if (scene) {
      for (const node of walkPreOrder(scene.root)) {
        valid.add(node.id)
      }
      valid.add(scene.camera.id)
    }
    useSelectionStore.getState().prune(valid)
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

const noopDispatch: DispatchCommand = <Inverse>(): CommandResult<Inverse> => {
  throw new Error('The renderer needs a command dispatcher for camera controls')
}
