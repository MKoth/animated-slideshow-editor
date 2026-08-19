import { Engine, toReadOnly } from './internal'
import type { AssetDefinition } from './assetDefinition'
import type { MaterialDefinition } from './materialDefinition'
import type { ShaderDefinition } from './shaderDefinition'
import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import type { EmbeddedShaderDefinition } from './embeddedShader'
import type { Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import type { Keyframe, AnimationProperty } from './animation'
import type {
  EvaluatedMaterialOverridesScratch,
  EvaluatedNodeScratch,
  EvaluatedNodeState,
} from './animationEvaluator'
import type { EngineEvent, Unsubscribe } from './events'
import type { LessonJSON } from './json'
import type { MaterialOverrides } from './materialInstance'
import type { ClipDefinition } from './clipDefinition'
import type { ClipInstance } from './clipInstance'
import type { AnimatableParameter } from './animatableParameters'
import { createBuiltInClips } from './builtInClips'

export interface EnginePublic {
  readonly project: Project | null
  readonly assetDefinitions: readonly AssetDefinition[]
  readonly materialDefinitions: readonly MaterialDefinition[]
  readonly shaderDefinitions: readonly ShaderDefinition[]
  readonly embeddedAssets: readonly EmbeddedAsset[]
  readonly embeddedMaterials: readonly EmbeddedMaterialDefinition[]
  readonly embeddedShaders: readonly EmbeddedShaderDefinition[]
  readonly activeSlideId: string | null
  readonly clips: readonly ClipDefinition[]
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
  openProject(project: Project, clips?: readonly ClipDefinition[]): void
  setActiveSlide(slideId: string): void
  getActiveSlide(): Slide | null
  getSlide(slideId: string): Slide
  getNode(nodeId: string): SceneNode
  getScene(sceneId: string): Scene
  getAssetDefinition(definitionId: string): AssetDefinition
  getMaterialDefinition(definitionId: string): MaterialDefinition
  getShaderDefinition(definitionId: string): ShaderDefinition
  getEmbeddedAsset(definitionId: string): EmbeddedAsset | undefined
  getEmbeddedMaterial(definitionId: string): EmbeddedMaterialDefinition | undefined
  getEmbeddedShader(definitionId: string): EmbeddedShaderDefinition | undefined
  embedAsset(asset: EmbeddedAsset): void
  embedMaterial(definition: EmbeddedMaterialDefinition): void
  embedShader(definition: EmbeddedShaderDefinition): void
  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[]
  getMaterialKeyframes(nodeId: string, parameter: string): readonly Keyframe[]
  hasMaterialTrack(nodeId: string, parameter: string): boolean
  getAnimatableParameters(nodeId: string): AnimatableParameter[]
  evaluateNode(nodeId: string, time: number, target?: EvaluatedNodeScratch): EvaluatedNodeState
  evaluateMaterialOverrides(
    nodeId: string,
    time: number,
    target?: EvaluatedMaterialOverridesScratch,
  ): MaterialOverrides
  getClip(clipId: string): ClipDefinition
  getClipChannelKeyframes(clipId: string, channel: AnimationProperty): readonly Keyframe[]
  getClipInstances(nodeId: string): readonly ClipInstance[]
  isClipReferenced(clipId: string): boolean
  getClipBlockingNodeNames(clipId: string): string[]
  toJSON(): LessonJSON
}

export function createEngine(): EnginePublic {
  return toReadOnly(new Engine())
}

export interface BlankProjectResult {
  readonly project: Project
  readonly clips: readonly ClipDefinition[]
}

export function createBlankProject(name: string): BlankProjectResult {
  const engine = new Engine()
  engine.createProject({ name })
  engine.createSlide()
  // Seed built-in clips for the new-project template
  const clips = createBuiltInClips()
  for (const clip of clips) {
    engine.importClip(clip)
  }
  if (!engine.project) {
    throw new Error('Fresh project creation failed')
  }
  return { project: engine.project, clips }
}
