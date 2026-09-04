import { Engine, toReadOnly } from './internal'
import type { AssetDefinition } from './assetDefinition'
import type { MaterialDefinition } from './materialDefinition'
import type { ShaderDefinition } from './shaderDefinition'
import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import type { EmbeddedShaderDefinition } from './embeddedShader'
import type { EmbeddedDataSourceUnion } from './project'
import type { ChartComponent, TableComponent, TextComponent } from './components'
import type { CircleComponent } from './circleComponent'
import type { CircleAnimationProperty, TableAnimationProperty } from './animationProperties'
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
import type { ClipCollection } from './clipCollection'
import type { AnimatableParameter } from './animatableParameters'
import { createBuiltInClips } from './builtInClips'
import type { IKManager } from './ikManager'
import type { ConstraintManager } from './constraintManager'
import type { DeformedMeshResult } from './meshDeformationEvaluator'
import type { WorldTransform } from './worldTransform'
import type { ExportJobDescriptor, ExportPerSlideDescriptor, ExportSettings } from './export'

export interface EnginePublic {
  readonly project: Project | null
  readonly assetDefinitions: readonly AssetDefinition[]
  readonly materialDefinitions: readonly MaterialDefinition[]
  readonly shaderDefinitions: readonly ShaderDefinition[]
  readonly embeddedAssets: readonly EmbeddedAsset[]
  readonly embeddedMaterials: readonly EmbeddedMaterialDefinition[]
  readonly embeddedShaders: readonly EmbeddedShaderDefinition[]
  readonly embeddedDataSources: readonly EmbeddedDataSourceUnion[]
  readonly activeSlideId: string | null
  readonly clips: readonly ClipDefinition[]
  readonly clipCollections: readonly ClipCollection[]
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
  openProject(
    project: Project,
    clips?: readonly ClipDefinition[],
    clipCollections?: readonly ClipCollection[],
  ): void
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
  deleteEmbeddedAsset(assetId: string): EmbeddedAsset | null
  embedMaterial(definition: EmbeddedMaterialDefinition): void
  embedShader(definition: EmbeddedShaderDefinition): void
  embedDataSource(definition: EmbeddedDataSourceUnion): void
  removeDataSource(id: string): boolean
  setTableComponent(nodeId: string, table: TableComponent): void
  setChartComponent(nodeId: string, chart: ChartComponent): void
  setTextComponent(nodeId: string, text: TextComponent): void
  setCircleComponent(nodeId: string, circle: CircleComponent): void
  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[]
  getMaterialKeyframes(nodeId: string, parameter: string): readonly Keyframe[]
  hasMaterialTrack(nodeId: string, parameter: string): boolean
  hasDataLabelTrack(nodeId: string, label: string): boolean
  getDataLabelKeyframes(nodeId: string, label: string): readonly Keyframe[]
  getCircleKeyframes(nodeId: string, property: CircleAnimationProperty): readonly Keyframe[]
  hasCircleTrack(nodeId: string, property: CircleAnimationProperty): boolean
  getTableKeyframes(nodeId: string, property: TableAnimationProperty): readonly Keyframe[]
  hasTableTrack(nodeId: string, property: TableAnimationProperty): boolean
  getVisibleKeyframes(nodeId: string): readonly Keyframe[]
  hasVisibleTrack(nodeId: string): boolean
  evaluateVisible(nodeId: string, time: number): boolean
  getMorphKeyframes(nodeId: string): readonly Keyframe[]
  hasMorphTrack(nodeId: string): boolean
  getMorphBinding(nodeId: string): import('./shape').MorphBinding | null
  setMorphBinding(
    nodeId: string,
    binding: import('./shape').MorphBinding | null,
  ): import('./shape').MorphBinding | null
  evaluateMorph(nodeId: string, time: number): number
  getAnimatableParameters(nodeId: string): AnimatableParameter[]
  evaluateNode(nodeId: string, time: number, target?: EvaluatedNodeScratch): EvaluatedNodeState
  evaluateMaterialOverrides(
    nodeId: string,
    time: number,
    target?: EvaluatedMaterialOverridesScratch,
  ): MaterialOverrides
  evaluateDataLabels(nodeId: string, time: number): Map<string, number>
  evaluateCircle(
    nodeId: string,
    time: number,
  ): import('./animationEvaluator').EvaluatedCircleState | null
  evaluateTable(
    nodeId: string,
    time: number,
  ): import('./animationEvaluator').EvaluatedTableState | null
  evaluateMeshDeformation(
    nodeId: string,
    time: number,
    boneWorldTransforms: ReadonlyMap<string, WorldTransform>,
    meshWorldTransform?: WorldTransform,
  ): DeformedMeshResult | null
  getIKManager(): IKManager
  getConstraintManager(): ConstraintManager
  getClip(clipId: string): ClipDefinition
  getClipChannelKeyframes(clipId: string, channel: AnimationProperty): readonly Keyframe[]
  getClipInstances(nodeId: string): readonly ClipInstance[]
  isClipReferenced(clipId: string): boolean
  getClipBlockingNodeNames(clipId: string): string[]
  // ClipCollection
  getClipCollection(collectionId: string): ClipCollection
  createClipCollection(
    name: string,
    bindings: Record<string, string>,
    sourceNodeId?: string,
  ): ClipCollection
  deleteClipCollection(collectionId: string): ClipCollection
  renameClipCollection(collectionId: string, name: string): void
  exportClipCollection(parentNodeId: string, name: string): ClipCollection
  applyClipCollection(
    collectionId: string,
    targetNodeId: string,
  ): { nodeId: string; instanceId: string; clipId: string }[]
  getExportFrameCount(duration: number, fps: number): number
  getExportFrameTimestamps(duration: number, fps: number): number[]
  getRubberbandTempoForPlaybackRate(playbackRate: number): number
  getDerivedAssetCacheKey(assetId: string, playbackRate: number): string
  buildPerSlideExportDescriptor(slideId: string, settings: ExportSettings): ExportPerSlideDescriptor
  buildExportJobDescriptor(settings: ExportSettings): ExportJobDescriptor
  toJSON(): LessonJSON
  restoreFromJSON(json: LessonJSON): void
  exportReusableObject(
    rootNodeId: string,
    name: string,
    description?: string,
  ): import('./reusableObject').ReusableObjectJSON
  importReusableObject(
    objectJson: import('./reusableObject').ReusableObjectJSON,
    targetParentId?: string,
  ): {
    nodeIdMap: Map<string, string>
    clipIdMap: Map<string, string>
    collectionIdMap: Map<string, string>
    rootNewId: string
  }
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
