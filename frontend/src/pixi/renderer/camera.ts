import type { SceneNode } from '../../engine'
import type { PixiContainer } from './pixi'

export class Camera {
  readonly #world: PixiContainer

  constructor(world: PixiContainer) {
    this.#world = world
  }

  apply(node: SceneNode | null): void {
    const transform = node?.transform
    if (!transform) {
      this.#world.position.set(0, 0)
      this.#world.scale.set(1, 1)
      this.#world.rotation = 0
      return
    }
    this.#world.position.set(-transform.x * transform.scaleX, -transform.y * transform.scaleY)
    this.#world.scale.set(transform.scaleX, transform.scaleY)
    this.#world.rotation = 0
  }
}
