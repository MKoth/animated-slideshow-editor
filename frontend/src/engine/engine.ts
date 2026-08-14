import { Engine, toReadOnly } from './internal'
import type { AssetDefinition } from './assetDefinition'
import type { Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import type { Keyframe, AnimationProperty } from './animation'
import type { EvaluatedNodeScratch, EvaluatedNodeState } from './animationEvaluator'
import type { EngineEvent, Unsubscribe } from './events'
import type { LessonJSON } from './json'

export interface EnginePublic {
  readonly project: Project | null
  readonly assetDefinitions: readonly AssetDefinition[]
  readonly activeSlideId: string | null
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
  openProject(project: Project): void
  setActiveSlide(slideId: string): void
  getActiveSlide(): Slide | null
  getSlide(slideId: string): Slide
  getNode(nodeId: string): SceneNode
  getScene(sceneId: string): Scene
  getAssetDefinition(definitionId: string): AssetDefinition
  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[]
  evaluateNode(nodeId: string, time: number, target?: EvaluatedNodeScratch): EvaluatedNodeState
  toJSON(): LessonJSON
}

export function createEngine(): EnginePublic {
  return toReadOnly(new Engine())
}
