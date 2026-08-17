import type { KeyframeTarget } from './keyframeTarget'

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
  readonly target: KeyframeTarget
  readonly keyframeId: string
}

export interface KeyframeRemoved {
  readonly type: 'KeyframeRemoved'
  readonly target: KeyframeTarget
  readonly keyframeId: string
}

export interface KeyframeMoved {
  readonly type: 'KeyframeMoved'
  readonly target: KeyframeTarget
  readonly keyframeId: string
}

export interface KeyframeValueChanged {
  readonly type: 'KeyframeValueChanged'
  readonly target: KeyframeTarget
  readonly keyframeId: string
}

export interface KeyframeInterpolationChanged {
  readonly type: 'KeyframeInterpolationChanged'
  readonly target: KeyframeTarget
  readonly keyframeId: string
}

export interface KeyframeTangentsChanged {
  readonly type: 'KeyframeTangentsChanged'
  readonly target: KeyframeTarget
  readonly keyframeId: string
}

export interface ClipCreated {
  readonly type: 'ClipCreated'
  readonly clipId: string
}

export interface ClipRemoved {
  readonly type: 'ClipRemoved'
  readonly clipId: string
}

export interface ClipRenamed {
  readonly type: 'ClipRenamed'
  readonly clipId: string
}

export interface ClipDuplicated {
  readonly type: 'ClipDuplicated'
  readonly clipId: string
}

export interface ClipDurationChanged {
  readonly type: 'ClipDurationChanged'
  readonly clipId: string
}

export interface ClipCategoryChanged {
  readonly type: 'ClipCategoryChanged'
  readonly clipId: string
}

export interface ClipParamDefaultChanged {
  readonly type: 'ClipParamDefaultChanged'
  readonly clipId: string
  readonly paramKey: string
}

export interface ClipChannelLinkChanged {
  readonly type: 'ClipChannelLinkChanged'
  readonly clipId: string
  readonly channel: string
}

export interface ClipInstanceAdded {
  readonly type: 'ClipInstanceAdded'
  readonly nodeId: string
  readonly instanceId: string
}

export interface ClipInstanceRemoved {
  readonly type: 'ClipInstanceRemoved'
  readonly nodeId: string
  readonly instanceId: string
}

export interface ClipLayerMoved {
  readonly type: 'ClipLayerMoved'
  readonly nodeId: string
  readonly instanceId: string
}

export interface ClipInstanceEnabledChanged {
  readonly type: 'ClipInstanceEnabledChanged'
  readonly nodeId: string
  readonly instanceId: string
}

export interface ClipInstanceTimeChanged {
  readonly type: 'ClipInstanceTimeChanged'
  readonly nodeId: string
  readonly instanceId: string
}

export interface ClipInstanceSpeedChanged {
  readonly type: 'ClipInstanceSpeedChanged'
  readonly nodeId: string
  readonly instanceId: string
}

export interface ClipParamOverridden {
  readonly type: 'ClipParamOverridden'
  readonly nodeId: string
  readonly instanceId: string
  readonly paramKey: string
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
  | KeyframeInterpolationChanged
  | KeyframeTangentsChanged
  | ClipCreated
  | ClipRemoved
  | ClipRenamed
  | ClipDuplicated
  | ClipDurationChanged
  | ClipCategoryChanged
  | ClipParamDefaultChanged
  | ClipChannelLinkChanged
  | ClipInstanceAdded
  | ClipInstanceRemoved
  | ClipLayerMoved
  | ClipInstanceEnabledChanged
  | ClipInstanceTimeChanged
  | ClipInstanceSpeedChanged
  | ClipParamOverridden

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
