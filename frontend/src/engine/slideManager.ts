import type { EventBus } from './events'
import { newId } from './ids'
import type { Slide } from './slide'
import {
  Slide as SlideModel,
  DEFAULT_SLIDE_DURATION,
  MIN_SLIDE_DURATION,
  MAX_SLIDE_DURATION,
} from './slide'
import { requireFullscreenOverridePresent } from './fullscreenShader'
import type { MaterialOverrideValue } from './materialInstance'
import type { ProjectManager } from './projectManager'
import type { SceneManager } from './sceneManager'
import { SlideAnimation } from './animation'
import type { ClampedKeyframe } from './slideAnimation'
import { requireFiniteNumber, requireNonEmpty } from './guards'

const SLIDE_ORDINAL_PATTERN = /^Slide (\d+)$/

export interface SlideDurationChange {
  readonly oldDuration: number
  readonly clampedKeyframes: readonly ClampedKeyframe[]
}

export class SlideManager {
  readonly #bus: EventBus
  readonly #projects: ProjectManager
  readonly #scenes: SceneManager

  constructor(bus: EventBus, projects: ProjectManager, scenes: SceneManager) {
    this.#bus = bus
    this.#projects = projects
    this.#scenes = scenes
  }

  create(name?: string): Slide {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    if (name !== undefined) {
      requireNonEmpty(name, 'Slide name')
    }
    const scene = this.#scenes.createScene('Root')
    const slide = new SlideModel(
      newId('slide'),
      name ?? nextSlideName(project.slides),
      DEFAULT_SLIDE_DURATION,
      scene,
      new SlideAnimation(),
    )
    project.slides.push(slide)
    this.#bus.emit({ type: 'SlideCreated', slideId: slide.id })
    return slide
  }

  remove(slideId: string): number {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const index = project.slides.findIndex((slide) => slide.id === slideId)
    if (index === -1) {
      throw new Error(`Slide not found: ${slideId}`)
    }
    if (project.slides.length === 1) {
      throw new Error('The last remaining slide cannot be deleted')
    }
    const [slide] = project.slides.splice(index, 1)
    this.#scenes.removeScene(slide.scene.id)
    this.#bus.emit({ type: 'SlideRemoved', slideId })
    return index
  }

  rename(slideId: string, name: string): void {
    const slide = this.get(slideId)
    requireNonEmpty(name, 'Slide name')
    slide.name = name
    this.#bus.emit({ type: 'SlideRenamed', slideId })
  }

  duplicate(slideId: string): Slide {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const source = this.get(slideId)
    const { scene, nodeIds } = this.#scenes.copyScene(source.scene)
    const copy = new SlideModel(
      newId('slide'),
      source.name,
      source.duration,
      scene,
      source.animation.copyFor(nodeIds),
      source.fullscreenShader
        ? {
            shaderDefinitionId: source.fullscreenShader.shaderDefinitionId,
            overrides: { ...source.fullscreenShader.overrides },
          }
        : null,
      source.prompter
        ? { parts: source.prompter.parts.map((part) => ({ ...part })) }
        : null,
      { clips: source.audio.clips.map((clip) => ({ ...clip })) },
    )
    project.slides.splice(project.slides.indexOf(source) + 1, 0, copy)
    this.#bus.emit({ type: 'SlideDuplicated', slideId: copy.id })
    return copy
  }

  move(slideId: string, index: number): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const slide = this.get(slideId)
    if (!Number.isInteger(index) || index < 0 || index >= project.slides.length) {
      throw new Error(`Move index out of bounds: ${index}`)
    }
    const current = project.slides.indexOf(slide)
    project.slides.splice(current, 1)
    project.slides.splice(index, 0, slide)
    this.#bus.emit({ type: 'SlideMoved', slideId })
  }

  setDuration(slideId: string, duration: number): SlideDurationChange {
    const slide = this.get(slideId)
    requireFiniteNumber(
      duration,
      'Slide duration',
      (value) => value >= MIN_SLIDE_DURATION && value <= MAX_SLIDE_DURATION,
      `a number within [${MIN_SLIDE_DURATION}, ${MAX_SLIDE_DURATION}]`,
    )
    const oldDuration = slide.duration
    const clampedKeyframes =
      duration < oldDuration ? slide.animation.clampKeyframesTo(duration) : []
    slide.duration = duration
    this.#bus.emit({ type: 'SlideDurationChanged', slideId })
    return { oldDuration, clampedKeyframes }
  }

  /** Assign a fullscreen shader to a slide, or clear it; assigning resets overrides. */
  setFullscreenShader(slideId: string, shaderDefinitionId: string | null): void {
    const slide = this.get(slideId)
    slide.fullscreenShader =
      shaderDefinitionId === null ? null : { shaderDefinitionId, overrides: {} }
    this.#bus.emit({ type: 'SlideShaderChanged', slideId })
  }

  overrideFullscreenUniform(slideId: string, uniform: string, value: MaterialOverrideValue): void {
    const slide = this.get(slideId)
    const reference = slide.fullscreenShader
    if (!reference) {
      throw new Error(`Slide "${slideId}" has no fullscreen shader assigned`)
    }
    slide.fullscreenShader = {
      shaderDefinitionId: reference.shaderDefinitionId,
      overrides: { ...reference.overrides, [uniform]: value },
    }
    this.#bus.emit({ type: 'SlideShaderUniformChanged', slideId })
  }

  clearFullscreenUniform(slideId: string, uniform: string): void {
    const slide = this.get(slideId)
    const reference = slide.fullscreenShader
    if (!reference) {
      throw new Error(`Slide "${slideId}" has no fullscreen shader assigned`)
    }
    requireFullscreenOverridePresent(reference, uniform, slideId)
    const overrides = { ...reference.overrides }
    delete overrides[uniform]
    slide.fullscreenShader = {
      shaderDefinitionId: reference.shaderDefinitionId,
      overrides,
    }
    this.#bus.emit({ type: 'SlideShaderUniformChanged', slideId })
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

function nextSlideName(slides: readonly Slide[]): string {
  const used = new Set<number>()
  for (const slide of slides) {
    const match = SLIDE_ORDINAL_PATTERN.exec(slide.name)
    if (match) {
      used.add(Number(match[1]))
    }
  }
  let ordinal = 1
  while (used.has(ordinal)) {
    ordinal += 1
  }
  return `Slide ${ordinal}`
}
