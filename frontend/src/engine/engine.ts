import { Engine, toReadOnly } from './internal'
import type { AssetDefinition } from './assetDefinition'
import type { Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import type { Keyframe, AnimationProperty } from './animation'
import type { EngineEvent, Unsubscribe } from './events'
import type { LessonJSON } from './json'

export interface EngineReadOnly {
  readonly project: Project | null
  readonly assetDefinitions: readonly AssetDefinition[]
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
  getSlide(slideId: string): Slide
  getNode(nodeId: string): SceneNode
  getScene(sceneId: string): Scene
  getAssetDefinition(definitionId: string): AssetDefinition
  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[]
  toJSON(): LessonJSON
}

export function createEngine(): EngineReadOnly {
  return toReadOnly(new Engine())
}
