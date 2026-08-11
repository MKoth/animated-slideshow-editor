import { Engine, toReadOnly } from './internal'
import type { AssetDefinition } from './assetDefinition'
import type { Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
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
  toJSON(): LessonJSON
}

export function createEngine(): EngineReadOnly {
  return toReadOnly(new Engine())
}
