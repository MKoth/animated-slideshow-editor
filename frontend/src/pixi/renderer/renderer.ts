import type { EnginePublic } from '../../engine'
import type { EngineEvent } from '../../engine'
import type { Unsubscribe } from '../../engine'
import { walkPreOrder } from '../../engine/sceneNode'
import type { CommandResult, DispatchCommand } from '../../engine/commands'
import type { EvaluatedNodeScratch } from '../../engine/animationEvaluator'
import { evaluatedNodeScratch } from '../../engine/animationEvaluator'
import type { EffectiveShaderScratch } from '../../engine/materialResolution'
import { effectiveShaderScratch } from '../../engine/materialResolution'
import { EvaluatedWorldTransformSource } from '../../engine/worldTransform'
import type { ViewportTransform } from './worldGeometry'
import { useSelectionStore } from '../../stores/selectionStore'
import { useUiStore } from '../../stores/uiStore'
import { useEditingModeStore } from '../../stores/editingModeStore'
import type { NodeFilter } from './hitTest'
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
import { MeshOverlay } from './meshOverlay'
import { MeshEditInteraction } from './meshEditInteraction'
import { WeightPaintOverlay } from './weightPaintOverlay'
import { WeightPaintInteraction } from './weightPaintInteraction'
import { RiggingInteraction } from './riggingInteraction'
import { IkOverlay } from './ikOverlay'
import { IkInteraction } from './ikInteraction'
import { MarqueeOverlay } from './marqueeOverlay'
import { realPixi } from './pixi'
import type { PixiApplication, RendererPixi } from './pixi'
import { SceneRenderer } from './sceneRenderer'
import type { CurrentTimeSource } from './sceneRenderer'
import type { ResolveShaderSource } from './sceneRenderer'
import { ALWAYS_ZERO_TIME } from './sceneRenderer'
import { SelectionOverlay } from './selectionOverlay'
import type { ResolveAssetUrl } from './textureCache'
import { TextureCache } from './textureCache'
import { ThumbnailRecorder } from './thumbnailRecorder'
import { extractCanvasCapture } from './thumbnailRecorder'
import type { CanvasCapture } from './thumbnailRecorder'
import { ShaderProgramCache } from './programCache'
import { FullscreenPass, resolveFullscreenShaderState } from './fullscreenPass'

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
  #programCache: ShaderProgramCache | null = null
  #fullscreenPass: FullscreenPass | null = null
  readonly #fullscreenScratch: EffectiveShaderScratch = effectiveShaderScratch()
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
  #meshOverlay: MeshOverlay | null = null
  #meshEditInteraction: MeshEditInteraction | null = null
  #weightPaintOverlay: WeightPaintOverlay | null = null
  #weightPaintInteraction: WeightPaintInteraction | null = null
  #riggingInteraction: RiggingInteraction | null = null
  #ikOverlay: IkOverlay | null = null
  #ikInteraction: IkInteraction | null = null
  #marqueeOverlay: MarqueeOverlay | null = null
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
  readonly #resolveShaderSource: ResolveShaderSource
  readonly #onAssetPlaced: (definitionId: string) => void
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
    onAssetPlaced: (definitionId: string) => void = () => undefined,
    resolveShaderSource: ResolveShaderSource = () => null,
  ) {
    this.#host = host
    this.#engine = engine
    this.#dispatch = dispatch
    this.#pixi = pixi
    this.#resolveAssetUrl = resolveAssetUrl
    this.#currentTime = currentTime
    this.#isAssetMissing = isAssetMissing
    this.#resolveShaderSource = resolveShaderSource
    this.#onAssetPlaced = onAssetPlaced
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
      this.#programCache = new ShaderProgramCache(this.#pixi)
      this.#fullscreenPass = new FullscreenPass(
        this.#pixi,
        this.#programCache,
        app.stage,
        world,
        (options) => {
          app.renderer.render(options)
        },
        this.#resolveAssetUrl,
        this.#textureCache,
      )
      this.#sceneRenderer = new SceneRenderer(
        this.#engine,
        world,
        this.#pixi,
        this.#textureCache,
        this.#resolveAssetUrl,
        this.#programCache,
        () => this.#selectionOverlay?.redraw(),
        this.#currentTime,
        this.#isAssetMissing,
        this.#resolveShaderSource,
        (dataSourceId) => {
          const ds = this.#engine.embeddedDataSources.find((d) => d.id === dataSourceId)
          if (ds && 'dataPoints' in ds) {
            return ds.dataPoints
          }
          return null
        },
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
        this.#engine.getIKManager(),
        this.#engine.getConstraintManager(),
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

      this.#meshOverlay = new MeshOverlay({
        pixi: this.#pixi,
        world,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getWorldTransform: transformOf,
      })
      this.#meshOverlay.attach()
      this.#meshOverlay.bringToFront()

      this.#marqueeOverlay = new MarqueeOverlay(this.#pixi, world)
      this.#marqueeOverlay.attach()
      this.#marqueeOverlay.bringToFront()

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
        onMove: () => {
          this.#selectionOverlay?.redraw()
          this.#meshOverlay?.redraw()
        },
        getMoveOptions: () => ({
          gridSnap: useUiStore.getState().gridSnap,
          gridStep: DEFAULT_GRID_STEP,
        }),
        getAnimationMode: () => useUiStore.getState().animationMode,
        getWorldTransform: transformOf,
        getNodeFilter: (): NodeFilter | null => {
          const { mode } = useEditingModeStore.getState()
          if (mode === 'rigging') {
            return (node) => !!node.components.bone
          }
          return null
        },
        marquee: {
          show: (rect) => this.#marqueeOverlay?.show(rect),
          clear: () => this.#marqueeOverlay?.clear(),
        },
        isIKHandleAt: (worldX, worldY) =>
          this.#ikOverlay != null && this.#ikOverlay.hitTestTarget(worldX, worldY) !== null,
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
        onAssetPlaced: this.#onAssetPlaced,
      })
      this.#dropPlacement.attach()

      this.#meshEditInteraction = new MeshEditInteraction({
        canvas: app.canvas,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getCameraTransform: () => this.#cameraTransform(),
        dispatch: this.#dispatch,
        meshOverlay: this.#meshOverlay,
      })
      this.#meshEditInteraction.attach()

      this.#weightPaintOverlay = new WeightPaintOverlay({
        pixi: this.#pixi,
        world,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getWorldTransform: transformOf,
        subscribeTime: (listener) => this.#currentTime.subscribe(listener),
      })
      this.#weightPaintOverlay.attach()
      this.#weightPaintOverlay.bringToFront()

      this.#weightPaintInteraction = new WeightPaintInteraction({
        canvas: app.canvas,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getCameraTransform: () => this.#cameraTransform(),
        dispatch: this.#dispatch,
        getWorldTransform: transformOf,
      })
      this.#weightPaintInteraction.attach()

      this.#riggingInteraction = new RiggingInteraction({
        canvas: app.canvas,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
        getCameraTransform: () => this.#cameraTransform(),
        dispatch: this.#dispatch,
      })
      this.#riggingInteraction.attach()

      this.#ikOverlay = new IkOverlay({
        pixi: this.#pixi,
        world,
        engine: this.#engine,
        getScene: () => this.#sceneRenderer?.boundScene ?? null,
      })
      this.#ikOverlay.attach()
      this.#ikOverlay.bringToFront()

      this.#ikInteraction = new IkInteraction({
        canvas: app.canvas,
        engine: this.#engine,
        getCameraTransform: () => this.#cameraTransform(),
        dispatch: this.#dispatch,
        ikOverlay: this.#ikOverlay,
        onIKChanged: () => this.#handleTimeChanged(),
      })
      this.#ikInteraction.attach()

      app.ticker.add(this.#tick)
      if (import.meta.env.DEV) {
        this.#devOverlay = new DevOverlay(this.#host)
      }
      this.#tick()
    } catch (error) {
      this.#reportFailure(error)
    }
  }

  refreshAssetTextures(): void {
    this.#sceneRenderer?.refreshAssetTextures()
  }

  refreshNodeRendering(): void {
    this.#sceneRenderer?.refreshNodeRendering()
    this.#syncFullscreenShader()
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
    this.#meshOverlay?.detach()
    this.#meshOverlay = null
    this.#meshEditInteraction?.detach()
    this.#meshEditInteraction = null
    this.#weightPaintOverlay?.detach()
    this.#weightPaintOverlay = null
    this.#weightPaintInteraction?.detach()
    this.#weightPaintInteraction = null
    this.#riggingInteraction?.detach()
    this.#riggingInteraction = null
    this.#ikOverlay?.detach()
    this.#ikOverlay = null
    this.#ikInteraction?.detach()
    this.#ikInteraction = null
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
    this.#fullscreenPass?.destroy()
    this.#fullscreenPass = null
    this.#textureCache?.dispose()
    this.#textureCache = null
    this.#programCache?.dispose()
    this.#programCache = null
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
    const fullscreenPass = this.#fullscreenPass
    if (fullscreenPass) {
      fullscreenPass.resize(app.screen.width, app.screen.height)
      fullscreenPass.renderFrame()
    }
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
      const slideId = this.#sceneRenderer?.boundSlideId ?? null
      if (slideId) {
        const time = this.#currentTime.getTime(slideId)
        this.#transformSource?.updateIKOverrides(slideId, time)
      }
      this.#sceneRenderer?.handleTimeChanged()
      if (this.#transformSource) {
        const rotations = this.#transformSource.getIKOverrides()
        this.#sceneRenderer?.applyIKOverrides(rotations)
      }
      this.#sceneRenderer?.refreshDeformedMeshSizes()
      this.#sceneRenderer?.applyConstraintOverrides()
      this.#selectionOverlay?.redraw()
      this.#syncFullscreenShader()
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
        this.#handleTimeChanged()
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
      case 'MaterialAssigned':
      case 'MaterialParameterChanged':
        sceneRenderer.handleMaterialChanged(event.nodeId)
        break
      case 'SlideShaderChanged':
      case 'SlideShaderUniformChanged':
        this.#syncFullscreenShader()
        this.#thumbnails.handleEvent(event)
        break
      case 'KeyframeAdded':
      case 'KeyframeRemoved':
      case 'KeyframeMoved':
      case 'KeyframeValueChanged':
      case 'KeyframeInterpolationChanged':
      case 'KeyframeTangentsChanged':
        if (event.target.kind === 'node') {
          sceneRenderer.handleKeyframeChanged(event.target.nodeId)
        }
        break
      case 'ClipInstanceAdded':
      case 'ClipInstanceRemoved':
      case 'ClipLayerMoved':
      case 'ClipInstanceEnabledChanged':
      case 'ClipInstanceTimeChanged':
      case 'ClipInstanceSpeedChanged':
      case 'ClipParamOverridden':
        sceneRenderer.handleKeyframeChanged(event.nodeId)
        break
      case 'MeshChanged':
        sceneRenderer.handleMeshChanged(event.nodeId)
        this.#meshOverlay?.redraw()
        break
      case 'TableChanged':
        sceneRenderer.handleTableChanged(event.nodeId)
        break
      case 'TextChanged':
        sceneRenderer.handleTextChanged(event.nodeId)
        break
      case 'ChartChanged':
        sceneRenderer.handleChartChanged(event.nodeId)
        break
      case 'IKTargetChanged':
      case 'IKPoleTargetChanged':
        this.#handleTimeChanged()
        break
      case 'ConstraintAdded':
      case 'ConstraintRemoved':
      case 'ConstraintChanged':
        this.#handleTimeChanged()
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
      this.#syncFullscreenShader()
      this.#thumbnails.setBoundSlideId(slide ? slide.id : null)
      this.#selectionOverlay?.bringToFront()
      this.#guideOverlay?.bringToFront()
      this.#meshOverlay?.bringToFront()
      this.#weightPaintOverlay?.bringToFront()
      this.#ikOverlay?.bringToFront()
      useSelectionStore.getState().clear()
    }
  }

  /**
   * Resolve the active slide's fullscreen shader (definition defaults resolved
   * with slide overrides; a source that fails to resolve — unknown definition
   * or an uncompiled shader — renders without the effect while the reference
   * stays intact) and apply it to the fullscreen pass.
   */
  #syncFullscreenShader(): void {
    const pass = this.#fullscreenPass
    if (!pass) {
      return
    }
    const scratch = this.#fullscreenScratch
    const slideId = this.#sceneRenderer?.boundSlideId ?? null
    const uTimeValue = slideId ? this.#currentTime.getTime(slideId) : 0
    resolveFullscreenShaderState(this.#engine, this.#resolveShaderSource, scratch, uTimeValue)
    pass.update(scratch.source, scratch)
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
