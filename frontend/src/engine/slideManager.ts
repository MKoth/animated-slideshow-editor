import type { EventBus } from './events'
import { newId } from './ids'
import type { Slide } from './slide'
import { Slide as SlideModel, DEFAULT_SLIDE_DURATION } from './slide'
import type { ProjectManager } from './projectManager'
import type { SceneManager } from './sceneManager'
import { SlideAnimation } from './animation'

export class SlideManager {
  readonly #bus: EventBus
  readonly #projects: ProjectManager
  readonly #scenes: SceneManager

  constructor(bus: EventBus, projects: ProjectManager, scenes: SceneManager) {
    this.#bus = bus
    this.#projects = projects
    this.#scenes = scenes
  }

  create(name: string): Slide {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    if (!name || name.trim() === '') {
      throw new Error('Slide name must not be empty')
    }
    const scene = this.#scenes.createScene('Root')
    const slide = new SlideModel(
      newId('slide'),
      name,
      DEFAULT_SLIDE_DURATION,
      scene,
      new SlideAnimation(),
    )
    project.slides.push(slide)
    this.#bus.emit({ type: 'SlideCreated', slideId: slide.id })
    return slide
  }

  remove(slideId: string): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const index = project.slides.findIndex((slide) => slide.id === slideId)
    if (index === -1) {
      throw new Error(`Slide not found: ${slideId}`)
    }
    const [slide] = project.slides.splice(index, 1)
    this.#scenes.removeScene(slide.scene.id)
    this.#bus.emit({ type: 'SlideRemoved', slideId })
  }

  get(slideId: string): Slide {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const slide = project.slides.find((entry) => entry.id === slideId)
    if (!slide) {
      throw new Error(`Slide not found: ${slideId}`)
    }
    return slide
  }

  getBySceneId(sceneId: string): Slide {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const slide = project.slides.find((entry) => entry.scene.id === sceneId)
    if (!slide) {
      throw new Error(`Slide not found for scene: ${sceneId}`)
    }
    return slide
  }
}
