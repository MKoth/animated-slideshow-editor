import { EventBus } from './events'
import { ProjectManager } from './projectManager'
import { SceneManager } from './sceneManager'
import { SlideManager } from './slideManager'
import { NodeManager } from './nodeManager'
import { AssetManager } from './assetManager'
import { MaterialManager } from './materialManager'
import { AnimationManager } from './animationManager'
import { AnimationEvaluator } from './animationEvaluator'
import type { EvaluatedNodeScratch, EvaluatedNodeState } from './animationEvaluator'
import type { KeyframeMove, KeyframeMoveResult } from './animationManager'
import type { AnimationProperty, Keyframe } from './animation'
import { AssetDefinition } from './assetDefinition'
import { MaterialDefinition } from './materialDefinition'
import type { EmbeddedAsset } from './embeddedAsset'
import type { CreateProjectInput, Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import { walkPreOrder } from './sceneNode'
import type { Slide } from './slide'
import type { SlideDurationChange } from './slideManager'
import type { EngineEvent, Unsubscribe } from './events'
import type { CreateNodeOptions } from './nodeManager'
import type { Transform } from './transform'
import type { LessonJSON } from './json'
import { buildProjectFromJSON, toLessonJSON, validate } from './lessonSerializer'
import type { EnginePublic } from './engine'

export class Engine {
  readonly #bus = new EventBus()
  readonly #projects: ProjectManager
  readonly #nodes: NodeManager
  readonly #scenes: SceneManager
  readonly #assets: AssetManager
  readonly #materials: MaterialManager
  readonly #slides: SlideManager
  readonly #animations: AnimationManager
  readonly #evaluator: AnimationEvaluator
  readonly #embeddedAssets = new Map<string, EmbeddedAsset>()
  #activeSlideId: string | null = null

  constructor() {
    this.#projects = new ProjectManager(this.#bus)
    this.#nodes = new NodeManager(this.#bus, (sceneId) => this.#scenes.getScene(sceneId))
    this.#scenes = new SceneManager(this.#nodes)
    this.#assets = new AssetManager(this.#nodes)
    this.#materials = new MaterialManager()
    this.#slides = new SlideManager(this.#bus, this.#projects, this.#scenes)
    this.#animations = new AnimationManager(
      this.#bus,
      (nodeId) => this.getNode(nodeId),
      (nodeId) => this.getSlideOfNode(nodeId),
    )
    this.#evaluator = new AnimationEvaluator(
      (nodeId) => this.getNode(nodeId),
      (nodeId) => this.getSlideOfNode(nodeId),
    )
  }

  get project(): Project | null {
    return this.#projects.current
  }

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    return this.#bus.subscribe(listener)
  }

  get activeSlideId(): string | null {
    return this.#activeSlideId
  }

  setActiveSlide(slideId: string): void {
    this.#slides.get(slideId)
    this.#activeSlideId = slideId
    this.#bus.emit({ type: 'SlideActivated', slideId })
  }

  openProject(project: Project): void {
    this.#validateOrThrow(toLessonJSON(project))
    this.#replaceProject(project)
    const first = project.slides[0]
    this.#activeSlideId = first ? first.id : null
    this.#bus.emit({ type: 'ProjectLoaded', projectId: project.id })
    if (first) {
      this.#bus.emit({ type: 'SlideActivated', slideId: first.id })
    }
  }

  createProject(input: CreateProjectInput): Project {
    this.#embeddedAssets.clear()
    return this.#projects.create(input)
  }

  createSlide(name?: string): Slide {
    const slide = this.#slides.create(name)
    this.setActiveSlide(slide.id)
    return slide
  }

  removeSlide(slideId: string): void {
    const index = this.#slides.remove(slideId)
    if (this.#activeSlideId === slideId) {
      const slides = this.#projects.current?.slides
      const repoint = slides?.[Math.min(index, slides.length - 1)]
      if (repoint) {
        this.setActiveSlide(repoint.id)
      }
    }
  }

  renameSlide(slideId: string, name: string): void {
    this.#slides.rename(slideId, name)
  }

  duplicateSlide(slideId: string): Slide {
    const slide = this.#slides.duplicate(slideId)
    this.setActiveSlide(slide.id)
    return slide
  }

  moveSlide(slideId: string, index: number): void {
    this.#slides.move(slideId, index)
  }

  setSlideDuration(slideId: string, duration: number): SlideDurationChange {
    return this.#slides.setDuration(slideId, duration)
  }

  getActiveSlide(): Slide | null {
    return this.#activeSlideId ? this.getSlide(this.#activeSlideId) : null
  }

  getSlide(slideId: string): Slide {
    return this.#slides.get(slideId)
  }

  getScene(sceneId: string): Scene {
    return this.#scenes.getScene(sceneId)
  }

  getNode(nodeId: string): SceneNode {
    return this.#nodes.getById(nodeId)
  }

  getNodeScene(nodeId: string): Scene {
    return this.#nodes.getSceneOf(nodeId)
  }

  createNode(
    sceneId: string,
    parentId: string,
    name: string,
    options?: CreateNodeOptions,
  ): SceneNode {
    return this.#nodes.create(sceneId, parentId, name, options)
  }

  removeNode(nodeId: string): void {
    const node = this.getNode(nodeId)
    const descendantIds = [...walkPreOrder(node)].map((entry) => entry.id)
    const slide = this.getSlideOfNode(nodeId)
    this.#nodes.remove(nodeId)
    for (const id of descendantIds) {
      slide.animation.removeNode(id)
    }
  }

  getSlideOfNode(nodeId: string): Slide {
    return this.#slides.getBySceneId(this.getNodeScene(nodeId).id)
  }

  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[] {
    return this.#animations.getKeyframes(nodeId, property)
  }

  evaluateNode(nodeId: string, time: number, target?: EvaluatedNodeScratch): EvaluatedNodeState {
    return this.#evaluator.evaluateNode(nodeId, time, target)
  }

  getKeyframe(
    nodeId: string,
    property: AnimationProperty,
    keyframeId: string,
  ): Keyframe | undefined {
    return this.#animations.getKeyframe(nodeId, property, keyframeId)
  }

  addKeyframe(nodeId: string, property: AnimationProperty, time: number, value: number): Keyframe {
    return this.#animations.addKeyframe(nodeId, property, time, value)
  }

  deleteKeyframe(nodeId: string, property: AnimationProperty, keyframeId: string): Keyframe {
    return this.#animations.deleteKeyframe(nodeId, property, keyframeId)
  }

  moveKeyframe(
    nodeId: string,
    property: AnimationProperty,
    keyframeId: string,
    newTime: number,
  ): void {
    this.#animations.moveKeyframe(nodeId, property, keyframeId, newTime)
  }

  moveKeyframes(moves: readonly KeyframeMove[]): KeyframeMoveResult[] {
    return this.#animations.moveKeyframes(moves)
  }

  setKeyframeValue(
    nodeId: string,
    property: AnimationProperty,
    keyframeId: string,
    value: number,
  ): void {
    this.#animations.setKeyframeValue(nodeId, property, keyframeId, value)
  }

  reparentNode(nodeId: string, newParentId: string): void {
    this.#nodes.reparent(nodeId, newParentId)
  }

  setTransform(nodeId: string, transform: Transform): void {
    this.#nodes.setTransform(nodeId, transform)
  }

  setVisibility(nodeId: string, visible: boolean): void {
    this.#nodes.setVisibility(nodeId, visible)
  }

  renameNode(nodeId: string, name: string): void {
    this.#nodes.renameNode(nodeId, name)
  }

  setOpacity(nodeId: string, opacity: number): void {
    this.#nodes.setOpacity(nodeId, opacity)
  }

  reorderNode(nodeId: string, index: number): void {
    this.#nodes.reorderNode(nodeId, index)
  }

  defineAsset(name: string): AssetDefinition {
    return this.#assets.defineAsset(name)
  }

  registerAssetDefinition(definitionId: string, name: string): AssetDefinition {
    return this.#assets.register(definitionId, name)
  }

  registerMaterialDefinition(definitionId: string, name: string): MaterialDefinition {
    return this.#materials.register(definitionId, name)
  }

  getMaterialDefinition(definitionId: string): MaterialDefinition {
    return this.#materials.getDefinition(definitionId)
  }

  getAssetDefinition(definitionId: string): AssetDefinition {
    const embedded = this.#embeddedAssets.get(definitionId)
    if (embedded) {
      return new AssetDefinition(embedded.id, embedded.name)
    }
    return this.#assets.getDefinition(definitionId)
  }

  getEmbeddedAsset(definitionId: string): EmbeddedAsset | undefined {
    return this.#embeddedAssets.get(definitionId)
  }

  get embeddedAssets(): readonly EmbeddedAsset[] {
    return [...this.#embeddedAssets.values()]
  }

  embedAsset(asset: EmbeddedAsset): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    project.embedAsset(asset)
    this.#embeddedAssets.set(asset.id, asset)
  }

  get assetDefinitions(): readonly AssetDefinition[] {
    return this.#assets.definitions
  }

  get materialDefinitions(): readonly MaterialDefinition[] {
    return this.#materials.definitions
  }

  createAssetInstance(
    sceneId: string,
    parentId: string,
    definitionId: string,
    name: string,
    options?: Omit<CreateNodeOptions, 'components'>,
  ): SceneNode {
    const definition = this.getAssetDefinition(definitionId)
    return this.#assets.createInstanceFromDefinition(sceneId, parentId, definition, name, options)
  }

  toJSON(): LessonJSON {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    return toLessonJSON(project)
  }

  restoreFromJSON(json: LessonJSON): void {
    this.#validateOrThrow(json)
    const project = buildProjectFromJSON(json)
    try {
      this.#replaceProject(project)
    } catch (error) {
      this.#nodes.clear()
      this.#scenes.clear()
      this.#projects.clear()
      throw error
    }
  }

  #validateOrThrow(json: unknown): void {
    const errors = validate(json)
    if (errors.length > 0) {
      throw new Error(errors.join('; '))
    }
  }

  #replaceProject(project: Project): void {
    this.#nodes.clear()
    this.#scenes.clear()
    this.#embeddedAssets.clear()
    for (const asset of project.embeddedAssets) {
      this.#embeddedAssets.set(asset.id, asset)
    }
    for (const slide of project.slides) {
      this.#scenes.install(slide.scene)
    }
    this.#projects.install(project)
  }
}

export function createEngineInternal(): Engine {
  return new Engine()
}

export { createEngineInternal as createEngine }

export function toReadOnly(engine: Engine): EnginePublic {
  return {
    get project() {
      return engine.project
    },
    get assetDefinitions() {
      return engine.assetDefinitions
    },
    get materialDefinitions() {
      return engine.materialDefinitions
    },
    get embeddedAssets() {
      return engine.embeddedAssets
    },
    get activeSlideId() {
      return engine.activeSlideId
    },
    subscribe: (listener) => engine.subscribe(listener),
    openProject: (project) => engine.openProject(project),
    setActiveSlide: (slideId) => engine.setActiveSlide(slideId),
    getActiveSlide: () => engine.getActiveSlide(),
    getSlide: (slideId) => engine.getSlide(slideId),
    getNode: (nodeId) => engine.getNode(nodeId),
    getScene: (sceneId) => engine.getScene(sceneId),
    getAssetDefinition: (definitionId) => engine.getAssetDefinition(definitionId),
    getMaterialDefinition: (definitionId) => engine.getMaterialDefinition(definitionId),
    getEmbeddedAsset: (definitionId) => engine.getEmbeddedAsset(definitionId),
    embedAsset: (asset) => engine.embedAsset(asset),
    getKeyframes: (nodeId, property) => engine.getKeyframes(nodeId, property),
    evaluateNode: (nodeId, time, target) => engine.evaluateNode(nodeId, time, target),
    toJSON: () => engine.toJSON(),
  }
}

export type { EnginePublic } from './engine'
