import type { Scene } from './scene'
import type { SlideJSON } from './json'

export class Slide {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly scene: Scene

  constructor(id: string, name: string, duration: number, scene: Scene) {
    this.id = id
    this.name = name
    this.duration = duration
    this.scene = scene
  }

  toJSON(): SlideJSON {
    return {
      id: this.id,
      name: this.name,
      duration: this.duration,
      scene: this.scene.toJSON(),
    }
  }
}
