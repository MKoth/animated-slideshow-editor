import type { Unsubscribe } from '../engine'
import type { CurrentTimeSource } from '../pixi/renderer/sceneRenderer'

export class FakeTimeSource implements CurrentTimeSource {
  time = 0
  readonly listeners = new Set<() => void>()

  getTime(): number {
    return this.time
  }

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(time: number): void {
    this.time = time
    for (const listener of this.listeners) {
      listener()
    }
  }
}
