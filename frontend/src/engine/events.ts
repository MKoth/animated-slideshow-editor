export interface ProjectCreated {
  readonly type: 'ProjectCreated'
  readonly projectId: string
}

export interface SlideCreated {
  readonly type: 'SlideCreated'
  readonly slideId: string
}

export interface SlideRemoved {
  readonly type: 'SlideRemoved'
  readonly slideId: string
}

export interface NodeCreated {
  readonly type: 'NodeCreated'
  readonly nodeId: string
}

export interface NodeRemoved {
  readonly type: 'NodeRemoved'
  readonly nodeId: string
}

export interface TransformChanged {
  readonly type: 'TransformChanged'
  readonly nodeId: string
}

export interface VisibilityChanged {
  readonly type: 'VisibilityChanged'
  readonly nodeId: string
}

export type EngineEvent =
  | ProjectCreated
  | SlideCreated
  | SlideRemoved
  | NodeCreated
  | NodeRemoved
  | TransformChanged
  | VisibilityChanged

export type EventListener = (event: EngineEvent) => void

export type Unsubscribe = () => void

export class EventBus {
  readonly #listeners = new Set<EventListener>()

  subscribe(listener: EventListener): Unsubscribe {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  emit(event: EngineEvent): void {
    this.#listeners.forEach((listener) => listener(event))
  }
}
