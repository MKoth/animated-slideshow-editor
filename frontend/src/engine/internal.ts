import { EventBus } from './events'
import { ProjectManager } from './projectManager'
import { SceneManager } from './sceneManager'
import { SlideManager } from './slideManager'
import { NodeManager } from './nodeManager'
import { AssetManager } from './assetManager'
import { MaterialManager } from './materialManager'
import { ShaderManager } from './shaderManager'
import { AnimationManager } from './animationManager'
import { AnimationEvaluator } from './animationEvaluator'
import type {
  EvaluatedMaterialOverridesScratch,
  EvaluatedNodeScratch,
  EvaluatedNodeState,
} from './animationEvaluator'
import type {
  KeyframeMove,
  KeyframeMoveResult,
  KeyframeTangents,
  PastePayload,
} from './animationManager'
import type { AnimationProperty, Keyframe } from './animation'
import type { InterpolationType, KeyframeTangent } from './keyframe'
import type { KeyframeTarget, KeyframeTrackRef } from './keyframeTarget'
import type { MaterialParameterKindOf } from './keyframeTarget'
import { requireNodeTarget } from './keyframeTarget'
import { AssetDefinition } from './assetDefinition'
import { MaterialDefinition } from './materialDefinition'
import { ShaderDefinition } from './shaderDefinition'
import { DEFAULT_MATERIAL_DEFINITION_ID, DEFAULT_MATERIAL_NAME } from './materialInstance'
import type { MaterialOverrideValue, MaterialOverrides } from './materialInstance'
import { DEFAULT_MATERIAL_PARAMETERS } from './materialResolution'
import type { MaterialParameterDefault } from './materialResolution'
import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import { embeddedShaderParameters } from './embeddedShader'
import type { EmbeddedShaderDefinition } from './embeddedShader'
import type { TableComponent } from './components'
import type { CreateProjectInput, EmbeddedDataSourceUnion, Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import { walkPreOrder } from './sceneNode'
import type { Slide } from './slide'
import type { SlideDurationChange } from './slideManager'
import type { EngineEvent, Unsubscribe } from './events'
import type { CreateNodeOptions } from './nodeManager'
import type { Transform } from './transform'
import type { LessonJSON } from './json'
import {
  buildProjectFromJSON,
  toLessonJSON,
  validate,
  parseClipsFromLessonJSON,
} from './lessonSerializer'

import type { EnginePublic } from './engine'
import { ClipManager } from './clipManager'
import { IKManager } from './ikManager'
import { ConstraintManager } from './constraintManager'
import type { Constraint, ConstraintType, ConstraintParams } from './constraint'
import type { ClipChannelDef, ClipParam } from './clipDefinition'
import { ClipDefinition } from './clipDefinition'
import type { ClipInstance } from './clipInstance'
import { createClipInstance } from './clipInstance'
import { getAnimatableParameters, type AnimatableParameter } from './animatableParameters'
import type { MeshData } from './mesh'
import { evaluateMeshDeformation } from './meshDeformationEvaluator'
import type { DeformedMeshResult } from './meshDeformationEvaluator'
import type { WorldTransform } from './worldTransform'

const DEFAULT_MATERIAL_KINDS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_MATERIAL_PARAMETERS.map((parameter) => [parameter.key, parameter.kind]),
)

export class Engine {
  readonly #bus = new EventBus()
  readonly #projects: ProjectManager
  readonly #nodes: NodeManager
  readonly #scenes: SceneManager
  readonly #assets: AssetManager
  readonly #materials: MaterialManager
  readonly #shaders: ShaderManager
  readonly #slides: SlideManager
  readonly #animations: AnimationManager
  readonly #evaluator: AnimationEvaluator
  readonly #clips: ClipManager
  readonly #ik: IKManager
  readonly #constraints: ConstraintManager
  readonly #embeddedAssets = new Map<string, EmbeddedAsset>()
  readonly #embeddedMaterials = new Map<string, EmbeddedMaterialDefinition>()
  readonly #embeddedShaders = new Map<string, EmbeddedShaderDefinition>()
  readonly #embeddedDataSources = new Map<string, EmbeddedDataSourceUnion>()
  #activeSlideId: string | null = null

  constructor() {
    this.#projects = new ProjectManager(this.#bus)
    this.#nodes = new NodeManager(this.#bus, (sceneId) => this.#scenes.getScene(sceneId))
    this.#scenes = new SceneManager(this.#nodes)
    this.#assets = new AssetManager(this.#nodes)
    this.#materials = new MaterialManager()
    this.#materials.register(
      DEFAULT_MATERIAL_DEFINITION_ID,
      DEFAULT_MATERIAL_NAME,
      DEFAULT_MATERIAL_PARAMETERS,
    )
    this.#shaders = new ShaderManager()
    this.#slides = new SlideManager(this.#bus, this.#projects, this.#scenes)
    this.#animations = new AnimationManager(
      this.#bus,
      (nodeId) => this.getNode(nodeId),
      (nodeId) => this.getSlideOfNode(nodeId),
      this.#materialParameterKindOf,
    )
    this.#evaluator = new AnimationEvaluator(
      (nodeId) => this.getNode(nodeId),
      (nodeId) => this.getSlideOfNode(nodeId),
      this.#materialParameterKindOf,
      (clipId) => this.getClip(clipId),
    )
    this.#clips = new ClipManager(this.#bus)
    this.#ik = new IKManager(this.#bus, (nodeId) => this.getNode(nodeId))
    this.#constraints = new ConstraintManager(this.#bus, (nodeId) => this.getNode(nodeId))
  }

  get project(): Project | null {
    return this.#projects.current
  }

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    return this.#bus.subscribe(listener)
  }

  get activeSlideId(): string | null {
    return this.#activeSlideId
  }

  setActiveSlide(slideId: string): void {
    this.#slides.get(slideId)
    this.#activeSlideId = slideId
    this.#bus.emit({ type: 'SlideActivated', slideId })
  }

  openProject(project: Project, clips?: readonly ClipDefinition[]): void {
    this.#validateOrThrow(toLessonJSON(project, clips))
    this.#replaceProject(project)
    this.#clips.clear()
    if (clips) {
      for (const clip of clips) {
        this.#clips.importClip(clip)
      }
    }
    const first = project.slides[0]
    this.#activeSlideId = first ? first.id : null
    this.#bus.emit({ type: 'ProjectLoaded', projectId: project.id })
    if (first) {
      this.#bus.emit({ type: 'SlideActivated', slideId: first.id })
    }
  }

  createProject(input: CreateProjectInput): Project {
    this.#embeddedAssets.clear()
    this.#embeddedMaterials.clear()
    this.#embeddedShaders.clear()
    this.#embeddedDataSources.clear()
    this.#clips.clear()
    return this.#projects.create(input)
  }

  createSlide(name?: string): Slide {
    const slide = this.#slides.create(name)
    this.setActiveSlide(slide.id)
    return slide
  }

  removeSlide(slideId: string): void {
    const index = this.#slides.remove(slideId)
    this.#ik.clearSlide(slideId)
    if (this.#activeSlideId === slideId) {
      const slides = this.#projects.current?.slides
      const repoint = slides?.[Math.min(index, slides.length - 1)]
      if (repoint) {
        this.setActiveSlide(repoint.id)
      }
    }
  }

  renameSlide(slideId: string, name: string): void {
    this.#slides.rename(slideId, name)
  }

  duplicateSlide(slideId: string): Slide {
    const slide = this.#slides.duplicate(slideId)
    this.setActiveSlide(slide.id)
    return slide
  }

  moveSlide(slideId: string, index: number): void {
    this.#slides.move(slideId, index)
  }

  setSlideDuration(slideId: string, duration: number): SlideDurationChange {
    return this.#slides.setDuration(slideId, duration)
  }

  setFullscreenShader(slideId: string, shaderDefinitionId: string | null): void {
    if (shaderDefinitionId !== null) {
      this.getShaderDefinition(shaderDefinitionId)
    }
    this.#slides.setFullscreenShader(slideId, shaderDefinitionId)
  }

  overrideFullscreenUniform(slideId: string, uniform: string, value: MaterialOverrideValue): void {
    this.#slides.overrideFullscreenUniform(slideId, uniform, value)
  }

  clearFullscreenUniform(slideId: string, uniform: string): void {
    this.#slides.clearFullscreenUniform(slideId, uniform)
  }

  getActiveSlide(): Slide | null {
    return this.#activeSlideId ? this.getSlide(this.#activeSlideId) : null
  }

  getSlide(slideId: string): Slide {
    return this.#slides.get(slideId)
  }

  getScene(sceneId: string): Scene {
    return this.#scenes.getScene(sceneId)
  }

  getNode(nodeId: string): SceneNode {
    return this.#nodes.getById(nodeId)
  }

  getNodeScene(nodeId: string): Scene {
    return this.#nodes.getSceneOf(nodeId)
  }

  getMaterialParameterKind(node: SceneNode, parameterKey: string): string | undefined {
    const materialId = node.material.materialDefinitionId
    const embedded = this.#embeddedMaterials.get(materialId)
    if (embedded) {
      return embedded.parameters.find((parameter) => parameter.key === parameterKey)?.kind
    }
    if (materialId === DEFAULT_MATERIAL_DEFINITION_ID) {
      return DEFAULT_MATERIAL_KINDS[parameterKey]
    }
    return this.#materials
      .getDefinition(materialId)
      .parameters.find((parameter) => parameter.key === parameterKey)?.kind
  }

  #materialParameterKindOf: MaterialParameterKindOf = (node, parameterKey) =>
    this.getMaterialParameterKind(node, parameterKey)

  createNode(
    sceneId: string,
    parentId: string,
    name: string,
    options?: CreateNodeOptions,
  ): SceneNode {
    return this.#nodes.create(sceneId, parentId, name, options)
  }

  removeNode(nodeId: string): void {
    const node = this.getNode(nodeId)
    const descendantIds = [...walkPreOrder(node)].map((entry) => entry.id)
    const slide = this.getSlideOfNode(nodeId)
    // Remove IK chains that reference any of the deleted nodes
    for (const id of descendantIds) {
      const chains = this.#ik.getChainsForBone(id)
      for (const chain of chains) {
        this.#ik.deleteChain(chain.id)
      }
    }
    // Remove constraints for all deleted nodes
    for (const id of descendantIds) {
      this.#constraints.removeConstraintsForNode(id)
    }
    this.#nodes.remove(nodeId)
    for (const id of descendantIds) {
      slide.animation.removeNode(id)
    }
  }

  getSlideOfNode(nodeId: string): Slide {
    return this.#slides.getBySceneId(this.getNodeScene(nodeId).id)
  }

  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[] {
    return this.#animations.getKeyframes(nodeId, property)
  }

  getMaterialKeyframes(nodeId: string, parameter: string): readonly Keyframe[] {
    return this.#animations.getMaterialKeyframes(nodeId, parameter)
  }

  hasMaterialTrack(nodeId: string, parameter: string): boolean {
    return this.#animations.hasMaterialTrack(nodeId, parameter)
  }

  getAnimatableParameters(nodeId: string): AnimatableParameter[] {
    const node = this.getNode(nodeId)
    const materialId = node.material.materialDefinitionId
    const definition = this.#resolveMaterialDefinition(materialId)
    return getAnimatableParameters(
      node,
      definition.parameters,
      (property) => this.getKeyframes(nodeId, property).length > 0,
      (parameter) => this.hasMaterialTrack(nodeId, parameter),
    )
  }

  /** Resolve a target's track, rejecting unknown nodes, properties, and parameters. */
  resolveAnimationTarget(target: KeyframeTarget): KeyframeTrackRef {
    return this.#animations.resolveTarget(target)
  }

  getKeyframesOf(target: KeyframeTarget): readonly Keyframe[] {
    const nodeTarget = requireNodeTarget(target)
    const resolved = this.resolveAnimationTarget(target)
    return resolved.kind === 'property'
      ? this.#animations.getKeyframes(nodeTarget.nodeId, resolved.property)
      : this.#animations.getMaterialKeyframes(nodeTarget.nodeId, resolved.parameter)
  }

  evaluateNode(nodeId: string, time: number, target?: EvaluatedNodeScratch): EvaluatedNodeState {
    return this.#evaluator.evaluateNode(nodeId, time, target)
  }

  evaluateMaterialOverrides(
    nodeId: string,
    time: number,
    target?: EvaluatedMaterialOverridesScratch,
  ): MaterialOverrides {
    return this.#evaluator.evaluateMaterialOverrides(nodeId, time, target)
  }

  evaluateMeshDeformation(
    nodeId: string,
    _time: number,
    boneWorldTransforms: ReadonlyMap<string, WorldTransform>,
    meshWorldTransform?: WorldTransform,
  ): DeformedMeshResult | null {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) {
      return null
    }
    return evaluateMeshDeformation(
      node.components.mesh.mesh,
      boneWorldTransforms,
      meshWorldTransform,
    )
  }

  addKeyframe(target: KeyframeTarget, time: number, value: unknown): Keyframe {
    return this.#animations.addKeyframe(target, time, value)
  }

  deleteKeyframes(target: KeyframeTarget, keyframeIds: readonly string[]): Keyframe[] {
    return this.#animations.deleteKeyframes(target, keyframeIds)
  }

  moveKeyframes(target: KeyframeTarget, moves: readonly KeyframeMove[]): KeyframeMoveResult[] {
    return this.#animations.moveKeyframes(target, moves)
  }

  scaleKeyframes(
    target: KeyframeTarget,
    keyframeIds: readonly string[],
    pivot: number,
    factor: number,
  ): KeyframeMoveResult[] {
    return this.#animations.scaleKeyframes(target, keyframeIds, pivot, factor)
  }

  setKeyframeValue(target: KeyframeTarget, keyframeId: string, value: unknown): unknown {
    return this.#animations.setKeyframeValue(target, keyframeId, value)
  }

  setKeyframeInterpolation(
    target: KeyframeTarget,
    keyframeId: string,
    interpolation: unknown,
  ): InterpolationType {
    return this.#animations.setKeyframeInterpolation(target, keyframeId, interpolation)
  }

  setKeyframeTangents(
    target: KeyframeTarget,
    keyframeId: string,
    tangentIn: KeyframeTangent,
    tangentOut: KeyframeTangent,
  ): KeyframeTangents {
    return this.#animations.setKeyframeTangents(target, keyframeId, tangentIn, tangentOut)
  }

  pasteKeyframes(target: KeyframeTarget, payload: PastePayload, atTime: number): Keyframe[] {
    return this.#animations.pasteKeyframes(target, payload, atTime)
  }

  duplicateKeyframes(target: KeyframeTarget, keyframeIds: readonly string[]): Keyframe[] {
    return this.#animations.duplicateKeyframes(target, keyframeIds)
  }

  reparentNode(nodeId: string, newParentId: string): void {
    this.#nodes.reparent(nodeId, newParentId)
  }

  setTransform(nodeId: string, transform: Transform): void {
    this.#nodes.setTransform(nodeId, transform)
  }

  setVisibility(nodeId: string, visible: boolean): void {
    this.#nodes.setVisibility(nodeId, visible)
  }

  renameNode(nodeId: string, name: string): void {
    this.#nodes.renameNode(nodeId, name)
  }

  setOpacity(nodeId: string, opacity: number): void {
    this.#nodes.setOpacity(nodeId, opacity)
  }

  setMeshData(nodeId: string, mesh: MeshData): void {
    const node = this.getNode(nodeId)
    const newMesh = { kind: 'mesh' as const, mesh }
    const newComponents = { ...node.components, mesh: newMesh }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'MeshChanged', nodeId })
  }

  setTableComponent(nodeId: string, table: TableComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, table }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'TableChanged', nodeId })
  }

  assignMaterial(nodeId: string, materialDefinitionId: string): void {
    this.#resolveMaterialDefinition(materialDefinitionId)
    this.#nodes.assignMaterial(nodeId, materialDefinitionId)
  }

  overrideMaterialParameter(nodeId: string, parameter: string, value: MaterialOverrideValue): void {
    this.#nodes.overrideMaterialParameter(nodeId, parameter, value)
  }

  clearMaterialOverride(nodeId: string, parameter: string): void {
    this.#nodes.clearMaterialOverride(nodeId, parameter)
  }

  reorderNode(nodeId: string, index: number): void {
    this.#nodes.reorderNode(nodeId, index)
  }

  defineAsset(name: string): AssetDefinition {
    return this.#assets.defineAsset(name)
  }

  registerAssetDefinition(definitionId: string, name: string): AssetDefinition {
    return this.#assets.register(definitionId, name)
  }

  registerMaterialDefinition(
    definitionId: string,
    name: string,
    parameters: readonly MaterialParameterDefault[] = [],
    shaderId: string | null = null,
  ): MaterialDefinition {
    return this.#materials.register(definitionId, name, parameters, shaderId)
  }

  registerShaderDefinition(
    definitionId: string,
    name: string,
    parameters: readonly MaterialParameterDefault[] = [],
  ): ShaderDefinition {
    return this.#shaders.register(definitionId, name, parameters)
  }

  getMaterialDefinition(definitionId: string): MaterialDefinition {
    return this.#resolveMaterialDefinition(definitionId)
  }

  getShaderDefinition(definitionId: string): ShaderDefinition {
    const embedded = this.#embeddedShaders.get(definitionId)
    if (embedded) {
      return new ShaderDefinition(
        embedded.id,
        embedded.name,
        embeddedShaderParameters(embedded.defaultUniforms),
      )
    }
    return this.#shaders.getDefinition(definitionId)
  }

  getAssetDefinition(definitionId: string): AssetDefinition {
    const embedded = this.#embeddedAssets.get(definitionId)
    if (embedded) {
      return new AssetDefinition(embedded.id, embedded.name)
    }
    return this.#assets.getDefinition(definitionId)
  }

  getEmbeddedAsset(definitionId: string): EmbeddedAsset | undefined {
    return this.#embeddedAssets.get(definitionId)
  }

  getEmbeddedMaterial(definitionId: string): EmbeddedMaterialDefinition | undefined {
    return this.#embeddedMaterials.get(definitionId)
  }

  getEmbeddedShader(definitionId: string): EmbeddedShaderDefinition | undefined {
    return this.#embeddedShaders.get(definitionId)
  }

  get embeddedAssets(): readonly EmbeddedAsset[] {
    return [...this.#embeddedAssets.values()]
  }

  get embeddedMaterials(): readonly EmbeddedMaterialDefinition[] {
    return [...this.#embeddedMaterials.values()]
  }

  get embeddedShaders(): readonly EmbeddedShaderDefinition[] {
    return [...this.#embeddedShaders.values()]
  }

  embedAsset(asset: EmbeddedAsset): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    project.embedAsset(asset)
    this.#embeddedAssets.set(asset.id, asset)
  }

  embedMaterial(definition: EmbeddedMaterialDefinition): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    project.embedMaterial(definition)
    this.#embeddedMaterials.set(definition.id, definition)
  }

  embedShader(definition: EmbeddedShaderDefinition): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    project.embedShader(definition)
    this.#embeddedShaders.set(definition.id, definition)
  }

  get embeddedDataSources(): readonly EmbeddedDataSourceUnion[] {
    return [...this.#embeddedDataSources.values()]
  }

  embedDataSource(definition: EmbeddedDataSourceUnion): void {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    project.embedDataSource(definition)
    this.#embeddedDataSources.set(definition.id, definition)
  }

  removeDataSource(id: string): boolean {
    const project = this.#projects.current
    if (!project) {
      return false
    }
    const removed = project.removeDataSource(id)
    if (removed) {
      this.#embeddedDataSources.delete(id)
    }
    return removed
  }

  get assetDefinitions(): readonly AssetDefinition[] {
    return this.#assets.definitions
  }

  get materialDefinitions(): readonly MaterialDefinition[] {
    return this.#materials.definitions
  }

  // --- Clip methods ---

  get clips(): readonly ClipDefinition[] {
    return this.#clips.clips
  }

  getClip(clipId: string): ClipDefinition {
    return this.#clips.getClip(clipId)
  }

  createClip(
    name: string,
    duration: number,
    category: string,
    params: ClipParam[],
    channels: ClipChannelDef[],
  ): ClipDefinition {
    return this.#clips.createClip(name, duration, category, params, channels)
  }

  deleteClip(clipId: string): ClipDefinition {
    return this.#clips.deleteClip(clipId)
  }

  renameClip(clipId: string, name: string): void {
    this.#clips.renameClip(clipId, name)
  }

  duplicateClip(clipId: string): ClipDefinition {
    return this.#clips.duplicateClip(clipId)
  }

  setClipDuration(clipId: string, duration: number): void {
    this.#clips.setDuration(clipId, duration)
  }

  setClipCategory(clipId: string, category: string): void {
    this.#clips.setCategory(clipId, category)
  }

  setClipParamDefault(clipId: string, paramKey: string, defaultValue: number): void {
    this.#clips.setParamDefault(clipId, paramKey, defaultValue)
  }

  setClipChannelParamLink(
    clipId: string,
    channel: AnimationProperty,
    paramKey: string | null,
  ): void {
    this.#clips.setChannelParamLink(clipId, channel, paramKey)
  }

  addClipChannel(clipId: string, channelDef: ClipChannelDef): void {
    this.#clips.addChannel(clipId, channelDef)
  }

  removeClipChannel(clipId: string, channel: AnimationProperty): void {
    this.#clips.removeChannel(clipId, channel)
  }

  importClip(clip: ClipDefinition): void {
    this.#clips.importClip(clip)
  }

  importClipFromLibrary(entry: import('./clipDefinition').LibraryClipInput): ClipDefinition {
    return this.#clips.importClipFromLibrary(entry)
  }

  getClipChannelKeyframes(clipId: string, channel: AnimationProperty): readonly Keyframe[] {
    return this.#clips.getChannelKeyframes(clipId, channel)
  }

  addClipChannelKeyframe(
    clipId: string,
    channel: AnimationProperty,
    time: number,
    value: number,
  ): Keyframe {
    return this.#clips.addChannelKeyframe(clipId, channel, time, value)
  }

  deleteClipChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    keyframeIds: readonly string[],
  ): Keyframe[] {
    return this.#clips.deleteChannelKeyframes(clipId, channel, keyframeIds)
  }

  moveClipChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    moves: readonly { keyframeId: string; newTime: number }[],
  ): { keyframeId: string; oldTime: number }[] {
    return this.#clips.moveChannelKeyframes(clipId, channel, moves)
  }

  scaleClipChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    keyframeIds: readonly string[],
    pivot: number,
    factor: number,
  ): { keyframeId: string; oldTime: number }[] {
    return this.#clips.scaleChannelKeyframes(clipId, channel, keyframeIds, pivot, factor)
  }

  setClipChannelKeyframeValue(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
    value: number,
  ): number {
    return this.#clips.setChannelKeyframeValue(clipId, channel, keyframeId, value)
  }

  setClipChannelKeyframeInterpolation(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
    interpolation: unknown,
  ): InterpolationType {
    return this.#clips.setChannelKeyframeInterpolation(clipId, channel, keyframeId, interpolation)
  }

  setClipChannelKeyframeTangents(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
    tangentIn: KeyframeTangent,
    tangentOut: KeyframeTangent,
  ): { tangentIn: KeyframeTangent; tangentOut: KeyframeTangent } {
    return this.#clips.setChannelKeyframeTangents(
      clipId,
      channel,
      keyframeId,
      tangentIn,
      tangentOut,
    )
  }

  pasteClipChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    payload: {
      keyframes: readonly {
        time: number
        value: unknown
        interpolation: InterpolationType
        tangentIn: KeyframeTangent
        tangentOut: KeyframeTangent
      }[]
    },
    atTime: number,
  ): Keyframe[] {
    return this.#clips.pasteChannelKeyframes(clipId, channel, payload, atTime)
  }

  duplicateClipChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    keyframeIds: readonly string[],
  ): Keyframe[] {
    return this.#clips.duplicateChannelKeyframes(clipId, channel, keyframeIds)
  }

  isClipReferenced(clipId: string): boolean {
    for (const slide of this.#projects.current?.slides ?? []) {
      for (const node of walkPreOrder(slide.scene.root)) {
        if (node.clipInstances.some((inst) => inst.clipId === clipId)) {
          return true
        }
      }
    }
    return false
  }

  getClipBlockingNodeNames(clipId: string): string[] {
    const names: string[] = []
    for (const slide of this.#projects.current?.slides ?? []) {
      for (const node of walkPreOrder(slide.scene.root)) {
        if (node.clipInstances.some((inst) => inst.clipId === clipId)) {
          names.push(node.name)
        }
      }
    }
    return names
  }

  get shaderDefinitions(): readonly ShaderDefinition[] {
    return this.#shaders.definitions
  }

  createAssetInstance(
    sceneId: string,
    parentId: string,
    definitionId: string,
    name: string,
    options?: Omit<CreateNodeOptions, 'components'>,
  ): SceneNode {
    const definition = this.getAssetDefinition(definitionId)
    return this.#assets.createInstanceFromDefinition(sceneId, parentId, definition, name, options)
  }

  toJSON(): LessonJSON {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const json = toLessonJSON(project)
    const ikJson = this.#ik.toJSON()
    const hasIK = ikJson.chains.length > 0
    const constraintsJson = this.#constraints.toJSON()
    const hasConstraints = Object.keys(constraintsJson.nodeConstraints).length > 0
    // Add clips to the top-level clips array
    if (this.#clips.clips.length > 0 || hasIK || hasConstraints) {
      return {
        ...json,
        ...(this.#clips.clips.length > 0
          ? { clips: this.#clips.clips.map((clip) => clip.toJSON()) }
          : {}),
        ...(hasIK ? { ikChains: ikJson } : {}),
        ...(hasConstraints ? { constraints: constraintsJson } : {}),
      }
    }
    return json
  }

  restoreFromJSON(json: LessonJSON): void {
    this.#validateOrThrow(json)
    const project = buildProjectFromJSON(json, this.#materials.definitions)
    try {
      this.#replaceProject(project)
      // Restore clips from JSON (top-level clips array, fallback to library.clips)
      const clips = parseClipsFromLessonJSON(json)
      for (const clip of clips) {
        this.#clips.importClip(clip)
      }
      // Restore IK chains from JSON
      if (json.ikChains) {
        this.#ik.restoreFromJSON(json.ikChains)
      }
      // Restore constraints from JSON
      if (json.constraints) {
        this.#constraints.restoreFromJSON(json.constraints)
      }
      const first = project.slides[0]
      this.#activeSlideId = first ? first.id : null
      this.#bus.emit({ type: 'ProjectLoaded', projectId: project.id })
      if (first) {
        this.#bus.emit({ type: 'SlideActivated', slideId: first.id })
      }
    } catch (error) {
      this.#nodes.clear()
      this.#scenes.clear()
      this.#projects.clear()
      throw error
    }
  }

  // --- Clip instance methods ---

  getClipInstances(nodeId: string): readonly ClipInstance[] {
    return this.getNode(nodeId).clipInstances
  }

  getClipInstance(nodeId: string, instanceId: string): ClipInstance {
    const node = this.getNode(nodeId)
    const instance = node.clipInstances.find((inst) => inst.id === instanceId)
    if (!instance) {
      throw new Error(`Clip instance not found: ${instanceId}`)
    }
    return instance
  }

  assignClipInstance(
    nodeId: string,
    clipId: string,
    startTime: number,
    speed: number,
    enabled: boolean,
    paramOverrides: Record<string, number>,
  ): ClipInstance {
    this.getClip(clipId)
    const node = this.getNode(nodeId)
    const instance = createClipInstance(clipId, startTime, speed, enabled, paramOverrides)
    node.clipInstances.push(instance)
    this.#bus.emit({ type: 'ClipInstanceAdded', nodeId, instanceId: instance.id })
    return instance
  }

  removeClipInstance(nodeId: string, instanceId: string): ClipInstance {
    const node = this.getNode(nodeId)
    const index = node.clipInstances.findIndex((inst) => inst.id === instanceId)
    if (index === -1) {
      throw new Error(`Clip instance not found: ${instanceId}`)
    }
    const [removed] = node.clipInstances.splice(index, 1)
    this.#bus.emit({ type: 'ClipInstanceRemoved', nodeId, instanceId })
    return removed
  }

  moveClipLayer(nodeId: string, instanceId: string, newIndex: number): void {
    const node = this.getNode(nodeId)
    const index = node.clipInstances.findIndex((inst) => inst.id === instanceId)
    if (index === -1) {
      throw new Error(`Clip instance not found: ${instanceId}`)
    }
    if (newIndex < 0 || newIndex >= node.clipInstances.length) {
      throw new Error(`Layer index out of bounds: ${newIndex}`)
    }
    const [instance] = node.clipInstances.splice(index, 1)
    node.clipInstances.splice(newIndex, 0, instance)
    this.#bus.emit({ type: 'ClipLayerMoved', nodeId, instanceId })
  }

  setClipInstanceStartTime(nodeId: string, instanceId: string, startTime: number): void {
    const instance = this.getClipInstance(nodeId, instanceId)
    instance.startTime = startTime
    this.#bus.emit({ type: 'ClipInstanceTimeChanged', nodeId, instanceId })
  }

  setClipInstanceSpeed(nodeId: string, instanceId: string, speed: number): void {
    const instance = this.getClipInstance(nodeId, instanceId)
    instance.speed = speed
    this.#bus.emit({ type: 'ClipInstanceSpeedChanged', nodeId, instanceId })
  }

  setClipInstanceEnabled(nodeId: string, instanceId: string, enabled: boolean): void {
    const instance = this.getClipInstance(nodeId, instanceId)
    instance.enabled = enabled
    this.#bus.emit({ type: 'ClipInstanceEnabledChanged', nodeId, instanceId })
  }

  setClipInstanceParamOverride(
    nodeId: string,
    instanceId: string,
    paramKey: string,
    value: number,
  ): void {
    const instance = this.getClipInstance(nodeId, instanceId)
    instance.paramOverrides[paramKey] = value
    this.#bus.emit({ type: 'ClipParamOverridden', nodeId, instanceId, paramKey })
  }

  clearClipInstanceParamOverride(nodeId: string, instanceId: string, paramKey: string): void {
    const instance = this.getClipInstance(nodeId, instanceId)
    delete instance.paramOverrides[paramKey]
    this.#bus.emit({ type: 'ClipParamOverridden', nodeId, instanceId, paramKey })
  }

  // --- IK methods ---

  createIKChain(
    slideId: string,
    boneIds: readonly string[],
    target: import('./ikChain').BoneIKTarget,
    poleTarget: import('./ikChain').PoleTarget | null = null,
  ): import('./ikChain').IKChain {
    const slide = this.getSlide(slideId)
    const ghostNode = this.createGhostNode(
      slide.scene.id,
      'IK Target',
      target.position.x,
      target.position.y,
    )
    const chain = this.#ik.createChain(
      slideId,
      boneIds,
      { ...target, nodeId: ghostNode.id },
      poleTarget,
    )
    chain.ghostNodeId = ghostNode.id
    return chain
  }

  deleteIKChain(chainId: string): import('./ikChain').IKChain {
    const chain = this.#ik.getChain(chainId)
    if (chain.ghostNodeId) {
      try {
        this.deleteGhostNode(chain.ghostNodeId)
      } catch {
        // ghost node may already be gone
      }
    }
    return this.#ik.deleteChain(chainId)
  }

  getIKChain(chainId: string): import('./ikChain').IKChain {
    return this.#ik.getChain(chainId)
  }

  getIKChainsForSlide(slideId: string): readonly import('./ikChain').IKChain[] {
    return this.#ik.getChainsForSlide(slideId)
  }

  getIKChainsForBone(boneId: string): readonly import('./ikChain').IKChain[] {
    return this.#ik.getChainsForBone(boneId)
  }

  setIKTarget(chainId: string, target: import('./ikChain').BoneIKTarget): void {
    this.#ik.setTarget(chainId, target)
  }

  setIKPoleTarget(chainId: string, poleTarget: import('./ikChain').PoleTarget | null): void {
    this.#ik.setPoleTarget(chainId, poleTarget)
  }

  /** Internal method to expose IKManager to renderer for IK evaluation. */
  getIKManager(): import('./ikManager').IKManager {
    return this.#ik
  }

  // --- Ghost node helpers (for IK target anchors) ---

  createGhostNode(sceneId: string, name: string, x: number, y: number, id?: string): SceneNode {
    const scene = this.getScene(sceneId)
    return this.createNode(sceneId, scene.root.id, name, {
      id,
      transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { ghost: { kind: 'ghost' } },
    })
  }

  deleteGhostNode(nodeId: string): void {
    this.removeNode(nodeId)
  }

  getGhostNodeIds(): string[] {
    const result: string[] = []
    for (const slide of this.#projects.current?.slides ?? []) {
      for (const node of walkPreOrder(slide.scene.root)) {
        if (node.components.ghost) {
          result.push(node.id)
        }
      }
    }
    return result
  }

  // --- Constraint methods ---

  addConstraint(
    nodeId: string,
    type: ConstraintType,
    priority: number,
    params: ConstraintParams,
  ): Constraint {
    return this.#constraints.addConstraint(nodeId, type, priority, params)
  }

  removeConstraint(nodeId: string, constraintId: string): Constraint {
    return this.#constraints.removeConstraint(nodeId, constraintId)
  }

  setConstraintParams(nodeId: string, constraintId: string, params: ConstraintParams): void {
    this.#constraints.setConstraintParams(nodeId, constraintId, params)
  }

  getConstraint(constraintId: string): Constraint {
    return this.#constraints.getConstraint(constraintId)
  }

  getConstraintsForNode(nodeId: string): readonly Constraint[] {
    return this.#constraints.getConstraintsForNode(nodeId)
  }

  getConstraintManager(): ConstraintManager {
    return this.#constraints
  }

  #resolveMaterialDefinition(definitionId: string): MaterialDefinition {
    const embedded = this.#embeddedMaterials.get(definitionId)
    if (embedded) {
      return new MaterialDefinition(
        embedded.id,
        embedded.name,
        embedded.parameters,
        embedded.shaderId,
      )
    }
    return this.#materials.getDefinition(definitionId)
  }

  #validateOrThrow(json: unknown): void {
    const errors = validate(json)
    if (errors.length > 0) {
      throw new Error(errors.join('; '))
    }
  }

  #replaceProject(project: Project): void {
    this.#nodes.clear()
    this.#scenes.clear()
    this.#embeddedAssets.clear()
    for (const asset of project.embeddedAssets) {
      this.#embeddedAssets.set(asset.id, asset)
    }
    this.#embeddedMaterials.clear()
    for (const material of project.embeddedMaterials) {
      this.#embeddedMaterials.set(material.id, material)
    }
    this.#embeddedShaders.clear()
    this.#ik.clear()
    this.#constraints.clear()
    for (const shader of project.embeddedShaders) {
      this.#embeddedShaders.set(shader.id, shader)
    }
    this.#embeddedDataSources.clear()
    for (const ds of project.embeddedDataSources) {
      this.#embeddedDataSources.set(ds.id, ds)
    }
    for (const slide of project.slides) {
      this.#scenes.install(slide.scene)
    }
    this.#projects.install(project)
  }
}

export function createEngineInternal(): Engine {
  return new Engine()
}

export { createEngineInternal as createEngine }

export function toReadOnly(engine: Engine): EnginePublic {
  return {
    get project() {
      return engine.project
    },
    get assetDefinitions() {
      return engine.assetDefinitions
    },
    get materialDefinitions() {
      return engine.materialDefinitions
    },
    get shaderDefinitions() {
      return engine.shaderDefinitions
    },
    get embeddedAssets() {
      return engine.embeddedAssets
    },
    get embeddedMaterials() {
      return engine.embeddedMaterials
    },
    get embeddedShaders() {
      return engine.embeddedShaders
    },
    get embeddedDataSources() {
      return engine.embeddedDataSources
    },
    get activeSlideId() {
      return engine.activeSlideId
    },
    get clips() {
      return engine.clips
    },
    subscribe: (listener) => engine.subscribe(listener),
    openProject: (project, clips) => engine.openProject(project, clips),
    setActiveSlide: (slideId) => engine.setActiveSlide(slideId),
    getActiveSlide: () => engine.getActiveSlide(),
    getSlide: (slideId) => engine.getSlide(slideId),
    getNode: (nodeId) => engine.getNode(nodeId),
    getScene: (sceneId) => engine.getScene(sceneId),
    getAssetDefinition: (definitionId) => engine.getAssetDefinition(definitionId),
    getMaterialDefinition: (definitionId) => engine.getMaterialDefinition(definitionId),
    getShaderDefinition: (definitionId) => engine.getShaderDefinition(definitionId),
    getEmbeddedAsset: (definitionId) => engine.getEmbeddedAsset(definitionId),
    getEmbeddedMaterial: (definitionId) => engine.getEmbeddedMaterial(definitionId),
    getEmbeddedShader: (definitionId) => engine.getEmbeddedShader(definitionId),
    embedAsset: (asset) => engine.embedAsset(asset),
    embedMaterial: (definition) => engine.embedMaterial(definition),
    embedShader: (definition) => engine.embedShader(definition),
    embedDataSource: (definition) => engine.embedDataSource(definition),
    removeDataSource: (id) => engine.removeDataSource(id),
    setTableComponent: (nodeId, table) => engine.setTableComponent(nodeId, table),
    getKeyframes: (nodeId, property) => engine.getKeyframes(nodeId, property),
    getMaterialKeyframes: (nodeId, parameter) => engine.getMaterialKeyframes(nodeId, parameter),
    hasMaterialTrack: (nodeId, parameter) => engine.hasMaterialTrack(nodeId, parameter),
    getAnimatableParameters: (nodeId) => engine.getAnimatableParameters(nodeId),
    evaluateNode: (nodeId, time, target) => engine.evaluateNode(nodeId, time, target),
    evaluateMaterialOverrides: (nodeId, time, target) =>
      engine.evaluateMaterialOverrides(nodeId, time, target),
    evaluateMeshDeformation: (nodeId, time, boneWorldTransforms) =>
      engine.evaluateMeshDeformation(nodeId, time, boneWorldTransforms),
    getIKManager: () => engine.getIKManager(),
    getConstraintManager: () => engine.getConstraintManager(),
    getClip: (clipId) => engine.getClip(clipId),
    getClipChannelKeyframes: (clipId, channel) => engine.getClipChannelKeyframes(clipId, channel),
    getClipInstances: (nodeId) => engine.getClipInstances(nodeId),
    isClipReferenced: (clipId) => engine.isClipReferenced(clipId),
    getClipBlockingNodeNames: (clipId) => engine.getClipBlockingNodeNames(clipId),
    toJSON: () => engine.toJSON(),
    restoreFromJSON: (json) => engine.restoreFromJSON(json),
  }
}

export type { EnginePublic } from './engine'
