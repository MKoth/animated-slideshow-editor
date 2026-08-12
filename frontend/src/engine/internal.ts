import { EventBus } from './events'
import { ProjectManager } from './projectManager'
import { SceneManager } from './sceneManager'
import { SlideManager } from './slideManager'
import { NodeManager } from './nodeManager'
import { AssetManager } from './assetManager'
import type { AssetDefinition } from './assetDefinition'
import type { CreateProjectInput, Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import type { EngineEvent, Unsubscribe } from './events'
import type { CreateNodeOptions } from './nodeManager'
import type { Transform } from './transform'
import type { LessonJSON } from './json'
import { isRecord } from './guards'
import type { EngineReadOnly } from './engine'

export class Engine {
  readonly #bus = new EventBus()
  readonly #projects: ProjectManager
  readonly #nodes: NodeManager
  readonly #scenes: SceneManager
  readonly #assets: AssetManager
  readonly #slides: SlideManager

  constructor() {
    this.#projects = new ProjectManager(this.#bus)
    this.#nodes = new NodeManager(this.#bus, (sceneId) => this.#scenes.getScene(sceneId))
    this.#scenes = new SceneManager(this.#nodes)
    this.#assets = new AssetManager(this.#nodes)
    this.#slides = new SlideManager(this.#bus, this.#projects, this.#scenes)
  }

  get project(): Project | null {
    return this.#projects.current
  }

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    return this.#bus.subscribe(listener)
  }

  createProject(input: CreateProjectInput): Project {
    return this.#projects.create(input)
  }

  createSlide(name: string): Slide {
    return this.#slides.create(name)
  }

  removeSlide(slideId: string): void {
    this.#slides.remove(slideId)
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
    this.#nodes.remove(nodeId)
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

  getAssetDefinition(definitionId: string): AssetDefinition {
    return this.#assets.getDefinition(definitionId)
  }

  get assetDefinitions(): readonly AssetDefinition[] {
    return this.#assets.definitions
  }

  createAssetInstance(
    sceneId: string,
    parentId: string,
    definitionId: string,
    name: string,
    options?: Omit<CreateNodeOptions, 'components'>,
  ): SceneNode {
    return this.#assets.createInstance(sceneId, parentId, definitionId, name, options)
  }

  toJSON(): LessonJSON {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    return {
      project: project.toJSON(),
      library: {
        assetDefinitions: this.#assets.definitions.map((definition) => definition.toJSON()),
      },
    }
  }

  restoreFromJSON(json: LessonJSON): void {
    if (!isRecord(json) || !isRecord(json.project) || !isRecord(json.library)) {
      throw new Error('Invalid lesson JSON: expected { project, library }')
    }
    try {
      this.#assets.restoreLibrary(json.library)
      this.#nodes.clear()
      this.#scenes.clear()
      const slides = json.project.slides.map((slideJson) => this.#slides.restore(slideJson))
      const settings = isRecord(json.project.settings) ? json.project.settings : {}
      this.#projects.restore(json.project.metadata, slides, settings)
    } catch (error) {
      this.#assets.clear()
      this.#nodes.clear()
      this.#scenes.clear()
      this.#projects.clear()
      throw error
    }
  }
}

export function createEngineInternal(): Engine {
  return new Engine()
}

export { createEngineInternal as createEngine }

export function toReadOnly(engine: Engine): EngineReadOnly {
  return {
    get project() {
      return engine.project
    },
    get assetDefinitions() {
      return engine.assetDefinitions
    },
    subscribe: (listener) => engine.subscribe(listener),
    getSlide: (slideId) => engine.getSlide(slideId),
    getNode: (nodeId) => engine.getNode(nodeId),
    getScene: (sceneId) => engine.getScene(sceneId),
    getAssetDefinition: (definitionId) => engine.getAssetDefinition(definitionId),
    toJSON: () => engine.toJSON(),
  }
}

export type { EngineReadOnly } from './engine'
