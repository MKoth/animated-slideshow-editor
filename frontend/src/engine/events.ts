import type { AnimationProperty } from './animation'

export interface ProjectCreated {
  readonly type: 'ProjectCreated'
  readonly projectId: string
}

export interface ProjectLoaded {
  readonly type: 'ProjectLoaded'
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

export interface SlideActivated {
  readonly type: 'SlideActivated'
  readonly slideId: string
}

export interface SlideRenamed {
  readonly type: 'SlideRenamed'
  readonly slideId: string
}

export interface SlideMoved {
  readonly type: 'SlideMoved'
  readonly slideId: string
}

export interface SlideDurationChanged {
  readonly type: 'SlideDurationChanged'
  readonly slideId: string
}

export interface SlideShaderChanged {
  readonly type: 'SlideShaderChanged'
  readonly slideId: string
}

export interface SlideShaderUniformChanged {
  readonly type: 'SlideShaderUniformChanged'
  readonly slideId: string
}

export interface SlideDuplicated {
  readonly type: 'SlideDuplicated'
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

export interface NodeReparented {
  readonly type: 'NodeReparented'
  readonly nodeId: string
}

export interface NodeRenamed {
  readonly type: 'NodeRenamed'
  readonly nodeId: string
}

export interface OpacityChanged {
  readonly type: 'OpacityChanged'
  readonly nodeId: string
}

export interface NodeOrderChanged {
  readonly type: 'NodeOrderChanged'
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

export interface MaterialAssigned {
  readonly type: 'MaterialAssigned'
  readonly nodeId: string
}

export interface MaterialParameterChanged {
  readonly type: 'MaterialParameterChanged'
  readonly nodeId: string
}

export interface KeyframeAdded {
  readonly type: 'KeyframeAdded'
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
}

export interface KeyframeRemoved {
  readonly type: 'KeyframeRemoved'
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
}

export interface KeyframeMoved {
  readonly type: 'KeyframeMoved'
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
}

export interface KeyframeValueChanged {
  readonly type: 'KeyframeValueChanged'
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
}

export type EngineEvent =
  | ProjectCreated
  | ProjectLoaded
  | SlideCreated
  | SlideRemoved
  | SlideActivated
  | SlideRenamed
  | SlideMoved
  | SlideDurationChanged
  | SlideShaderChanged
  | SlideShaderUniformChanged
  | SlideDuplicated
  | NodeCreated
  | NodeRemoved
  | NodeReparented
  | NodeRenamed
  | OpacityChanged
  | NodeOrderChanged
  | TransformChanged
  | VisibilityChanged
  | MaterialAssigned
  | MaterialParameterChanged
  | KeyframeAdded
  | KeyframeRemoved
  | KeyframeMoved
  | KeyframeValueChanged

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
