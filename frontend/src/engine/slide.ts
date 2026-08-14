import type { Scene } from './scene'
import type { SlideJSON } from './json'
import type { SlideAnimation } from './animation'

export const DEFAULT_SLIDE_DURATION = 10
export const MIN_SLIDE_DURATION = 0.1
export const MAX_SLIDE_DURATION = 3600

export class Slide {
  readonly id: string
  name: string
  duration: number
  readonly scene: Scene
  readonly animation: SlideAnimation

  constructor(id: string, name: string, duration: number, scene: Scene, animation: SlideAnimation) {
    this.id = id
    this.name = name
    this.duration = duration
    this.scene = scene
    this.animation = animation
  }

  toJSON(): SlideJSON {
    return {
      id: this.id,
      name: this.name,
      duration: this.duration,
      scene: this.scene.toJSON(),
      animation: this.animation.toJSON(),
    }
  }
}
