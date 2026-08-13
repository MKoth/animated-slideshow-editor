import type { PixiContainer } from './pixi'
import type { ViewportTransform } from './worldGeometry'

export class Camera {
  readonly #world: PixiContainer

  constructor(world: PixiContainer) {
    this.#world = world
  }

  apply(transform: ViewportTransform | null): void {
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
