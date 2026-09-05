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
import { createShape, duplicateShape as duplicateShapeModel, uniqueShapeName } from './shape'
import type { Shape } from './shape'
import type { MaterialOverrideValue, MaterialOverrides } from './materialInstance'
import { DEFAULT_MATERIAL_PARAMETERS } from './materialResolution'
import type { MaterialParameterDefault } from './materialResolution'
import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import { embeddedShaderParameters } from './embeddedShader'
import type { EmbeddedShaderDefinition } from './embeddedShader'
import type {
  ChartComponent,
  TableComponent,
  TableRowComponent,
  TableCellComponent,
  TextComponent,
} from './components'
import type { CreateProjectInput, EmbeddedDataSourceUnion, Project } from './project'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import { isGroupNode, walkPreOrder } from './sceneNode'
import { clampShadowEffect, shadowEffectFromJSON } from './shadowEffect'
import type { ShadowEffect } from './shadowEffect'
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
  parseClipCollectionsFromLessonJSON,
} from './lessonSerializer'

import type { EnginePublic } from './engine'
import { ClipManager } from './clipManager'
import { ClipCollectionManager } from './clipCollectionManager'
import { ClipCollection } from './clipCollection'
import { IKManager } from './ikManager'
import { ConstraintManager } from './constraintManager'
import type { Constraint, ConstraintType, ConstraintParams } from './constraint'
import type { ClipChannelDef, ClipParam } from './clipDefinition'
import { ClipDefinition } from './clipDefinition'
import type { ClipInstance } from './clipInstance'
import { createClipInstance } from './clipInstance'
import { getAnimatableParameters, type AnimatableParameter } from './animatableParameters'
import type { MeshData } from './mesh'
import { evaluateMeshDeformation, evaluateMorphedMeshDeformation } from './meshDeformationEvaluator'
import { generateCircleMeshData } from './circleComponent'
import type { MorphBinding } from './shape'
import type { DeformedMeshResult } from './meshDeformationEvaluator'
import type { WorldTransform } from './worldTransform'
import { relativeTransform, worldTransformOf } from './worldTransform'
import {
  clampAudioFade,
  createAudioClip,
  getAudioClipPlaybackDuration,
  getAudioClipSourceDuration,
  isAudioTrackId,
  newAudioClipId,
} from './audioClip'
import type { AudioClip, AudioTrackId } from './audioClip'
import {
  createAudioSegment,
  estimatePrompterDuration,
  getPrompterSecondsPerCharacter,
  getPrompterSplitChars,
  hasPrompterPartAudio,
  mergePrompterPartTexts,
  newAudioSegmentId,
  newPrompterPartId,
  reflowPrompter,
  redistributeDurations,
  splitImportText,
  splitPrompterPartText,
  splitPrompterPartTextForWordRange,
} from './prompter'
import {
  getActivePrompterPartId as getActivePrompterPartIdSync,
  getAudibleClips as getAudibleClipsSync,
  getClippedPlaybackDuration as getClippedPlaybackDurationSync,
  getClippedEnd as getClippedEndSync,
  LOOKAHEAD_SECONDS as AUDIO_LOOKAHEAD_SECONDS,
} from './audioSync'
import {
  buildExportJobDescriptor as buildExportJobDescriptorCore,
  buildPerSlideExportDescriptor as buildPerSlideExportDescriptorCore,
  getDerivedAssetCacheKey as getDerivedAssetCacheKeyCore,
  getExportFrameCount as getExportFrameCountCore,
  getExportFrameTimestamps as getExportFrameTimestampsCore,
  getRubberbandTempoForPlaybackRate as getRubberbandTempoForPlaybackRateCore,
  type ExportJobDescriptor,
  type ExportPerSlideDescriptor,
  type ExportSettings,
} from './export'
import { newId } from './ids'
import { newClipId } from './clipDefinition'
import { newClipCollectionId } from './clipCollection'
import { Keyframe as KeyframeModel } from './keyframe'
import {
  REUSABLE_OBJECT_VERSION,
  validateReusableObject,
  type ReusableObjectJSON,
} from './reusableObject'
import { materialFromJSON } from './materialInstance'
import { clipInstanceFromJSON } from './clipInstance'

function constraintParamsToJSON(c: Constraint): import('./json').ConstraintParamsJSON {
  switch (c.type) {
    case 'rotationLimit': {
      const p = c.params as import('./constraint').RotationLimitParams
      return { minRotation: p.minRotation, maxRotation: p.maxRotation }
    }
    case 'lookAt': {
      const p = c.params as import('./constraint').LookAtParams
      return { targetX: p.targetX, targetY: p.targetY, targetNodeId: p.targetNodeId }
    }
    case 'distance': {
      const p = c.params as import('./constraint').DistanceParams
      return {
        targetNodeId: p.targetNodeId,
        minDistance: p.minDistance,
        maxDistance: p.maxDistance,
      }
    }
    case 'parent': {
      const p = c.params as import('./constraint').ParentConstraintParams
      return {
        targetNodeId: p.targetNodeId,
        positionInfluence: p.positionInfluence,
        rotationInfluence: p.rotationInfluence,
        scaleInfluence: p.scaleInfluence,
      }
    }
  }
}

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
  readonly #clipCollections: ClipCollectionManager
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
    this.#clipCollections = new ClipCollectionManager(this.#bus)
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

  openProject(
    project: Project,
    clips?: readonly ClipDefinition[],
    collections?: readonly ClipCollection[],
  ): void {
    this.#validateOrThrow(toLessonJSON(project, clips, collections))
    this.#replaceProject(project)
    this.#clips.clear()
    if (clips) {
      for (const clip of clips) {
        this.#clips.importClip(clip)
      }
    }
    this.#clipCollections.clear()
    if (collections) {
      for (const c of collections) {
        this.#clipCollections.importCollection(c)
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
    this.#clipCollections.clear()
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

  // --- Audio & Prompter ---

  createPrompterPart(
    slideId: string,
    input: { id: string; text: string; duration: number; insertIndex?: number },
  ): void {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) {
      slide.prompter = { parts: [] }
    }
    const insertIndex = input.insertIndex ?? slide.prompter.parts.length
    if (insertIndex < 0 || insertIndex > slide.prompter.parts.length) {
      throw new Error(`insertIndex out of bounds: ${insertIndex}`)
    }
    const previous = slide.prompter.parts
    // Preserve gaps: insertionTime is visual prevEnd (tight to previous block), not prefix-sum, so gaps are kept
    const insertionTime = insertIndex === 0 ? 0 : (previous[insertIndex - 1]?.endTime ?? 0)
    // Capture downstream parts and clips before mutation to preserve gaps (shift, not reflow)
    const downstreamParts = previous.slice(insertIndex)
    const shiftedClips: { id: string; oldTimelineStart: number }[] = []
    for (const clip of slide.audio.clips) {
      if (clip.timelineStart >= insertionTime - 1e-6) {
        shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
      }
    }
    const newPart = {
      id: input.id,
      text: input.text,
      startTime: insertionTime,
      endTime: insertionTime + input.duration,
      duration: input.duration,
    }
    slide.prompter.parts.splice(insertIndex, 0, newPart)
    // Preserve gaps: shift downstream parts (not reflow) so existing gaps stay
    for (const part of downstreamParts) {
      part.startTime += input.duration
      part.endTime += input.duration
    }
    // Shift downstream clips right by inserted duration to stay with their parts / preserve gaps
    for (const sc of shiftedClips) {
      const clip = slide.audio.clips.find((c) => c.id === sc.id)
      if (clip) clip.timelineStart = sc.oldTimelineStart + input.duration
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    if (shiftedClips.length > 0) {
      this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    }
  }

  importPrompter(
    slideId: string,
    rawText: string,
    options?: { mode?: 'replace' | 'append'; insertIndex?: number },
  ): {
    partIds: string[]
    oldParts: { id: string; text: string; startTime: number; endTime: number; duration: number }[]
    mode: 'replace' | 'append'
    insertIndex?: number
    deletedClips?: readonly { clip: AudioClip; index: number }[]
    shiftedClips?: readonly { id: string; oldTimelineStart: number }[]
  } {
    const slide = this.getSlide(slideId)
    const settings = this.#projects.current?.settings ?? {}
    const splitChars = getPrompterSplitChars(settings)
    const secondsPerCharacter = getPrompterSecondsPerCharacter(settings)
    const oldParts = slide.prompter
      ? slide.prompter.parts.map((p) => ({
          id: p.id,
          text: p.text,
          startTime: p.startTime,
          endTime: p.endTime,
          duration: p.duration,
          ...(p.audioClipId ? { audioClipId: p.audioClipId } : {}),
          ...(p.audioAssetId ? { audioAssetId: p.audioAssetId } : {}),
          ...(p.promptId ? { promptId: p.promptId } : {}),
          ...(p.status ? { status: p.status } : {}),
          ...(p.segments ? { segments: JSON.parse(JSON.stringify(p.segments)) } : {}),
        }))
      : []
    const texts = splitImportText(rawText, splitChars)
    const newPartsRaw = texts.map((text) => {
      const duration = estimatePrompterDuration(text, secondsPerCharacter)
      return { id: newPrompterPartId(), text, startTime: 0, endTime: duration, duration }
    })
    const mode = options?.mode ?? 'replace'
    if (mode === 'append' && slide.prompter && slide.prompter.parts.length > 0) {
      const insertIndex = options?.insertIndex ?? slide.prompter.parts.length
      if (insertIndex < 0 || insertIndex > slide.prompter.parts.length) {
        throw new Error(`insertIndex out of bounds: ${insertIndex}`)
      }
      const insertionTime = slide.prompter.parts
        .slice(0, insertIndex)
        .reduce((sum, p) => sum + p.duration, 0)
      const totalDuration = newPartsRaw.reduce((sum, p) => sum + p.duration, 0)
      const shiftedClips: { id: string; oldTimelineStart: number }[] = []
      for (const clip of slide.audio.clips) {
        if (clip.timelineStart >= insertionTime - 1e-6) {
          shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
        }
      }
      // Insert new parts at index, preserve existing parts and clips
      slide.prompter.parts.splice(insertIndex, 0, ...newPartsRaw)
      reflowPrompter(slide.prompter)
      for (const sc of shiftedClips) {
        const clip = slide.audio.clips.find((c) => c.id === sc.id)
        if (clip) clip.timelineStart = sc.oldTimelineStart + totalDuration
      }
      this.#bus.emit({
        type: 'PrompterChanged',
        slideId,
      } as unknown as import('./events').EngineEvent)
      if (shiftedClips.length > 0) {
        this.#bus.emit({
          type: 'AudioChanged',
          slideId,
        } as unknown as import('./events').EngineEvent)
      }
      return {
        partIds: newPartsRaw.map((p) => p.id),
        oldParts: oldParts as {
          id: string
          text: string
          startTime: number
          endTime: number
          duration: number
        }[],
        mode: 'append',
        insertIndex,
        shiftedClips,
      }
    }
    // Replace mode: delete linked clips of old parts (asset preserved), then replace
    const clipIdsToDelete = new Set<string>()
    if (slide.prompter) {
      for (const part of slide.prompter.parts) {
        if (part.audioClipId) clipIdsToDelete.add(part.audioClipId)
        if (part.segments) for (const seg of part.segments) clipIdsToDelete.add(seg.audioClipId)
      }
    }
    const deletedClips: { clip: AudioClip; index: number }[] = []
    for (const cid of clipIdsToDelete) {
      const cIdx = slide.audio.clips.findIndex((c) => c.id === cid)
      if (cIdx !== -1) {
        const [removed] = slide.audio.clips.splice(cIdx, 1)
        deletedClips.push({ clip: removed, index: cIdx })
      }
    }
    slide.prompter = { parts: newPartsRaw }
    reflowPrompter(slide.prompter)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    if (deletedClips.length > 0) {
      this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    }
    return {
      partIds: newPartsRaw.map((p) => p.id),
      oldParts: oldParts as {
        id: string
        text: string
        startTime: number
        endTime: number
        duration: number
      }[],
      mode: 'replace',
      deletedClips,
    }
  }

  splitPrompterPart(
    slideId: string,
    partId: string,
    wordIndex: number,
    mode: 'left' | 'right' | 'out',
  ): { newPartIds: string[]; oldText: string; oldDuration: number } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const index = slide.prompter.parts.findIndex((p) => p.id === partId)
    if (index === -1) throw new Error(`PrompterPart not found: ${partId}`)
    const part = slide.prompter.parts[index]
    const oldText = part.text
    const oldDuration = part.duration
    const newTexts = splitPrompterPartText(part.text, wordIndex, mode)
    if (newTexts.length <= 1)
      throw new Error('Split would not create new parts (whitespace-only or invalid word)')
    const durations = redistributeDurations(part.duration, newTexts)
    const newParts = newTexts.map((text, i) => ({
      id: i === 0 ? part.id : newPrompterPartId(),
      text,
      startTime: 0,
      endTime: 0,
      duration: durations[i],
      ...(part.audioClipId && i === 0 ? { audioClipId: part.audioClipId } : {}),
      ...(part.audioAssetId && i === 0 ? { audioAssetId: part.audioAssetId } : {}),
      ...(part.promptId && i === 0 ? { promptId: part.promptId } : {}),
      ...(part.status && i === 0 ? { status: part.status } : {}),
    }))
    // Update existing first part in place, insert rest after
    part.text = newParts[0].text
    part.duration = newParts[0].duration
    part.audioClipId = (newParts[0] as { audioClipId?: string }).audioClipId
    part.audioAssetId = (newParts[0] as { audioAssetId?: string }).audioAssetId
    part.promptId = (newParts[0] as { promptId?: string }).promptId
    part.status = (newParts[0] as { status?: import('./prompter').PrompterPartStatus }).status
    if (part.audioClipId === undefined) delete (part as { audioClipId?: string }).audioClipId
    if (part.audioAssetId === undefined) delete (part as { audioAssetId?: string }).audioAssetId
    if (part.promptId === undefined) delete (part as { promptId?: string }).promptId
    if (part.status === undefined) delete (part as { status?: string }).status
    // Insert remaining
    for (let i = 1; i < newParts.length; i++) {
      slide.prompter.parts.splice(index + i, 0, newParts[i] as import('./prompter').PrompterPart)
    }
    if (slide.prompter) reflowPrompter(slide.prompter)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return { newPartIds: newParts.map((p) => p.id), oldText, oldDuration }
  }

  replacePrompterPartWordRange(
    slideId: string,
    partId: string,
    startWordIndex: number,
    endWordIndex: number,
    ttsAssetId: string,
  ): {
    oldPart: import('./prompter').PrompterPart
    oldClip?: AudioClip
    oldIndex: number
    newPartIds: string[]
    newClipIds: string[]
    deletedClipId?: string
  } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const index = slide.prompter.parts.findIndex((p) => p.id === partId)
    if (index === -1) throw new Error(`PrompterPart not found: ${partId}`)
    const part = slide.prompter.parts[index]
    // validate word indices via helper (will throw if out of bounds)
    const newTexts = splitPrompterPartTextForWordRange(part.text, startWordIndex, endWordIndex)
    if (newTexts.length === 0) throw new Error('Word range split produced no valid pieces')
    // validate TTS asset exists
    const ttsAsset = this.getEmbeddedAsset(ttsAssetId)
    if (!ttsAsset) throw new Error(`TTS AudioAsset not found: ${ttsAssetId}`)
    if (!ttsAsset.mimeType.startsWith('audio/')) throw new Error('TTS asset must be audio/*')
    const ttsDurationRaw = (ttsAsset.metadata as Record<string, unknown> | undefined)?.duration
    const ttsDuration =
      typeof ttsDurationRaw === 'number' && Number.isFinite(ttsDurationRaw) ? ttsDurationRaw : 1
    // Save old state for inverse
    const oldPartSnapshot: import('./prompter').PrompterPart = JSON.parse(JSON.stringify(part))
    const oldClip = part.audioClipId
      ? (slide.audio.clips.find((c) => c.id === part.audioClipId) ?? undefined)
      : undefined
    const oldClipCopy = oldClip ? JSON.parse(JSON.stringify(oldClip)) : undefined
    const oldIndex = index
    // Original asset for outer pieces (preserve non-destructively)
    const originalAssetId = part.audioAssetId
    const originalAsset = originalAssetId ? this.getEmbeddedAsset(originalAssetId) : undefined
    const originalDurationRaw = (originalAsset?.metadata as Record<string, unknown> | undefined)
      ?.duration
    const originalDuration =
      typeof originalDurationRaw === 'number' && Number.isFinite(originalDurationRaw)
        ? originalDurationRaw
        : part.duration

    // Determine left/right existence for mapping to TTS vs recorded
    const words: { word: string; start: number; end: number }[] = []
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(part.text)) !== null) {
      words.push({ word: m[0], start: m.index, end: m.index + m[0].length })
    }
    const startWord = words[startWordIndex]
    const leftTextRaw = part.text.slice(0, startWord.start)
    const leftExists = leftTextRaw.trim().length > 0

    // Map newTexts order to which is TTS (leftExists determines index; avoids duplicate-word trim collisions)
    let ttsIndex: number
    if (leftExists) ttsIndex = newTexts.length > 1 ? 1 : 0
    else ttsIndex = 0

    // Compute durations proportionally preserving total
    const durations = redistributeDurations(part.duration, newTexts)
    // Build new parts (keep first reuses original id)
    const newParts: import('./prompter').PrompterPart[] = newTexts.map((text, i) => ({
      id: i === 0 ? part.id : newPrompterPartId(),
      text,
      startTime: 0,
      endTime: 0,
      duration: durations[i],
      // audio linkage will be set after clip creation; clear stale
    }))

    // Remove old part and insert new parts
    // First mutate the original part in place for i===0, then splice rest
    // To simplify, remove old part entirely and insert new ones at old index
    slide.prompter.parts.splice(index, 1)
    for (let i = 0; i < newParts.length; i++) {
      slide.prompter.parts.splice(index + i, 0, newParts[i])
    }
    // Reflow gap-free to compute startTimes for clips
    reflowPrompter(slide.prompter)

    // Delete old clip if it existed (preserve asset)
    let deletedClipId: string | undefined
    if (oldClip) {
      const clipIdx = slide.audio.clips.findIndex((c) => c.id === oldClip.id)
      if (clipIdx !== -1) {
        slide.audio.clips.splice(clipIdx, 1)
        deletedClipId = oldClip.id
      }
    }

    // Create new clips and segments for each new piece
    const newClipIds: string[] = []
    // Need to map updated parts after reflow (they are at indices oldIndex..oldIndex+n-1)
    for (let i = 0; i < newParts.length; i++) {
      const newPart = slide.prompter.parts[oldIndex + i]
      const isTTS = i === ttsIndex
      let assetId: string | undefined
      let sourceEnd: number
      if (isTTS) {
        assetId = ttsAssetId
        sourceEnd = ttsDuration
      } else {
        // Outer recorded piece: reuse original asset if available, otherwise skip (silent)
        if (!originalAssetId || !originalAsset) {
          // Silent outer piece - no clip, no segment, ensure stale cleared
          newPart.status = undefined
          if (newPart.audioClipId) delete (newPart as { audioClipId?: string }).audioClipId
          if (newPart.audioAssetId) delete (newPart as { audioAssetId?: string }).audioAssetId
          if (newPart.segments) delete (newPart as { segments?: unknown }).segments
          delete (newPart as { status?: string }).status
          continue
        }
        assetId = originalAssetId
        sourceEnd = originalDuration
      }
      // Create clip at part's start
      const clip = createAudioClip({
        id: newAudioClipId(),
        assetId: assetId!,
        trackId: 'voice',
        timelineStart: newPart.startTime,
        sourceStart: 0,
        sourceEnd,
        volume: 1,
        muted: false,
        playbackRate: 1,
      })
      slide.audio.clips.push(clip)
      newClipIds.push(clip.id)
      // Link part to clip
      newPart.audioClipId = clip.id
      newPart.audioAssetId = assetId!
      // Clear stale (new binding clears)
      delete (newPart as { status?: string }).status
      // Create AudioSegment for this part (1 per part)
      const segment = createAudioSegment({
        id: newAudioSegmentId(),
        text: newPart.text,
        audioClipId: clip.id,
        audioAssetId: assetId!,
        order: 0,
      })
      newPart.segments = [segment]
    }

    // Also ensure any outer silent parts have no stale
    for (let i = 0; i < newParts.length; i++) {
      const p = slide.prompter.parts[oldIndex + i]
      if (!p.segments) {
        delete (p as { status?: string }).status
      }
    }

    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)

    return {
      oldPart: oldPartSnapshot,
      oldClip: oldClipCopy,
      oldIndex,
      newPartIds: newParts.map((p) => p.id),
      newClipIds,
      deletedClipId,
    }
  }

  splitPrompterPartByWordRange(
    slideId: string,
    partId: string,
    startWordIndex: number,
    endWordIndex: number,
  ): {
    oldPart: import('./prompter').PrompterPart
    oldClip?: AudioClip
    oldIndex: number
    newPartIds: string[]
    deletedClipId?: string
  } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const index = slide.prompter.parts.findIndex((p) => p.id === partId)
    if (index === -1) throw new Error(`PrompterPart not found: ${partId}`)
    const part = slide.prompter.parts[index]
    const newTexts = splitPrompterPartTextForWordRange(part.text, startWordIndex, endWordIndex)
    if (newTexts.length <= 1)
      throw new Error('Split would not create new parts (whitespace-only or invalid range)')
    const oldPartSnapshot: import('./prompter').PrompterPart = JSON.parse(JSON.stringify(part))
    const oldClip = part.audioClipId
      ? (slide.audio.clips.find((c) => c.id === part.audioClipId) ?? undefined)
      : undefined
    const oldClipCopy = oldClip ? JSON.parse(JSON.stringify(oldClip)) : undefined
    const oldIndex = index
    const durations = redistributeDurations(part.duration, newTexts)
    const newParts: import('./prompter').PrompterPart[] = newTexts.map((text, i) => ({
      id: i === 0 ? part.id : newPrompterPartId(),
      text,
      startTime: 0,
      endTime: 0,
      duration: durations[i],
    }))
    slide.prompter.parts.splice(index, 1)
    for (let i = 0; i < newParts.length; i++) {
      slide.prompter.parts.splice(index + i, 0, newParts[i])
    }
    reflowPrompter(slide.prompter)
    let deletedClipId: string | undefined
    if (oldClip) {
      const clipIdx = slide.audio.clips.findIndex((c) => c.id === oldClip.id)
      if (clipIdx !== -1) {
        slide.audio.clips.splice(clipIdx, 1)
        deletedClipId = oldClip.id
      }
    }
    for (let i = 0; i < newParts.length; i++) {
      const p = slide.prompter.parts[oldIndex + i]
      delete (p as { audioClipId?: string }).audioClipId
      delete (p as { audioAssetId?: string }).audioAssetId
      delete (p as { promptId?: string }).promptId
      delete (p as { status?: string }).status
      delete (p as { segments?: unknown }).segments
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    if (deletedClipId) {
      this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    }
    return {
      oldPart: oldPartSnapshot,
      oldClip: oldClipCopy,
      oldIndex,
      newPartIds: newParts.map((p) => p.id),
      deletedClipId,
    }
  }

  unitePrompterParts(
    slideId: string,
    leftPartId: string,
    rightPartId?: string,
  ): {
    mergedId: string
    oldParts: { id: string; text: string; duration: number; startTime: number; endTime: number }[]
  } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const leftIndex = slide.prompter.parts.findIndex((p) => p.id === leftPartId)
    if (leftIndex === -1) throw new Error(`PrompterPart not found: ${leftPartId}`)
    let rightIndex: number
    if (rightPartId !== undefined) {
      rightIndex = slide.prompter.parts.findIndex((p) => p.id === rightPartId)
      if (rightIndex === -1) throw new Error(`PrompterPart not found: ${rightPartId}`)
      if (rightIndex !== leftIndex + 1) throw new Error('PrompterParts to merge must be adjacent')
    } else {
      rightIndex = leftIndex + 1
      if (rightIndex >= slide.prompter.parts.length) throw new Error('No next part to merge')
    }
    const left = slide.prompter.parts[leftIndex]
    const right = slide.prompter.parts[rightIndex]
    const oldParts = [
      {
        id: left.id,
        text: left.text,
        duration: left.duration,
        startTime: left.startTime,
        endTime: left.endTime,
      },
      {
        id: right.id,
        text: right.text,
        duration: right.duration,
        startTime: right.startTime,
        endTime: right.endTime,
      },
    ]
    const newText = mergePrompterPartTexts(left.text, right.text)
    const newDuration = left.duration + right.duration
    left.text = newText
    left.duration = newDuration
    // Merge status: if either was stale, result is stale? Preserve if either had audio? We clear stale only when no audio; but merging with audio? Keep left's audio linkage if present? If right had audio, we drop it (v1 only 0..1). Clear status on merged unless still linked.
    // For simplicity, if left had audio, keep it; otherwise if right had audio, transfer? But spec says 0..1 per part, so merging two with audio is edge; we keep left's.
    // Status: if resulting part has audio, and text changed via merge (which is edit), then it should become stale per update semantics? But merge is intentional; we should maybe clear stale? For now, if left had audio, mark stale because text changed.
    if (hasPrompterPartAudio(left as import('./prompter').PrompterPart)) {
      left.status = 'stale'
    } else if (hasPrompterPartAudio(right as import('./prompter').PrompterPart)) {
      // transfer audio from right to merged (left) if left had no audio but right did
      left.audioClipId = right.audioClipId
      left.audioAssetId = right.audioAssetId
      left.promptId = right.promptId
      left.status = 'stale'
    } else {
      left.status = undefined
    }
    slide.prompter.parts.splice(rightIndex, 1)
    if (slide.prompter) reflowPrompter(slide.prompter)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return { mergedId: left.id, oldParts }
  }

  mergePrompterParts(
    slideId: string,
    leftPartId: string,
    rightPartId?: string,
  ): {
    mergedId: string
    oldParts: { id: string; text: string; duration: number; startTime: number; endTime: number }[]
  } {
    return this.unitePrompterParts(slideId, leftPartId, rightPartId)
  }

  updatePrompterPart(
    slideId: string,
    partId: string,
    patch: { text?: string; duration?: number; shiftDownstream?: boolean },
  ): {
    slideId: string
    partId: string
    oldText: string
    oldDuration: number
    oldStartTime: number
    oldEndTime: number
    oldStatus?: string
    shiftedParts: { id: string; oldStartTime: number; oldEndTime: number }[]
    shiftedClips: { id: string; oldTimelineStart: number }[]
  } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const index = slide.prompter.parts.findIndex((part) => part.id === partId)
    if (index === -1) throw new Error(`PrompterPart not found: ${partId}`)
    const part = slide.prompter.parts[index]
    const oldText = part.text
    const oldDuration = part.duration
    const oldStartTime = part.startTime
    const oldEndTime = part.endTime
    const oldStatus = part.status
    const shiftedParts: { id: string; oldStartTime: number; oldEndTime: number }[] = []
    const shiftedClips: { id: string; oldTimelineStart: number }[] = []
    let textTriggeredReflow = false
    if (patch.text !== undefined && patch.text !== part.text) {
      const settings = this.#projects.current?.settings ?? {}
      const secondsPerCharacter = getPrompterSecondsPerCharacter(settings)
      const hasAudio = hasPrompterPartAudio(part as import('./prompter').PrompterPart)
      if (hasAudio) {
        part.text = patch.text
        part.status = 'stale'
        // duration frozen, gap-free already holds
      } else {
        const newDuration = estimatePrompterDuration(patch.text, secondsPerCharacter)
        if (newDuration !== part.duration) {
          const delta = newDuration - part.duration
          // Capture downstream parts/clips before mutation for undo and to shift clips after reflow
          for (let i = index + 1; i < slide.prompter.parts.length; i++) {
            const downstream = slide.prompter.parts[i]
            shiftedParts.push({
              id: downstream.id,
              oldStartTime: downstream.startTime,
              oldEndTime: downstream.endTime,
            })
          }
          for (const clip of slide.audio.clips) {
            if (clip.timelineStart > oldEndTime - 1e-6) {
              shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
            }
          }
          part.text = patch.text
          part.duration = newDuration
          part.endTime = part.startTime + newDuration
          part.status = undefined
          // Gap-free invariant via reflowPrompter as one Transaction (Spec 7)
          if (slide.prompter) reflowPrompter(slide.prompter)
          // Shift downstream clips by same delta to stay gap-free (no silent hole)
          for (const sc of shiftedClips) {
            const clip = slide.audio.clips.find((c) => c.id === sc.id)
            if (clip) clip.timelineStart = sc.oldTimelineStart + delta
          }
          textTriggeredReflow = true
        } else {
          part.text = patch.text
          part.status = undefined
        }
      }
    }
    if (patch.duration !== undefined && patch.duration !== part.duration) {
      const delta = patch.duration - part.duration
      // Capture downstream if not already captured by text reflow
      const needsCapture = shiftedParts.length === 0 && shiftedClips.length === 0
      if (needsCapture && patch.shiftDownstream) {
        for (let i = index + 1; i < slide.prompter.parts.length; i++) {
          const downstream = slide.prompter.parts[i]
          shiftedParts.push({
            id: downstream.id,
            oldStartTime: downstream.startTime,
            oldEndTime: downstream.endTime,
          })
        }
        for (const clip of slide.audio.clips) {
          if (clip.timelineStart > oldEndTime - 1e-6) {
            shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
          }
        }
      }
      part.duration = patch.duration
      part.endTime = part.startTime + part.duration
      if (patch.shiftDownstream) {
        if (textTriggeredReflow) {
          // Text already reflowed and shifted clips by its delta; now add duration delta on top
          for (let i = index + 1; i < slide.prompter.parts.length; i++) {
            const downstream = slide.prompter.parts[i]
            downstream.startTime += delta
            downstream.endTime += delta
          }
          for (const sc of shiftedClips) {
            const clip = slide.audio.clips.find((c) => c.id === sc.id)
            if (clip) clip.timelineStart += delta
          }
        } else {
          for (let i = index + 1; i < slide.prompter.parts.length; i++) {
            const downstream = slide.prompter.parts[i]
            downstream.startTime += delta
            downstream.endTime += delta
          }
          for (const sc of shiftedClips) {
            const clip = slide.audio.clips.find((c) => c.id === sc.id)
            if (clip) clip.timelineStart = sc.oldTimelineStart + delta
          }
        }
      } else {
        // Free placement: do not reflow gap-free — keep downstream where it is, gap may change
      }
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return {
      slideId,
      partId,
      oldText,
      oldDuration,
      oldStartTime,
      oldEndTime,
      oldStatus,
      shiftedParts,
      shiftedClips,
    }
  }

  deletePrompterPart(
    slideId: string,
    partId: string,
  ): {
    deletedPart: import('./prompter').PrompterPart
    deletedIndex: number
    deletedClips: readonly { clip: import('./audioClip').AudioClip; index: number }[]
    shiftedParts: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
    shiftedClips: readonly { id: string; oldTimelineStart: number }[]
  } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const index = slide.prompter.parts.findIndex((part) => part.id === partId)
    if (index === -1) throw new Error(`PrompterPart not found: ${partId}`)
    const part = slide.prompter.parts[index]
    const deletedPart: import('./prompter').PrompterPart = JSON.parse(JSON.stringify(part))
    const deletedIndex = index
    const deletedEnd = part.endTime
    const deletedDuration = part.duration
    // Collect clip IDs to delete: primary clip + segment clips
    const clipIdsToDelete = new Set<string>()
    if (part.audioClipId) clipIdsToDelete.add(part.audioClipId)
    if (part.segments) {
      for (const seg of part.segments) clipIdsToDelete.add(seg.audioClipId)
    }
    // Capture downstream parts before mutation for undo and gap-free tracking
    const shiftedParts: { id: string; oldStartTime: number; oldEndTime: number }[] = []
    for (let i = index + 1; i < slide.prompter.parts.length; i++) {
      const p = slide.prompter.parts[i]
      shiftedParts.push({ id: p.id, oldStartTime: p.startTime, oldEndTime: p.endTime })
    }
    // Capture downstream clips before mutation (excluding those to be deleted)
    const shiftedClips: { id: string; oldTimelineStart: number }[] = []
    for (const clip of slide.audio.clips) {
      if (clipIdsToDelete.has(clip.id)) continue
      if (clip.timelineStart > deletedEnd - 1e-6) {
        shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
      }
    }
    // Delete linked clips (asset preserved)
    const deletedClips: { clip: import('./audioClip').AudioClip; index: number }[] = []
    for (const cid of clipIdsToDelete) {
      const cIdx = slide.audio.clips.findIndex((c) => c.id === cid)
      if (cIdx !== -1) {
        const [removed] = slide.audio.clips.splice(cIdx, 1)
        deletedClips.push({ clip: removed, index: cIdx })
      }
    }
    // Delete part — preserve gaps (shift downstream, not gap-free reflow) so user-placed gaps aren't collapsed
    slide.prompter.parts.splice(index, 1)
    for (const sp of shiftedParts) {
      const p = slide.prompter.parts.find((x) => x.id === sp.id)
      if (p) {
        p.startTime = sp.oldStartTime - deletedDuration
        p.endTime = sp.oldEndTime - deletedDuration
      }
    }
    // Shift downstream clips left by deleted duration to stay with their parts / preserve gaps
    for (const sc of shiftedClips) {
      const clip = slide.audio.clips.find((c) => c.id === sc.id)
      if (clip) clip.timelineStart = sc.oldTimelineStart - deletedDuration
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    if (deletedClips.length > 0) {
      this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    }
    return { deletedPart, deletedIndex, deletedClips, shiftedParts, shiftedClips }
  }

  setPrompterPartAudio(
    slideId: string,
    partId: string,
    audioClipId: string | null,
    audioAssetId: string | null,
  ): { oldAudioClipId?: string; oldAudioAssetId?: string; oldStatus?: string } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const part = slide.prompter.parts.find((p) => p.id === partId)
    if (!part) throw new Error(`PrompterPart not found: ${partId}`)
    const oldAudioClipId = part.audioClipId
    const oldAudioAssetId = part.audioAssetId
    const oldStatus = part.status
    if (audioClipId === null) {
      delete (part as { audioClipId?: string }).audioClipId
    } else {
      part.audioClipId = audioClipId
    }
    if (audioAssetId === null) {
      delete (part as { audioAssetId?: string }).audioAssetId
    } else {
      part.audioAssetId = audioAssetId
    }
    if (audioClipId !== null) {
      delete (part as { status?: string }).status
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return { oldAudioClipId, oldAudioAssetId, oldStatus }
  }

  movePrompterPart(
    slideId: string,
    partId: string,
    newIndex: number,
  ): { oldIndex: number; shiftedClips: readonly { id: string; oldTimelineStart: number }[] } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const parts = slide.prompter.parts
    const oldIndex = parts.findIndex((p) => p.id === partId)
    if (oldIndex === -1) throw new Error(`PrompterPart not found: ${partId}`)
    if (newIndex < 0 || newIndex >= parts.length)
      throw new Error(`newIndex out of bounds: ${newIndex}`)
    if (oldIndex === newIndex) return { oldIndex, shiftedClips: [] }
    // Capture old clip positions for linked clips (including segments) before reorder
    const shiftedClips: { id: string; oldTimelineStart: number }[] = []
    const linkedClipIds = new Set<string>()
    for (const part of parts) {
      if (part.audioClipId) linkedClipIds.add(part.audioClipId)
      if (part.segments) for (const seg of part.segments) linkedClipIds.add(seg.audioClipId)
    }
    for (const clip of slide.audio.clips) {
      if (linkedClipIds.has(clip.id)) {
        shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
      }
    }
    const [moved] = parts.splice(oldIndex, 1)
    parts.splice(newIndex, 0, moved)
    reflowPrompter(slide.prompter)
    // Move linked clips atomically with their parts (gap-free reflow)
    for (const part of slide.prompter.parts) {
      if (part.audioClipId) {
        const clip = slide.audio.clips.find((c) => c.id === part.audioClipId)
        if (clip) clip.timelineStart = part.startTime
      }
      if (part.segments) {
        for (const seg of part.segments) {
          const clip = slide.audio.clips.find((c) => c.id === seg.audioClipId)
          if (clip) clip.timelineStart = part.startTime
        }
      }
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    if (shiftedClips.length > 0) {
      this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    }
    return { oldIndex, shiftedClips }
  }

  movePrompterPartToTime(
    slideId: string,
    partId: string,
    newStartTime: number,
  ): {
    oldStartTime: number
    oldEndTime: number
    shiftedClips: readonly { id: string; oldTimelineStart: number }[]
  } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const part = slide.prompter.parts.find((p) => p.id === partId)
    if (!part) throw new Error(`PrompterPart not found: ${partId}`)
    if (typeof newStartTime !== 'number' || !Number.isFinite(newStartTime) || newStartTime < 0) {
      throw new Error('newStartTime must be a non-negative finite number')
    }
    const oldStartTime = part.startTime
    const oldEndTime = part.endTime
    // Capture only the dragged part's linked clips (including segments) — free placement allows gaps, so only this part's clips move
    const draggedClipIds = new Set<string>()
    if (part.audioClipId) draggedClipIds.add(part.audioClipId)
    if (part.segments) for (const seg of part.segments) draggedClipIds.add(seg.audioClipId)
    const shiftedClips: { id: string; oldTimelineStart: number }[] = []
    for (const clip of slide.audio.clips) {
      if (draggedClipIds.has(clip.id))
        shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
    }
    part.startTime = newStartTime
    part.endTime = newStartTime + part.duration
    // Keep array sorted by startTime so order == time order — gaps allowed (no reflow) to let user drag where they want
    slide.prompter.parts.sort((a, b) => a.startTime - b.startTime)
    // Move only dragged part's clips with it (atomically)
    for (const cid of draggedClipIds) {
      const clip = slide.audio.clips.find((c) => c.id === cid)
      if (clip) clip.timelineStart = part.startTime
    }
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    if (shiftedClips.length > 0) {
      this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    }
    return { oldStartTime, oldEndTime, shiftedClips }
  }

  createAudioClip(
    slideId: string,
    input: {
      id?: string
      assetId: string
      trackId: AudioTrackId
      timelineStart: number
      sourceStart?: number
      sourceEnd: number
      volume?: number
      muted?: boolean
      fadeIn?: number
      fadeOut?: number
      playbackRate?: number
      pitchSemitones?: number
      noiseReduction?: number
    },
  ): AudioClip {
    const slide = this.getSlide(slideId)
    const clip = createAudioClip(input)
    slide.audio.clips.push(clip)
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return clip
  }

  deleteAudioClip(slideId: string, clipId: string): AudioClip {
    const slide = this.getSlide(slideId)
    const index = slide.audio.clips.findIndex((clip) => clip.id === clipId)
    if (index === -1) throw new Error(`AudioClip not found: ${clipId}`)
    const [removed] = slide.audio.clips.splice(index, 1)
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return removed
  }

  moveAudioClip(
    slideId: string,
    clipId: string,
    patch: { timelineStart: number; trackId?: AudioTrackId },
  ): { oldTimelineStart: number; oldTrackId: AudioTrackId } {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (
      typeof patch.timelineStart !== 'number' ||
      !Number.isFinite(patch.timelineStart) ||
      patch.timelineStart < 0
    ) {
      throw new Error('AudioClip timelineStart must be a non-negative finite number')
    }
    if (patch.trackId !== undefined && !isAudioTrackId(patch.trackId)) {
      throw new Error('AudioClip trackId must be one of voice, sfx, music')
    }
    const oldTimelineStart = clip.timelineStart
    const oldTrackId = clip.trackId
    clip.timelineStart = patch.timelineStart
    if (patch.trackId !== undefined) clip.trackId = patch.trackId
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return { oldTimelineStart, oldTrackId }
  }

  trimAudioClip(
    slideId: string,
    clipId: string,
    patch: { sourceStart?: number; sourceEnd?: number },
  ): { oldSourceStart: number; oldSourceEnd: number } {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    const newStart = patch.sourceStart ?? clip.sourceStart
    const newEnd = patch.sourceEnd ?? clip.sourceEnd
    if (typeof newStart !== 'number' || !Number.isFinite(newStart) || newStart < 0) {
      throw new Error('AudioClip sourceStart must be a non-negative finite number')
    }
    if (typeof newEnd !== 'number' || !Number.isFinite(newEnd) || newEnd <= 0) {
      throw new Error('AudioClip sourceEnd must be a positive finite number')
    }
    if (newEnd <= newStart) throw new Error('AudioClip sourceEnd must be greater than sourceStart')
    const oldSourceStart = clip.sourceStart
    const oldSourceEnd = clip.sourceEnd
    clip.sourceStart = newStart
    clip.sourceEnd = newEnd
    // clamp fades to new source duration
    const sourceDuration = newEnd - newStart
    if (clip.fadeIn !== undefined) {
      const clamped = clampAudioFade(clip.fadeIn, sourceDuration)
      if (clamped !== undefined) clip.fadeIn = clamped
    }
    if (clip.fadeOut !== undefined) {
      const clamped = clampAudioFade(clip.fadeOut, sourceDuration)
      if (clamped !== undefined) clip.fadeOut = clamped
    }
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return { oldSourceStart, oldSourceEnd }
  }

  splitAudioClip(
    slideId: string,
    clipId: string,
    atTime: number,
  ): { newClipId: string; originalSourceEnd: number } {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (typeof atTime !== 'number' || !Number.isFinite(atTime))
      throw new Error('Split time must be a finite number')
    const playbackDuration = getAudioClipPlaybackDuration(clip)
    const start = clip.timelineStart
    const end = start + playbackDuration
    if (atTime <= start || atTime >= end) throw new Error('Split time must be inside the clip')
    const offsetPlayback = atTime - start
    const sourceOffset = offsetPlayback * (clip.playbackRate || 1)
    const sourceSplit = clip.sourceStart + sourceOffset
    const originalSourceEnd = clip.sourceEnd
    // first clip: truncate end
    clip.sourceEnd = sourceSplit
    // clamp fades for first
    const firstDuration = sourceSplit - clip.sourceStart
    if (clip.fadeIn !== undefined)
      clip.fadeIn = clampAudioFade(clip.fadeIn, firstDuration) ?? clip.fadeIn
    if (clip.fadeOut !== undefined)
      clip.fadeOut = clampAudioFade(clip.fadeOut, firstDuration) ?? clip.fadeOut
    // second clip
    const secondClip: AudioClip = {
      id: newAudioClipId(),
      assetId: clip.assetId,
      trackId: clip.trackId,
      timelineStart: atTime,
      sourceStart: sourceSplit,
      sourceEnd: originalSourceEnd,
      volume: clip.volume,
      muted: clip.muted,
      playbackRate: clip.playbackRate,
      pitchSemitones: clip.pitchSemitones,
      noiseReduction: clip.noiseReduction,
      ...(clip.fadeIn !== undefined
        ? { fadeIn: clampAudioFade(clip.fadeIn, originalSourceEnd - sourceSplit) }
        : {}),
      ...(clip.fadeOut !== undefined
        ? { fadeOut: clampAudioFade(clip.fadeOut, originalSourceEnd - sourceSplit) }
        : {}),
    }
    // Ensure second fades not exceed its source duration
    const secondDuration = originalSourceEnd - sourceSplit
    if (secondClip.fadeIn !== undefined)
      secondClip.fadeIn = clampAudioFade(secondClip.fadeIn, secondDuration) ?? secondClip.fadeIn
    if (secondClip.fadeOut !== undefined)
      secondClip.fadeOut = clampAudioFade(secondClip.fadeOut, secondDuration) ?? secondClip.fadeOut
    slide.audio.clips.push(secondClip)
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return { newClipId: secondClip.id, originalSourceEnd }
  }

  duplicateAudioClip(slideId: string, clipId: string): AudioClip {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    const dup: AudioClip = {
      id: newAudioClipId(),
      assetId: clip.assetId,
      trackId: clip.trackId,
      timelineStart: clip.timelineStart + 0.5,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      volume: clip.volume,
      muted: clip.muted,
      playbackRate: clip.playbackRate,
      pitchSemitones: clip.pitchSemitones,
      noiseReduction: clip.noiseReduction,
      ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
      ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
    }
    slide.audio.clips.push(dup)
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return dup
  }

  setAudioClipVolume(slideId: string, clipId: string, volume: number): number {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new Error('AudioClip volume must be between 0 and 1')
    }
    const old = clip.volume
    clip.volume = volume
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return old
  }

  setAudioClipMuted(slideId: string, clipId: string, muted: boolean): boolean {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (typeof muted !== 'boolean') throw new Error('AudioClip muted must be a boolean')
    const old = clip.muted
    clip.muted = muted
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return old
  }

  setAudioClipPlaybackRate(slideId: string, clipId: string, rate: number): number {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('AudioClip playbackRate must be a positive finite number')
    }
    const old = clip.playbackRate
    clip.playbackRate = rate
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return old
  }

  setAudioClipPitchSemitones(slideId: string, clipId: string, pitch: number): number {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch < -12 || pitch > 12) {
      throw new Error('AudioClip pitchSemitones must be between -12 and 12')
    }
    const old = clip.pitchSemitones
    clip.pitchSemitones = pitch
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return old
  }

  setAudioClipNoiseReduction(slideId: string, clipId: string, value: number): number {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('AudioClip noiseReduction must be between 0 and 1')
    }
    const old = clip.noiseReduction
    clip.noiseReduction = value
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return old
  }

  setAudioClipEffects(
    slideId: string,
    clipId: string,
    patch: { playbackRate?: number; pitchSemitones?: number; noiseReduction?: number },
  ): { oldPlaybackRate: number; oldPitchSemitones: number; oldNoiseReduction: number } {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    const oldPlaybackRate = clip.playbackRate
    const oldPitchSemitones = clip.pitchSemitones
    const oldNoiseReduction = clip.noiseReduction
    if (patch.playbackRate !== undefined) {
      if (
        typeof patch.playbackRate !== 'number' ||
        !Number.isFinite(patch.playbackRate) ||
        patch.playbackRate <= 0
      ) {
        throw new Error('AudioClip playbackRate must be a positive finite number')
      }
      clip.playbackRate = patch.playbackRate
    }
    if (patch.pitchSemitones !== undefined) {
      if (
        typeof patch.pitchSemitones !== 'number' ||
        !Number.isFinite(patch.pitchSemitones) ||
        patch.pitchSemitones < -12 ||
        patch.pitchSemitones > 12
      ) {
        throw new Error('AudioClip pitchSemitones must be between -12 and 12')
      }
      clip.pitchSemitones = patch.pitchSemitones
    }
    if (patch.noiseReduction !== undefined) {
      if (
        typeof patch.noiseReduction !== 'number' ||
        !Number.isFinite(patch.noiseReduction) ||
        patch.noiseReduction < 0 ||
        patch.noiseReduction > 1
      ) {
        throw new Error('AudioClip noiseReduction must be between 0 and 1')
      }
      clip.noiseReduction = patch.noiseReduction
    }
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return { oldPlaybackRate, oldPitchSemitones, oldNoiseReduction }
  }

  setAudioClipFade(
    slideId: string,
    clipId: string,
    patch: { fadeIn?: number; fadeOut?: number },
  ): { oldFadeIn?: number; oldFadeOut?: number } {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    const sourceDuration = getAudioClipSourceDuration(clip)
    const oldFadeIn = clip.fadeIn
    const oldFadeOut = clip.fadeOut
    if (patch.fadeIn !== undefined) {
      if (typeof patch.fadeIn !== 'number' || !Number.isFinite(patch.fadeIn) || patch.fadeIn < 0) {
        throw new Error('AudioClip fadeIn must be a non-negative finite number')
      }
      const clamped = clampAudioFade(patch.fadeIn, sourceDuration)!
      clip.fadeIn = clamped
    }
    if (patch.fadeOut !== undefined) {
      if (
        typeof patch.fadeOut !== 'number' ||
        !Number.isFinite(patch.fadeOut) ||
        patch.fadeOut < 0
      ) {
        throw new Error('AudioClip fadeOut must be a non-negative finite number')
      }
      const clamped = clampAudioFade(patch.fadeOut, sourceDuration)!
      clip.fadeOut = clamped
    }
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return { oldFadeIn, oldFadeOut }
  }

  clearAudioClipFade(
    slideId: string,
    clipId: string,
    which: 'fadeIn' | 'fadeOut',
  ): number | undefined {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    const old = which === 'fadeIn' ? clip.fadeIn : clip.fadeOut
    if (which === 'fadeIn') delete (clip as { fadeIn?: number }).fadeIn
    else delete (clip as { fadeOut?: number }).fadeOut
    this.#bus.emit({ type: 'AudioChanged', slideId } as unknown as import('./events').EngineEvent)
    return old
  }

  // --- Audio sync seam (Spec 15.06) — pure, testable without real AudioContext ---

  getActivePrompterPartId(slideId: string, time: number): string | null {
    const slide = this.getSlide(slideId)
    const parts = slide.prompter?.parts ?? []
    return getActivePrompterPartIdSync(parts, time)
  }

  getAudibleClipsAtTime(
    slideId: string,
    audioTime: number,
    lookahead: number = AUDIO_LOOKAHEAD_SECONDS,
  ): AudioClip[] {
    const slide = this.getSlide(slideId)
    return getAudibleClipsSync(slide.audio.clips, slide.duration, audioTime, lookahead)
  }

  getClippedPlaybackDurationForClip(slideId: string, clipId: string): number {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    return getClippedPlaybackDurationSync(clip, slide.duration)
  }

  getClippedEndForClip(slideId: string, clipId: string): number {
    const slide = this.getSlide(slideId)
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error(`AudioClip not found: ${clipId}`)
    return getClippedEndSync(clip, slide.duration)
  }

  // --- Export Mix seam (Spec 15.11) — deterministic job descriptors, no live FFmpeg ---

  getExportFrameCount(duration: number, fps: number): number {
    return getExportFrameCountCore(duration, fps)
  }

  getExportFrameTimestamps(duration: number, fps: number): number[] {
    return getExportFrameTimestampsCore(duration, fps)
  }

  getRubberbandTempoForPlaybackRate(playbackRate: number): number {
    return getRubberbandTempoForPlaybackRateCore(playbackRate)
  }

  getDerivedAssetCacheKey(assetId: string, playbackRate: number): string {
    return getDerivedAssetCacheKeyCore(assetId, playbackRate)
  }

  buildPerSlideExportDescriptor(
    slideId: string,
    settings: ExportSettings,
  ): ExportPerSlideDescriptor {
    const slide = this.getSlide(slideId)
    return buildPerSlideExportDescriptorCore(slide, settings)
  }

  buildExportJobDescriptor(settings: ExportSettings): ExportJobDescriptor {
    const project = this.project
    if (!project) throw new Error('No project exists in memory')
    return buildExportJobDescriptorCore(project, settings)
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

  hasDataLabelTrack(nodeId: string, label: string): boolean {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.hasDataLabelTrack(label) ?? false
  }

  getDataLabelKeyframes(nodeId: string, label: string): readonly Keyframe[] {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.dataLabelKeyframes(label) ?? []
  }

  getCircleKeyframes(
    nodeId: string,
    property: import('./animationProperties').CircleAnimationProperty,
  ): readonly Keyframe[] {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.circleKeyframes(property) ?? []
  }

  hasCircleTrack(
    nodeId: string,
    property: import('./animationProperties').CircleAnimationProperty,
  ): boolean {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.hasCircleTrack(property) ?? false
  }

  getTableKeyframes(
    nodeId: string,
    property: import('./animationProperties').TableAnimationProperty,
  ): readonly Keyframe[] {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.tableKeyframes(property) ?? []
  }

  hasTableTrack(
    nodeId: string,
    property: import('./animationProperties').TableAnimationProperty,
  ): boolean {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.hasTableTrack(property) ?? false
  }

  getVisibleKeyframes(nodeId: string): readonly Keyframe[] {
    return this.#animations.getVisibleKeyframes(nodeId)
  }

  hasVisibleTrack(nodeId: string): boolean {
    return this.#animations.hasVisibleTrack(nodeId)
  }

  evaluateVisible(nodeId: string, time: number): boolean {
    return this.#evaluator.evaluateVisible(nodeId, time)
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
      (label) => this.hasDataLabelTrack(nodeId, label),
      (property) => this.hasCircleTrack(nodeId, property),
      (property) => this.hasTableTrack(nodeId, property),
    )
  }

  /** Resolve a target's track, rejecting unknown nodes, properties, and parameters. */
  resolveAnimationTarget(target: KeyframeTarget): KeyframeTrackRef {
    return this.#animations.resolveTarget(target)
  }

  getKeyframesOf(target: KeyframeTarget): readonly Keyframe[] {
    const nodeTarget = requireNodeTarget(target)
    const resolved = this.resolveAnimationTarget(target)
    const slide = this.getSlideOfNode(nodeTarget.nodeId)
    const animation = slide.animation.node(nodeTarget.nodeId)
    if (!animation) {
      return []
    }
    if (resolved.kind === 'property') {
      return animation.keyframes(resolved.property)
    }
    if (resolved.kind === 'visible') {
      return animation.visibleKeyframes()
    }
    if (resolved.kind === 'morph') {
      return animation.morphKeyframes()
    }
    if (resolved.kind === 'dataLabel') {
      return animation.dataLabelKeyframes(resolved.label)
    }
    if (resolved.kind === 'circle') {
      return animation.circleKeyframes(resolved.property)
    }
    if (resolved.kind === 'table') {
      return animation.tableKeyframes(resolved.property)
    }
    return animation.materialKeyframes(resolved.parameter)
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

  evaluateDataLabels(nodeId: string, time: number): Map<string, number> {
    return this.#evaluator.evaluateDataLabels(nodeId, time)
  }

  evaluateCircle(
    nodeId: string,
    time: number,
  ): import('./animationEvaluator').EvaluatedCircleState | null {
    return this.#evaluator.evaluateCircle(nodeId, time)
  }

  evaluateTable(
    nodeId: string,
    time: number,
  ): import('./animationEvaluator').EvaluatedTableState | null {
    return this.#evaluator.evaluateTable(nodeId, time)
  }

  evaluateMeshDeformation(
    nodeId: string,
    _time: number,
    boneWorldTransforms: ReadonlyMap<string, WorldTransform>,
    meshWorldTransform?: WorldTransform,
  ): DeformedMeshResult | null {
    const node = this.getNode(nodeId)
    if (node.components.mesh) {
      const mesh = node.components.mesh.mesh
      const shapes = node.components.mesh.shapes
      // New per-keyframe morph: evaluate morphed rest vertices via cross-blend (includes clip layering)
      try {
        const morphed = this.#evaluator.evaluateMorphVertices(nodeId, _time, mesh.vertices, shapes)
        if (morphed && morphed !== mesh.vertices) {
          const morphedMesh = { ...mesh, vertices: morphed as import('./mesh').MeshVertex[] }
          return evaluateMeshDeformation(morphedMesh, boneWorldTransforms, meshWorldTransform)
        }
      } catch {
        // fallback to base
      }
      // Legacy fallback: try old binding+coefficient path for old files that haven't migrated vertex blend yet
      let morphBinding: MorphBinding | null = null
      try {
        morphBinding = this.getMorphBinding(nodeId)
      } catch {
        morphBinding = null
      }
      let coefficient = 0
      try {
        coefficient = this.evaluateMorph(nodeId, _time)
      } catch {
        coefficient = 0
      }
      if (morphBinding && morphBinding.fromShapeId !== null && morphBinding.toShapeId !== null) {
        return evaluateMorphedMeshDeformation(
          mesh,
          { binding: morphBinding, coefficient },
          shapes,
          boneWorldTransforms,
          meshWorldTransform,
        )
      }
      return evaluateMeshDeformation(mesh, boneWorldTransforms, meshWorldTransform)
    }
    if (node.components.circle) {
      const circle = node.components.circle
      let meshData: import('./mesh').MeshData
      try {
        const state = this.evaluateCircle(nodeId, _time)
        if (state) {
          const evaluatedCircle: import('./circleComponent').CircleComponent = {
            kind: 'circle',
            radius: state.radius,
            startAngle: state.startAngle,
            endAngle: state.endAngle,
            segments: state.segments,
          }
          meshData = generateCircleMeshData(evaluatedCircle)
        } else {
          meshData = generateCircleMeshData(circle)
        }
      } catch {
        meshData = generateCircleMeshData(circle)
      }
      return evaluateMeshDeformation(meshData, boneWorldTransforms, meshWorldTransform)
    }
    return null
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
    // If reparented node is the root of an IK chain, also reparent its handle ghosts with Keep-Word
    // so that the handles follow the new parent (as bones do via hierarchy).
    const chains = this.#ik.getChainsForBone(nodeId).filter((c) => c.boneIds[0] === nodeId)
    for (const chain of chains) {
      for (const ghostId of [chain.ghostNodeId, chain.poleGhostNodeId].filter(
        Boolean,
      ) as string[]) {
        try {
          const ghost = this.getNode(ghostId)
          // Skip if ghost already has desired parent (avoid redundant reparent that would preserve world incorrectly)
          if (ghost.parent?.id === newParentId) continue
          const scene = this.getNodeScene(ghostId)
          const oldWorld = worldTransformOf(scene, ghostId)
          const newParentWorld = worldTransformOf(scene, newParentId)
          this.#nodes.reparent(ghostId, newParentId)
          if (oldWorld && newParentWorld) {
            const adjusted = relativeTransform(oldWorld, newParentWorld)
            if (adjusted) {
              const current = this.getNode(ghostId).transform
              const needsUpdate =
                adjusted.x !== current.x ||
                adjusted.y !== current.y ||
                adjusted.rotation !== current.rotation ||
                adjusted.scaleX !== current.scaleX ||
                adjusted.scaleY !== current.scaleY
              if (needsUpdate) {
                this.setTransform(ghostId, adjusted)
              }
            }
          }
        } catch {
          void 0
        }
      }
    }
  }

  setTransform(nodeId: string, transform: Transform): void {
    this.#nodes.setTransform(nodeId, transform)
  }

  setLocalPivot(nodeId: string, pivot: import('./transform').Pivot): void {
    this.#nodes.setLocalPivot(nodeId, pivot)
  }

  setVisibility(nodeId: string, visible: boolean): void {
    this.#nodes.setVisibility(nodeId, visible)
  }

  renameNode(nodeId: string, name: string): void {
    this.#nodes.renameNode(nodeId, name)
  }

  setSemanticName(nodeId: string, semanticName: string | undefined): void {
    this.#nodes.setSemanticName(nodeId, semanticName)
  }

  setOpacity(nodeId: string, opacity: number): void {
    this.#nodes.setOpacity(nodeId, opacity)
  }

  setShadowEffect(nodeId: string, shadowEffect: ShadowEffect | null): void {
    const node = this.getNode(nodeId)
    const previous = node.shadowEffect ? { ...node.shadowEffect } : null
    const next = shadowEffect ? { ...shadowEffect } : undefined
    if (next) {
      const clamped = clampShadowEffect(next, nodeId)
      ;(node as unknown as { shadowEffect?: ShadowEffect }).shadowEffect = clamped
    } else {
      ;(node as unknown as { shadowEffect?: ShadowEffect }).shadowEffect = undefined
    }
    if (next && !isGroupNode(node)) {
      console.warn(
        `[shadow] SetShadowEffect on non-group node "${nodeId}" — effect stored but will not render until node becomes a group`,
      )
    }
    const changed =
      (previous === null && next !== undefined) ||
      (previous !== null && next === undefined) ||
      (previous !== null && next !== undefined && JSON.stringify(previous) !== JSON.stringify(next))
    if (changed) {
      this.#bus.emit({ type: 'ShadowEffectChanged', nodeId })
    }
  }

  getShadowEffect(nodeId: string): ShadowEffect | undefined {
    const node = this.getNode(nodeId)
    return node.shadowEffect ? { ...node.shadowEffect } : undefined
  }

  evaluateShadow(nodeId: string, _time: number): ShadowEffect | null {
    void _time
    const node = this.getNode(nodeId)
    if (!isGroupNode(node) || !node.shadowEffect) return null
    return { ...node.shadowEffect }
  }

  setShadowParam(
    nodeId: string,
    property: import('./shadowEffect').ShadowProperty,
    value: number | string,
  ): void {
    const node = this.getNode(nodeId)
    if (!node.shadowEffect) {
      throw new Error(`Node "${nodeId}" has no shadowEffect`)
    }
    const nextEffect = { ...node.shadowEffect } as unknown as Record<string, unknown>
    // Apply clamped value already computed by command; but also clamp conservatively here for direct engine usage
    if (property === 'blur') {
      const raw = value as number
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        console.warn(`[shadow] Node "${nodeId}" shadowEffect bad blur ${String(raw)} → 0`)
        nextEffect[property] = 0
      } else {
        nextEffect[property] = Math.max(0, Math.min(32, raw))
      }
    } else if (property === 'opacity') {
      const raw = value as number
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        console.warn(`[shadow] Node "${nodeId}" shadowEffect bad opacity ${String(raw)} → 0.35`)
        nextEffect[property] = 0.35
      } else {
        nextEffect[property] = Math.max(0, Math.min(1, raw))
      }
    } else if (property === 'color') {
      const raw = String(value)
      if (!/^#[0-9a-f]{6}$/i.test(raw)) {
        console.warn(`[shadow] Node "${nodeId}" shadowEffect bad color "${String(raw)}" → #000000`)
        nextEffect[property] = '#000000'
      } else {
        nextEffect[property] = raw.toLowerCase()
      }
    } else if (property === 'scaleX' || property === 'scaleY') {
      const raw = value as number
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new Error(`Shadow ${property} must be a finite number (0 allowed)`)
      }
      nextEffect[property] = raw
      if (raw === 0) {
        console.warn(
          `[shadow] Node "${nodeId}" shadowEffect degenerate scale 0 — renders collapsed`,
        )
      }
    } else {
      const raw = value as number
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new Error(`Shadow ${property} must be a finite number`)
      }
      nextEffect[property] = raw
    }
    const previous = { ...node.shadowEffect } as unknown as Record<string, unknown>
    const clamped = clampShadowEffect(
      nextEffect as unknown as import('./shadowEffect').ShadowEffect,
      nodeId,
    )
    ;(node as unknown as { shadowEffect?: import('./shadowEffect').ShadowEffect }).shadowEffect =
      clamped
    const changed = JSON.stringify(previous) !== JSON.stringify(clamped)
    if (changed) {
      this.#bus.emit({ type: 'ShadowEffectChanged', nodeId })
    }
  }

  setCastShadow(nodeId: string, castShadow: boolean | undefined): void {
    const node = this.getNode(nodeId)
    const previous = node.castShadow
    const hadPrevious = node.castShadow !== undefined
    if (castShadow === undefined) {
      delete (node as unknown as { castShadow?: boolean }).castShadow
    } else {
      ;(node as unknown as { castShadow?: boolean }).castShadow = castShadow
    }
    const changed = previous !== castShadow || hadPrevious !== (castShadow !== undefined)
    if (changed) {
      this.#bus.emit({
        type: 'CastShadowChanged',
        nodeId,
      } as unknown as import('./events').EngineEvent)
    }
  }

  getCastShadow(nodeId: string): boolean {
    const node = this.getNode(nodeId)
    const c = node.components as Record<string, unknown>
    if (c.bone !== undefined || c.ghost !== undefined || c.camera !== undefined) return false
    return node.castShadow ?? true
  }

  setMeshData(nodeId: string, mesh: MeshData): void {
    const node = this.getNode(nodeId)
    const existingShapes = node.components.mesh?.shapes
    const newMeshComp: import('./components').MeshComponent = existingShapes
      ? { kind: 'mesh' as const, mesh, shapes: existingShapes }
      : { kind: 'mesh' as const, mesh }
    const newComponents = { ...node.components, mesh: newMeshComp }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'MeshChanged', nodeId })
  }

  // --- Shape storage (Spec 278) — MeshComponent.shapes inline ---
  getShapes(nodeId: string): readonly Shape[] {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    return node.components.mesh.shapes ?? []
  }

  createShape(nodeId: string, name: string): Shape {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    if (typeof name !== 'string' || name.trim() === '')
      throw new Error('Shape name must be a non-empty string')
    const trimmed = name.trim()
    const existing = node.components.mesh.shapes ?? []
    if (existing.some((s) => s.name === trimmed)) {
      throw new Error(`A shape with name "${trimmed}" already exists on this mesh`)
    }
    const shape = createShape(trimmed, node.components.mesh.mesh.vertices)
    const newShapes = [...existing, shape]
    this.#setShapes(nodeId, newShapes)
    return shape
  }

  duplicateShape(nodeId: string, shapeId: string): Shape {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    const existing = node.components.mesh.shapes ?? []
    const source = existing.find((s) => s.id === shapeId)
    if (!source) throw new Error(`Shape not found: ${shapeId}`)
    const newName = uniqueShapeName(source.name, existing)
    const duplicated = duplicateShapeModel(source, newName)
    const newShapes = [...existing, duplicated]
    this.#setShapes(nodeId, newShapes)
    return duplicated
  }

  renameShape(nodeId: string, shapeId: string, newName: string): void {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    if (typeof newName !== 'string' || newName.trim() === '')
      throw new Error('Shape name must be a non-empty string')
    const trimmed = newName.trim()
    const existing = node.components.mesh.shapes ?? []
    const target = existing.find((s) => s.id === shapeId)
    if (!target) throw new Error(`Shape not found: ${shapeId}`)
    if (existing.some((s) => s.id !== shapeId && s.name === trimmed)) {
      throw new Error(`A shape with name "${trimmed}" already exists on this mesh`)
    }
    const newShapes = existing.map((s) =>
      s.id === shapeId
        ? { ...s, name: trimmed, vertices: s.vertices.map((v) => ({ x: v.x, y: v.y })) }
        : s,
    )
    this.#setShapes(nodeId, newShapes)
  }

  deleteShape(nodeId: string, shapeId: string): Shape {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    const existing = node.components.mesh.shapes ?? []
    const idx = existing.findIndex((s) => s.id === shapeId)
    if (idx === -1) throw new Error(`Shape not found: ${shapeId}`)
    const removed = existing[idx]
    const newShapes = existing.filter((s) => s.id !== shapeId)
    this.#setShapes(nodeId, newShapes)
    return removed as Shape
  }

  #setShapes(nodeId: string, shapes: readonly Shape[]): void {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    const meshComp = node.components.mesh
    const newMeshComp: import('./components').MeshComponent = {
      kind: 'mesh' as const,
      mesh: meshComp.mesh,
      ...(shapes.length > 0
        ? {
            shapes: shapes.map(
              (s) =>
                ({
                  id: s.id,
                  name: s.name,
                  vertices: s.vertices.map((v) => ({ x: v.x, y: v.y })),
                }) as Shape,
            ),
          }
        : {}),
    }
    const newComponents = { ...node.components, mesh: newMeshComp }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'MeshChanged', nodeId })
  }

  /** Public restore for undo handlers — replaces shapes array wholesale */
  restoreShapes(nodeId: string, shapes: readonly Shape[]): void {
    this.#setShapes(nodeId, shapes)
  }

  setShapeVertex(nodeId: string, shapeId: string, vertexIndex: number, x: number, y: number): void {
    const node = this.getNode(nodeId)
    if (!node.components.mesh) throw new Error(`Node "${nodeId}" does not have a mesh component`)
    const existing = node.components.mesh.shapes ?? []
    const idx = existing.findIndex((s) => s.id === shapeId)
    if (idx === -1) throw new Error(`Shape not found: ${shapeId}`)
    const shape = existing[idx]
    if (!shape) throw new Error(`Shape not found: ${shapeId}`)
    if (vertexIndex < 0 || vertexIndex >= shape.vertices.length) {
      throw new Error(`Vertex index ${vertexIndex} is out of bounds`)
    }
    const newVertices = shape.vertices.map((v, i) =>
      i === vertexIndex ? { x, y } : { x: v.x, y: v.y },
    )
    const newShape: Shape = { ...shape, vertices: newVertices }
    const newShapes = existing.map((s, i) => (i === idx ? newShape : s))
    this.#setShapes(nodeId, newShapes)
  }

  // --- Morph binding & coefficient (Spec 281) ---
  getMorphBinding(nodeId: string): MorphBinding | null {
    const slide = this.getSlideOfNode(nodeId)
    return slide.animation.node(nodeId)?.morphBinding ?? null
  }

  setMorphBinding(nodeId: string, binding: MorphBinding | null): MorphBinding | null {
    const slide = this.getSlideOfNode(nodeId)
    const animation = slide.animation.ensure(nodeId)
    const previous = animation.morphBinding
    if (binding === null) {
      animation.setMorphBinding(null)
    } else {
      if (
        binding.fromShapeId !== null &&
        typeof binding.fromShapeId !== 'string' &&
        binding.fromShapeId !== undefined
      ) {
        throw new Error('MorphBinding fromShapeId must be string or null')
      }
      if (
        binding.toShapeId !== null &&
        typeof binding.toShapeId !== 'string' &&
        binding.toShapeId !== undefined
      ) {
        throw new Error('MorphBinding toShapeId must be string or null')
      }
      animation.setMorphBinding({
        fromShapeId: binding.fromShapeId ?? null,
        toShapeId: binding.toShapeId ?? null,
      })
    }
    this.#bus.emit({
      type: 'MorphBindingChanged' as unknown as import('./events').EngineEvent['type'],
      nodeId,
    } as unknown as import('./events').EngineEvent)
    return previous
  }

  getMorphKeyframes(nodeId: string): readonly import('./keyframe').Keyframe[] {
    return this.#animations.getMorphKeyframes(nodeId)
  }

  hasMorphTrack(nodeId: string): boolean {
    return this.#animations.hasMorphTrack(nodeId)
  }

  evaluateMorph(nodeId: string, time: number): number {
    return this.#evaluator.evaluateMorph(nodeId, time)
  }

  evaluateMorphValue(nodeId: string, time: number): import('./shape').MorphKeyframeValue | null {
    return this.#evaluator.evaluateMorphValue(nodeId, time)
  }

  setBoneLength(nodeId: string, length: number): void {
    this.#nodes.setBoneLength(nodeId, length)
  }

  setTableComponent(nodeId: string, table: TableComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, table }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'TableChanged', nodeId })
  }

  setTableRowComponent(nodeId: string, tableRow: TableRowComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, tableRow }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'TableChanged', nodeId })
  }

  setTableCellComponent(nodeId: string, tableCell: TableCellComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, tableCell }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'TableChanged', nodeId })
  }

  setChartComponent(nodeId: string, chart: ChartComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, chart }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'ChartChanged', nodeId })
  }

  setTextComponent(nodeId: string, text: TextComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, text }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({ type: 'TextChanged', nodeId })
  }

  setCircleComponent(nodeId: string, circle: import('./circleComponent').CircleComponent): void {
    const node = this.getNode(nodeId)
    const newComponents = { ...node.components, circle }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).components = Object.freeze(newComponents)
    this.#bus.emit({
      type: 'CircleChanged' as unknown as import('./events').EngineEvent['type'],
      nodeId,
    } as unknown as import('./events').EngineEvent)
    // Reuse TableChanged handler pattern? We'll emit CircleChanged dedicated
    this.#bus.emit({ type: 'MeshChanged', nodeId })
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

  // --- Texture attachment helpers ---
  emitMaterialChanged(nodeId: string): void {
    this.#bus.emit({ type: 'MaterialParameterChanged', nodeId })
    // Also notify mesh/circle changed so renderer reapplies UV transform and texture
    const node = this.getNode(nodeId)
    if (node.components.mesh) {
      this.#bus.emit({ type: 'MeshChanged', nodeId })
    }
    if (node.components.circle) {
      this.#bus.emit({
        type: 'CircleChanged' as unknown as import('./events').EngineEvent['type'],
        nodeId,
      } as unknown as import('./events').EngineEvent)
      this.#bus.emit({ type: 'MeshChanged', nodeId })
    }
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

  deleteEmbeddedAsset(assetId: string): EmbeddedAsset | null {
    const project = this.#projects.current
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const asset =
      this.#embeddedAssets.get(assetId) ??
      project.embeddedAssets.find((a) => a.id === assetId) ??
      null
    this.#embeddedAssets.delete(assetId)
    project.deleteEmbeddedAsset(assetId)
    return asset
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

  restoreClipFromJSON(snapshot: unknown): void {
    const clip = ClipDefinition.fromJSON(snapshot)
    // Replace existing clip with snapshot
    try {
      this.#clips.deleteClip(clip.id)
    } catch {
      void 0
    }
    this.#clips.importClip(clip)
  }

  emitKeyframeAdded(target: import('./keyframeTarget').KeyframeTarget, keyframeId: string): void {
    this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId })
  }

  emitClipChanged(clipId: string): void {
    // Generic clip change; emit ClipCategoryChanged as refresh trigger
    this.#bus.emit({ type: 'ClipCategoryChanged', clipId })
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

  // --- ClipCollection methods ---

  get clipCollections(): readonly ClipCollection[] {
    return this.#clipCollections.collections
  }

  getClipCollection(collectionId: string): ClipCollection {
    return this.#clipCollections.getCollection(collectionId)
  }

  createClipCollection(
    name: string,
    bindings: Record<string, string>,
    sourceNodeId?: string,
  ): ClipCollection {
    // Validate bindings reference existing clips
    for (const clipId of Object.values(bindings)) {
      this.getClip(clipId)
    }
    return this.#clipCollections.createCollection(name, bindings, sourceNodeId)
  }

  deleteClipCollection(collectionId: string): ClipCollection {
    return this.#clipCollections.deleteCollection(collectionId)
  }

  renameClipCollection(collectionId: string, name: string): void {
    this.#clipCollections.renameCollection(collectionId, name)
  }

  setClipCollectionBindings(collectionId: string, bindings: Record<string, string>): void {
    for (const clipId of Object.values(bindings)) {
      this.getClip(clipId)
    }
    this.#clipCollections.setBindings(collectionId, bindings)
  }

  importClipCollection(collection: ClipCollection): void {
    // Validate bindings still reference existing clips (allow missing for self-contained? but warn)
    this.#clipCollections.importCollection(collection)
  }

  restoreClipCollectionFromJSON(snapshot: unknown): void {
    const collection = ClipCollection.fromJSON(snapshot)
    try {
      this.#clipCollections.deleteCollection(collection.id)
    } catch {
      void 0
    }
    this.#clipCollections.importCollection(collection)
  }

  exportClipCollection(parentNodeId: string, name: string): ClipCollection {
    const parent = this.getNode(parentNodeId)
    const missingSemantic: string[] = []
    let hasClip = false
    for (const node of walkPreOrder(parent)) {
      if (node.clipInstances.length > 0) {
        hasClip = true
        const sem = node.semanticName
        if (!sem || sem.trim() === '') {
          missingSemantic.push(node.name)
        }
      }
    }
    if (!hasClip) {
      throw new Error(
        `No clips found in hierarchy rooted at "${parent.name}". Assign a clip to at least one node in the subtree before exporting.`,
      )
    }
    if (missingSemantic.length > 0) {
      throw new Error(
        `Cannot export ClipCollection: ${missingSemantic.length} node(s) with clips have no Semantic Name: ${missingSemantic.join(', ')}. Set Semantic Name in Inspector (e.g. left_hand) before export.`,
      )
    }
    const bindings: Record<string, string> = {}
    for (const node of walkPreOrder(parent)) {
      const sem = node.semanticName
      if (!sem || sem.trim() === '') continue
      if (bindings[sem] !== undefined) continue // already collected, keep first
      if (node.clipInstances.length === 0) continue
      // Take first clipInstance's clipId
      const clipId = node.clipInstances[0]!.clipId
      // Validate clip still exists
      try {
        this.getClip(clipId)
      } catch {
        continue
      }
      bindings[sem] = clipId
    }
    if (Object.keys(bindings).length === 0) {
      throw new Error(
        `No exportable bindings found in hierarchy rooted at "${parent.name}". Ensure nodes have both a Semantic Name and a clip.`,
      )
    }
    return this.createClipCollection(name, bindings, parentNodeId)
  }

  applyClipCollection(
    collectionId: string,
    targetNodeId: string,
  ): { nodeId: string; instanceId: string; clipId: string }[] {
    const collection = this.getClipCollection(collectionId)
    const target = this.getNode(targetNodeId)
    const created: { nodeId: string; instanceId: string; clipId: string }[] = []
    for (const node of walkPreOrder(target)) {
      const sem = node.semanticName
      if (!sem) continue
      const clipId = collection.getBinding(sem)
      if (!clipId) continue
      // Validate clip exists
      this.getClip(clipId)
      const instance = this.assignClipInstance(node.id, clipId, 0, 1, true, {})
      created.push({ nodeId: node.id, instanceId: instance.id, clipId })
    }
    this.#bus.emit({
      type: 'ClipCollectionApplied',
      collectionId,
      targetNodeId,
    } as unknown as import('./events').EngineEvent)
    return created
  }

  removeClipCollectionInstances(
    _targetNodeId: string,
    instanceIds: readonly { nodeId: string; instanceId: string }[],
  ): void {
    for (const { nodeId, instanceId } of instanceIds) {
      try {
        this.removeClipInstance(nodeId, instanceId)
      } catch {
        void 0
      }
    }
  }

  // --- Reusable Object (Spec 267) ---
  exportReusableObject(rootNodeId: string, name: string, description?: string): ReusableObjectJSON {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('Reusable object name must be a non-empty string')
    }
    const root = this.getNode(rootNodeId)
    const project = this.#projects.current
    if (!project) throw new Error('No project exists in memory')
    let slide: Slide | null = null
    for (const candidate of project.slides) {
      for (const node of walkPreOrder(candidate.scene.root)) {
        if (node.id === rootNodeId) {
          slide = candidate
          break
        }
      }
      if (slide) break
    }
    if (!slide) throw new Error(`Node not found in any slide: ${rootNodeId}`)
    if (root === slide.scene.root) throw new Error('The scene root cannot be exported as an object')
    if (root.components.camera) throw new Error('The camera node cannot be exported as an object')

    const ikManager = this.#ik
    const constraintManager = this.#constraints

    const descendants = [...walkPreOrder(root)]
    const nodeIds = new Set<string>(descendants.map((n) => n.id))

    const extraGhostIds = new Set<string>()
    for (const chain of ikManager.getChainsForSlide(slide.id)) {
      const intersects = chain.boneIds.some((bid) => nodeIds.has(bid))
      if (intersects) {
        if (chain.ghostNodeId && !nodeIds.has(chain.ghostNodeId))
          extraGhostIds.add(chain.ghostNodeId)
        if (chain.poleGhostNodeId && !nodeIds.has(chain.poleGhostNodeId))
          extraGhostIds.add(chain.poleGhostNodeId)
      }
    }
    for (const ghostId of extraGhostIds) {
      try {
        const ghostNode = this.getNode(ghostId)
        nodeIds.add(ghostNode.id)
        for (const d of walkPreOrder(ghostNode)) nodeIds.add(d.id)
      } catch {
        void 0
      }
    }

    const orderedNodeIds: string[] = []
    const visited = new Set<string>()
    for (const node of descendants) {
      if (!visited.has(node.id)) {
        visited.add(node.id)
        orderedNodeIds.push(node.id)
      }
    }
    for (const ghostId of extraGhostIds) {
      if (!visited.has(ghostId)) {
        visited.add(ghostId)
        orderedNodeIds.push(ghostId)
        try {
          const ghost = this.getNode(ghostId)
          for (const d of walkPreOrder(ghost)) {
            if (d.id !== ghostId && !visited.has(d.id)) {
              visited.add(d.id)
              orderedNodeIds.push(d.id)
            }
          }
        } catch {
          void 0
        }
      }
    }

    const nodes: import('./json').NodeJSON[] = []
    for (const id of orderedNodeIds) {
      const node = this.getNode(id)
      const json = node.toJSON()
      if (id === rootNodeId) {
        nodes.push({ ...json, parentId: null } as import('./json').NodeJSON)
      } else {
        const parentId = json.parentId
        if (typeof parentId === 'string' && !nodeIds.has(parentId)) {
          nodes.push({ ...json, parentId: rootNodeId } as import('./json').NodeJSON)
        } else {
          nodes.push(json)
        }
      }
    }

    let animation: import('./json').SlideAnimationJSON | undefined
    try {
      const fullAnim = (
        slide.animation as unknown as { toJSON: () => import('./json').SlideAnimationJSON }
      ).toJSON()
      const filtered = fullAnim.nodes.filter((entry) => nodeIds.has(entry.nodeId))
      if (filtered.length > 0) animation = { nodes: filtered }
    } catch {
      animation = undefined
    }

    const referencedAssetIds = new Set<string>()
    const referencedMaterialIds = new Set<string>()
    const referencedShaderIds = new Set<string>()
    const referencedClipIds = new Set<string>()
    const referencedDataSourceIds = new Set<string>()

    for (const id of nodeIds) {
      const node = this.getNode(id)
      const assetInst = node.components.assetInstance
      if (assetInst) referencedAssetIds.add(assetInst.assetDefinitionId)
      const tex = node.material.textureId
      if (typeof tex === 'string' && tex !== '') referencedAssetIds.add(tex)
      referencedMaterialIds.add(node.material.materialDefinitionId)
      for (const inst of node.clipInstances) referencedClipIds.add(inst.clipId)
      const chart = node.components.chart
      if (chart) referencedDataSourceIds.add(chart.dataSourceId)
    }

    for (const matId of referencedMaterialIds) {
      if (matId === DEFAULT_MATERIAL_DEFINITION_ID) continue
      try {
        const matDef = this.getMaterialDefinition(matId)
        const sid = (matDef as unknown as { shaderId?: string | null }).shaderId
        if (typeof sid === 'string' && sid !== '') referencedShaderIds.add(sid)
      } catch {
        const embedded = this.getEmbeddedMaterial(matId)
        if (embedded?.shaderId) referencedShaderIds.add(embedded.shaderId)
      }
    }

    const clips: ClipDefinition[] = []
    for (const clipId of referencedClipIds) {
      try {
        clips.push(this.getClip(clipId))
      } catch {
        void 0
      }
    }

    const clipCollections: ClipCollection[] = []
    for (const col of this.#clipCollections.collections) {
      let include = false
      if (col.sourceNodeId && nodeIds.has(col.sourceNodeId)) include = true
      if (!include) {
        for (const clipId of col.bindings.values()) {
          if (referencedClipIds.has(clipId)) {
            include = true
            break
          }
        }
      }
      if (include) {
        clipCollections.push(col)
        for (const clipId of col.bindings.values()) {
          if (!referencedClipIds.has(clipId)) {
            try {
              clips.push(this.getClip(clipId))
              referencedClipIds.add(clipId)
            } catch {
              void 0
            }
          }
        }
      }
    }

    const dedupedClips = new Map<string, ClipDefinition>()
    for (const clip of clips) if (!dedupedClips.has(clip.id)) dedupedClips.set(clip.id, clip)

    const embeddedAssets: EmbeddedAsset[] = []
    for (const aid of referencedAssetIds) {
      const embedded =
        this.getEmbeddedAsset(aid) ?? project.embeddedAssets.find((a) => a.id === aid)
      if (embedded) embeddedAssets.push(embedded)
    }
    const embeddedMaterials: EmbeddedMaterialDefinition[] = []
    for (const mid of referencedMaterialIds) {
      if (mid === DEFAULT_MATERIAL_DEFINITION_ID) continue
      const embedded =
        this.getEmbeddedMaterial(mid) ?? project.embeddedMaterials.find((m) => m.id === mid)
      if (embedded) embeddedMaterials.push(embedded)
    }
    const embeddedShaders: EmbeddedShaderDefinition[] = []
    for (const sid of referencedShaderIds) {
      const embedded =
        this.getEmbeddedShader(sid) ?? project.embeddedShaders.find((s) => s.id === sid)
      if (embedded) embeddedShaders.push(embedded)
    }
    const embeddedDataSources: EmbeddedDataSourceUnion[] = []
    for (const dsId of referencedDataSourceIds) {
      const ds = project.embeddedDataSources.find((d) => d.id === dsId)
      if (ds) embeddedDataSources.push(ds as EmbeddedDataSourceUnion)
    }

    let library: import('./json').LessonLibraryJSON | undefined
    if (
      embeddedAssets.length > 0 ||
      embeddedMaterials.length > 0 ||
      embeddedShaders.length > 0 ||
      embeddedDataSources.length > 0 ||
      dedupedClips.size > 0 ||
      clipCollections.length > 0
    ) {
      const assetsJson = embeddedAssets.map((a) => ({
        id: a.id,
        name: a.name,
        data: a.data,
        mimeType: a.mimeType,
        ...(a.metadata !== undefined ? { metadata: a.metadata } : {}),
      }))
      const materialsJson = embeddedMaterials.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        tags: [...m.tags],
        created_at: m.createdAt,
        updated_at: m.updatedAt,
        parameters: m.parameters.map((p) => ({ key: p.key, kind: p.kind, default: p.default })),
        ...(m.shaderId !== null ? { shader_id: m.shaderId } : {}),
      }))
      const shadersJson = embeddedShaders.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: [...s.tags],
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        source: s.source,
        default_uniforms: s.defaultUniforms.map((u) => ({ ...u })),
        is_builtin: s.isBuiltin,
      }))
      const dataSourcesJson = embeddedDataSources.map((ds) => {
        if ('nodes' in ds) {
          return {
            id: ds.id,
            name: ds.name,
            flowchart: {
              nodes: ds.nodes.map((n) => ({ id: n.id, label: n.label })),
              edges: ds.edges.map((e) => ({ from: e.from, to: e.to })),
            },
          }
        }
        return {
          id: ds.id,
          name: ds.name,
          data_points: ds.dataPoints.map((p) => ({
            label: p.label,
            value: p.value,
            ...(p.series !== undefined ? { series: p.series } : {}),
            ...(p.tooltip !== undefined ? { tooltip: p.tooltip } : {}),
            ...(p.color !== undefined ? { color: p.color } : {}),
          })),
        }
      })
      library = {
        ...(assetsJson.length > 0 ? { assets: assetsJson } : {}),
        ...(materialsJson.length > 0 ? { materials: materialsJson } : {}),
        ...(shadersJson.length > 0 ? { shaders: shadersJson } : {}),
        ...(dataSourcesJson.length > 0 ? { data_sources: dataSourcesJson } : {}),
        ...(dedupedClips.size > 0
          ? { clips: [...dedupedClips.values()].map((c) => c.toJSON()) }
          : {}),
        ...(clipCollections.length > 0
          ? { clipCollections: clipCollections.map((c) => c.toJSON()) }
          : {}),
      } as import('./json').LessonLibraryJSON
      if (Object.keys(library).length === 0) library = undefined
    }

    let ikChains: import('./json').IKManagerJSON | undefined
    {
      const chains = ikManager
        .getChainsForSlide(slide.id)
        .filter((chain) => chain.boneIds.some((bid) => nodeIds.has(bid)))
      if (chains.length > 0) {
        const slides: Record<string, readonly string[]> = { [slide.id]: chains.map((c) => c.id) }
        ikChains = { slides, chains: chains.map((c) => c.toJSON()) }
      }
    }

    let constraints: import('./json').ConstraintManagerJSON | undefined
    {
      const nodeConstraints: Record<string, readonly import('./json').ConstraintJSON[]> = {}
      let hasAny = false
      for (const nid of nodeIds) {
        const list = constraintManager.getConstraintsForNode(nid)
        if (list.length > 0) {
          nodeConstraints[nid] = list.map((c) => ({
            id: c.id,
            type: c.type,
            priority: c.priority,
            params: constraintParamsToJSON(c),
          }))
          hasAny = true
        }
      }
      if (hasAny)
        constraints = {
          nodeConstraints:
            nodeConstraints as import('./json').ConstraintManagerJSON['nodeConstraints'],
        }
    }

    const result: ReusableObjectJSON = {
      version: REUSABLE_OBJECT_VERSION,
      name: name.trim(),
      ...(description !== undefined && description.trim() !== ''
        ? { description: description.trim() }
        : {}),
      rootId: rootNodeId,
      nodes,
      ...(animation !== undefined ? { animation } : {}),
      ...(library !== undefined ? { library } : {}),
      ...(ikChains !== undefined ? { ikChains } : {}),
      ...(constraints !== undefined ? { constraints } : {}),
    }
    const errors = validateReusableObject(result)
    if (errors.length > 0) throw new Error(errors.join('; '))
    return result
  }

  importReusableObject(
    objectJson: ReusableObjectJSON,
    targetParentId?: string,
  ): {
    nodeIdMap: Map<string, string>
    clipIdMap: Map<string, string>
    collectionIdMap: Map<string, string>
    rootNewId: string
  } {
    const errors = validateReusableObject(objectJson)
    if (errors.length > 0) throw new Error(errors.join('; '))
    const project = this.#projects.current
    if (!project) throw new Error('No project exists in memory')
    const activeSlide = this.getActiveSlide() ?? project.slides[0]
    if (!activeSlide) throw new Error('No active slide')
    const targetParent = targetParentId ? this.getNode(targetParentId) : activeSlide.scene.root
    const targetScene = this.getNodeScene(targetParent.id)
    if (targetScene.id !== activeSlide.scene.id)
      throw new Error('Target parent must belong to the active slide')

    const nodeIdMap = new Map<string, string>()
    const clipIdMap = new Map<string, string>()
    const collectionIdMap = new Map<string, string>()

    const library = objectJson.library

    if (library?.assets) {
      for (const assetJson of library.assets) {
        const asset: EmbeddedAsset = {
          id: assetJson.id,
          name: assetJson.name,
          data: assetJson.data,
          mimeType: assetJson.mimeType,
          ...(assetJson.metadata !== undefined
            ? { metadata: assetJson.metadata as Record<string, unknown> }
            : {}),
        }
        this.embedAsset(asset)
      }
    }
    if (library?.materials) {
      for (const matJson of library.materials) {
        const mat: EmbeddedMaterialDefinition = {
          id: matJson.id,
          name: matJson.name,
          description: matJson.description,
          tags: [...matJson.tags],
          createdAt: matJson.created_at,
          updatedAt: matJson.updated_at,
          parameters: matJson.parameters.map((p) => ({
            key: p.key,
            kind: p.kind,
            default: p.default,
          })),
          shaderId: (matJson.shader_id as string | null | undefined) ?? null,
        }
        this.embedMaterial(mat)
      }
    }
    if (library?.shaders) {
      for (const shaderJson of library.shaders) {
        const shader: EmbeddedShaderDefinition = {
          id: shaderJson.id,
          name: shaderJson.name,
          description: shaderJson.description,
          tags: [...shaderJson.tags],
          createdAt: shaderJson.created_at,
          updatedAt: shaderJson.updated_at,
          source: shaderJson.source,
          defaultUniforms: shaderJson.default_uniforms.map((u) => ({
            ...(u as Record<string, unknown>),
          })),
          isBuiltin: shaderJson.is_builtin,
        }
        this.embedShader(shader)
      }
    }
    if (library?.data_sources) {
      for (const dsJson of library.data_sources) {
        const ds = dsJson as Record<string, unknown>
        const anyRecord = (v: unknown): v is Record<string, unknown> =>
          typeof v === 'object' && v !== null
        if (anyRecord(ds.flowchart)) {
          const flow = ds.flowchart as Record<string, unknown>
          const nodes = (flow.nodes as unknown[]) ?? []
          const edges = (flow.edges as unknown[]) ?? []
          const def = {
            id: ds.id as string,
            name: ds.name as string,
            nodes: nodes
              .filter(
                (n): n is { id: string; label: string } =>
                  anyRecord(n) && typeof n.id === 'string' && typeof n.label === 'string',
              )
              .map((n) => ({ id: n.id, label: n.label })),
            edges: edges
              .filter(
                (e): e is { from: string; to: string } =>
                  anyRecord(e) && typeof e.from === 'string' && typeof e.to === 'string',
              )
              .map((e) => ({ from: e.from, to: e.to })),
          } as EmbeddedDataSourceUnion
          this.embedDataSource(def)
        } else if (Array.isArray(ds.data_points)) {
          const dps = ds.data_points as unknown[]
          const def = {
            id: ds.id as string,
            name: ds.name as string,
            dataPoints: dps
              .filter(
                (
                  p,
                ): p is {
                  label: string
                  value: number
                  series?: string
                  tooltip?: string
                  color?: string
                } => anyRecord(p) && typeof p.label === 'string' && typeof p.value === 'number',
              )
              .map((p) => ({
                label: p.label,
                value: p.value,
                ...(typeof p.series === 'string' ? { series: p.series } : {}),
                ...(typeof p.tooltip === 'string' ? { tooltip: p.tooltip } : {}),
                ...(typeof p.color === 'string' ? { color: p.color } : {}),
              })),
          } as EmbeddedDataSourceUnion
          this.embedDataSource(def)
        }
      }
    }

    const clipsJson = library?.clips ?? []
    for (const clipJson of clipsJson) {
      const oldId = (clipJson as unknown as { id: string }).id
      clipIdMap.set(oldId, newClipId())
    }
    const collectionsJson = library?.clipCollections ?? []
    for (const colJson of collectionsJson) {
      const oldId = (colJson as unknown as { id: string }).id
      collectionIdMap.set(oldId, newClipCollectionId())
    }

    for (const clipJson of clipsJson) {
      const oldId = (clipJson as unknown as { id: string }).id
      const newId = clipIdMap.get(oldId)!
      const newClipJson = {
        ...(clipJson as unknown as Record<string, unknown>),
        id: newId,
      } as unknown
      const clip = ClipDefinition.fromJSON(newClipJson)
      this.#clips.importClip(clip)
    }

    for (const colJson of collectionsJson) {
      const oldId = (colJson as unknown as { id: string }).id
      const newId = collectionIdMap.get(oldId)!
      const bindings = (colJson as unknown as { bindings: Record<string, string> }).bindings ?? {}
      const newBindings: Record<string, string> = {}
      for (const [sem, oldClipId] of Object.entries(bindings))
        newBindings[sem] = clipIdMap.get(oldClipId) ?? oldClipId
      const collection = new ClipCollection(
        newId,
        (colJson as unknown as { name: string }).name,
        newBindings,
        (colJson as unknown as { sourceNodeId?: string }).sourceNodeId,
      )
      this.#clipCollections.importCollection(collection)
    }

    for (const nodeJson of objectJson.nodes) nodeIdMap.set(nodeJson.id, newId('node'))

    // Shape id remapping per Mesh node (ADR 0008): fresh ids per imported Mesh, patch bindings
    const shapeIdMapPerOldNode = new Map<string, Map<string, string>>()
    for (const nodeJson of objectJson.nodes) {
      const comp = (nodeJson as unknown as { components?: Record<string, unknown> }).components
      const meshComp = comp?.mesh as Record<string, unknown> | undefined
      const shapes = meshComp?.shapes as unknown[] | undefined
      if (Array.isArray(shapes) && shapes.length > 0) {
        const m = new Map<string, string>()
        for (const s of shapes) {
          const rec = s as Record<string, unknown>
          const oldId = rec.id as string
          if (typeof oldId === 'string' && oldId !== '') {
            m.set(oldId, newId('shape'))
          }
        }
        if (m.size > 0) shapeIdMapPerOldNode.set(nodeJson.id, m)
      }
    }

    // Fix clipCollection sourceNodeId remapping
    for (const colJson of collectionsJson) {
      const oldId = (colJson as unknown as { id: string }).id
      const newId = collectionIdMap.get(oldId)!
      const collection = this.#clipCollections.getCollection(newId)
      const oldSource = (colJson as unknown as { sourceNodeId?: string }).sourceNodeId
      if (oldSource && nodeIdMap.has(oldSource)) collection.sourceNodeId = nodeIdMap.get(oldSource)
    }

    // Prepare new node JSONs with remapped ids and parents
    const newNodesJson = objectJson.nodes.map((orig) => {
      const newIdVal = nodeIdMap.get(orig.id)!
      let newParentId: string | null
      if (orig.id === objectJson.rootId) newParentId = targetParent.id
      else {
        const origParent = orig.parentId
        if (origParent === null || origParent === undefined) newParentId = targetParent.id
        else newParentId = nodeIdMap.get(origParent) ?? targetParent.id
      }
      const cloned: Record<string, unknown> = {
        ...(orig as unknown as Record<string, unknown>),
        id: newIdVal,
        parentId: newParentId,
      }
      if (Array.isArray(cloned.clipInstances)) {
        cloned.clipInstances = (cloned.clipInstances as unknown[]).map((inst) => {
          if (
            typeof inst !== 'object' ||
            inst === null ||
            typeof (inst as Record<string, unknown>).clipId !== 'string'
          )
            return inst
          const oldClipId = (inst as Record<string, unknown>).clipId as string
          return {
            ...(inst as Record<string, unknown>),
            clipId: clipIdMap.get(oldClipId) ?? oldClipId,
          }
        })
      }
      let components = cloned.components as Record<string, unknown> | undefined
      if (components && typeof components.mesh === 'object' && components.mesh !== null) {
        let meshComp = components.mesh as Record<string, unknown>
        // Remap shape ids to fresh ids per mesh (referential integrity for bindings)
        if (Array.isArray(meshComp.shapes)) {
          const shapeMap = shapeIdMapPerOldNode.get(orig.id)
          if (shapeMap) {
            const newShapes = (meshComp.shapes as unknown[]).map((s) => {
              const rec = s as Record<string, unknown>
              const oldId = rec.id as string
              const newIdVal2 = shapeMap.get(oldId) ?? oldId
              return { ...rec, id: newIdVal2 }
            })
            meshComp = { ...meshComp, shapes: newShapes }
            components = { ...components, mesh: meshComp }
            cloned.components = components
          }
        }
        const mesh = meshComp.mesh as Record<string, unknown> | undefined
        if (mesh && Array.isArray(mesh.boneWeights)) {
          const newWeights = (mesh.boneWeights as unknown[]).map((arr) => {
            if (!Array.isArray(arr)) return arr
            return (arr as unknown[]).map((entry) => {
              if (
                typeof entry !== 'object' ||
                entry === null ||
                typeof (entry as Record<string, unknown>).boneId !== 'string'
              )
                return entry
              const oldBoneId = (entry as Record<string, unknown>).boneId as string
              return {
                ...(entry as Record<string, unknown>),
                boneId: nodeIdMap.get(oldBoneId) ?? oldBoneId,
              }
            })
          })
          const newMesh: Record<string, unknown> = { ...mesh, boneWeights: newWeights }
          if (typeof mesh.bindPose === 'object' && mesh.bindPose !== null) {
            const newBindPose: Record<string, unknown> = {}
            for (const [boneId, transform] of Object.entries(
              mesh.bindPose as Record<string, unknown>,
            )) {
              newBindPose[nodeIdMap.get(boneId) ?? boneId] = transform
            }
            newMesh.bindPose = newBindPose
          }
          const updatedMeshComp = { ...meshComp, mesh: newMesh }
          components = { ...components, mesh: updatedMeshComp }
          cloned.components = components
        } else if (components !== cloned.components) {
          // shapes were remapped but no boneWeights; ensure cloned reflects it
          cloned.components = components
        }
      }
      return cloned as unknown as import('./json').NodeJSON
    })

    // Ensure unique names
    const existingNames = new Set<string>(
      [...walkPreOrder(activeSlide.scene.root)].map((n) => n.name),
    )
    for (const nodeJson of newNodesJson) {
      let nameVal = nodeJson.name as string
      if (existingNames.has(nameVal)) {
        let counter = 1
        let candidate = `${nameVal} ${counter}`
        while (existingNames.has(candidate)) {
          counter += 1
          candidate = `${nameVal} ${counter}`
        }
        ;(nodeJson as unknown as Record<string, unknown>).name = candidate
        nameVal = candidate
      }
      existingNames.add(nameVal)
    }

    // Create nodes in order ensuring parents exist
    for (const nodeJson of newNodesJson) {
      const nid = nodeJson.id
      const parentId = nodeJson.parentId as string
      const components = (nodeJson.components ?? {}) as import('./components').NodeComponents
      const transform = (nodeJson.transform ?? {
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      }) as import('./transform').Transform
      const semanticName = (nodeJson as unknown as { semanticName?: string }).semanticName
      const node = this.createNode(activeSlide.scene.id, parentId, nodeJson.name, {
        id: nid,
        transform,
        components,
        semanticName,
      })
      node.visible = typeof nodeJson.visible === 'boolean' ? nodeJson.visible : true
      node.opacity = typeof nodeJson.opacity === 'number' ? nodeJson.opacity : 1
      const matJson = (nodeJson as unknown as { material?: unknown }).material
      if (matJson !== undefined) {
        try {
          node.material = materialFromJSON(matJson, nid)
        } catch {
          void 0
        }
      }
      // clipInstances: replace with imported instances (already remapped)
      node.clipInstances.length = 0
      if (Array.isArray((nodeJson as unknown as { clipInstances?: unknown }).clipInstances)) {
        for (const ci of (nodeJson as unknown as { clipInstances: readonly unknown[] })
          .clipInstances) {
          try {
            node.clipInstances.push(
              clipInstanceFromJSON(ci as unknown as import('./json').ClipInstanceJSON),
            )
          } catch {
            void 0
          }
        }
      }
      const shadowEffectJson = (nodeJson as unknown as { shadowEffect?: unknown }).shadowEffect
      if (shadowEffectJson !== undefined) {
        try {
          const parsed = shadowEffectFromJSON(shadowEffectJson, nid)
          if (parsed) (node as unknown as { shadowEffect?: ShadowEffect }).shadowEffect = parsed
        } catch {
          void 0
        }
      }
      const castShadowRaw = (nodeJson as unknown as { castShadow?: unknown }).castShadow
      if (typeof castShadowRaw === 'boolean') {
        ;(node as unknown as { castShadow?: boolean }).castShadow = castShadowRaw
      }
      // localPivot already handled via transform
    }

    // Animation: import keyframes for nodes
    if (objectJson.animation) {
      for (const nodeAnimJson of objectJson.animation.nodes) {
        const oldNodeId = nodeAnimJson.nodeId
        const newNodeId = nodeIdMap.get(oldNodeId)
        if (!newNodeId) continue
        const targetAnim = activeSlide.animation.ensure(newNodeId)
        for (const track of nodeAnimJson.tracks) {
          for (const kfJson of track.keyframes) {
            const kf = new KeyframeModel(
              kfJson.id,
              kfJson.time,
              kfJson.value as unknown as import('./keyframe').KeyframeValue,
              (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'linear',
              (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
              (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
            )
            try {
              targetAnim.add(
                track.property as unknown as import('./animationProperties').AnimationProperty,
                kf,
              )
            } catch {
              void 0
            }
          }
        }
        if (nodeAnimJson.materialTracks) {
          for (const track of nodeAnimJson.materialTracks) {
            for (const kfJson of track.keyframes) {
              const kf = new KeyframeModel(
                kfJson.id,
                kfJson.time,
                kfJson.value as unknown as import('./keyframe').KeyframeValue,
                (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'linear',
                (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
                (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? {
                  time: 0,
                  value: 0,
                },
              )
              try {
                targetAnim.addMaterial(track.parameter, kf)
              } catch {
                void 0
              }
            }
          }
        }
        const dataLabelTracks = (
          nodeAnimJson as unknown as {
            dataLabelTracks?: readonly {
              label: string
              keyframes: readonly import('./json').KeyframeJSON[]
            }[]
          }
        ).dataLabelTracks
        if (dataLabelTracks) {
          for (const track of dataLabelTracks) {
            for (const kfJson of track.keyframes) {
              const kf = new KeyframeModel(
                kfJson.id,
                kfJson.time,
                kfJson.value as unknown as import('./keyframe').KeyframeValue,
                (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'linear',
                (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
                (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? {
                  time: 0,
                  value: 0,
                },
              )
              try {
                targetAnim.addDataLabel(track.label, kf)
              } catch {
                void 0
              }
            }
          }
        }
        const circleTracks = (
          nodeAnimJson as unknown as {
            circleTracks?: readonly {
              property: string
              keyframes: readonly import('./json').KeyframeJSON[]
            }[]
          }
        ).circleTracks
        if (circleTracks) {
          for (const track of circleTracks) {
            for (const kfJson of track.keyframes) {
              const kf = new KeyframeModel(
                kfJson.id,
                kfJson.time,
                kfJson.value as unknown as import('./keyframe').KeyframeValue,
                (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'linear',
                (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
                (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? {
                  time: 0,
                  value: 0,
                },
              )
              try {
                targetAnim.addCircle(
                  track.property as unknown as import('./animationProperties').CircleAnimationProperty,
                  kf,
                )
              } catch {
                void 0
              }
            }
          }
        }
        const tableTracks = (
          nodeAnimJson as unknown as {
            tableTracks?: readonly {
              property: string
              keyframes: readonly import('./json').KeyframeJSON[]
            }[]
          }
        ).tableTracks
        if (tableTracks) {
          for (const track of tableTracks) {
            for (const kfJson of track.keyframes) {
              const kf = new KeyframeModel(
                kfJson.id,
                kfJson.time,
                kfJson.value as unknown as import('./keyframe').KeyframeValue,
                (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'linear',
                (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
                (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? {
                  time: 0,
                  value: 0,
                },
              )
              try {
                targetAnim.addTable(
                  track.property as unknown as import('./animationProperties').TableAnimationProperty,
                  kf,
                )
              } catch {
                void 0
              }
            }
          }
        }
        const visibleTrack = (
          nodeAnimJson as unknown as {
            visibleTrack?: { keyframes: readonly import('./json').KeyframeJSON[] }
          }
        ).visibleTrack
        if (visibleTrack) {
          for (const kfJson of visibleTrack.keyframes) {
            const kf = new KeyframeModel(
              kfJson.id,
              kfJson.time,
              kfJson.value as unknown as import('./keyframe').KeyframeValue,
              (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'hold',
              (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
              (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
            )
            try {
              targetAnim.addVisible(kf)
            } catch {
              void 0
            }
          }
        }
        const morphBindingRaw = (
          nodeAnimJson as unknown as {
            morphBinding?: { fromShapeId: string | null; toShapeId: string | null } | null
          }
        ).morphBinding
        // Remap legacy global binding ids if present
        let remappedBinding:
          { fromShapeId: string | null; toShapeId: string | null } | null | undefined = undefined
        if (morphBindingRaw !== undefined) {
          if (morphBindingRaw === null) {
            remappedBinding = null
          } else {
            let from = morphBindingRaw.fromShapeId
            let to = morphBindingRaw.toShapeId
            const shapeMap = shapeIdMapPerOldNode.get(oldNodeId)
            if (shapeMap) {
              if (from !== null && shapeMap.has(from)) from = shapeMap.get(from)!
              if (to !== null && shapeMap.has(to)) to = shapeMap.get(to)!
            }
            remappedBinding = { fromShapeId: from, toShapeId: to }
          }
        }
        const morphTrack = (
          nodeAnimJson as unknown as {
            morphTrack?: { keyframes: readonly import('./json').KeyframeJSON[] }
          }
        ).morphTrack
        if (morphTrack) {
          for (const kfJson of morphTrack.keyframes) {
            let val = kfJson.value as unknown
            // Migrate legacy scalar or id-based morph values with remapping
            if (typeof val === 'number') {
              const from = remappedBinding ? remappedBinding.fromShapeId : null
              const to = remappedBinding ? remappedBinding.toShapeId : null
              val = { fromShapeId: from, toShapeId: to, coefficient: val }
            } else if (typeof val === 'object' && val !== null) {
              const rec = val as Record<string, unknown>
              if ('fromShapeId' in rec || 'toShapeId' in rec) {
                const shapeMap = shapeIdMapPerOldNode.get(oldNodeId)
                let from = rec.fromShapeId as string | null
                let to = rec.toShapeId as string | null
                if (shapeMap) {
                  if (from !== null && shapeMap.has(from)) from = shapeMap.get(from)!
                  if (to !== null && shapeMap.has(to)) to = shapeMap.get(to)!
                }
                val = { fromShapeId: from, toShapeId: to, coefficient: rec.coefficient as number }
              }
            }
            const kf = new KeyframeModel(
              kfJson.id,
              kfJson.time,
              val as unknown as import('./keyframe').KeyframeValue,
              (kfJson.interpolation as import('./keyframe').InterpolationType) ?? 'linear',
              (kfJson.tangentIn as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
              (kfJson.tangentOut as import('./keyframe').KeyframeTangent) ?? { time: 0, value: 0 },
            )
            try {
              targetAnim.addMorph(kf)
            } catch {
              void 0
            }
          }
        }
        if (remappedBinding !== undefined) {
          if (remappedBinding === null) {
            try {
              targetAnim.setMorphBinding(null)
            } catch {
              void 0
            }
          } else {
            try {
              targetAnim.setMorphBinding(remappedBinding)
            } catch {
              void 0
            }
          }
        }
      }
    }

    // IK chains
    if (objectJson.ikChains) {
      for (const chainJson of objectJson.ikChains.chains) {
        const oldBoneIds = chainJson.boneIds as unknown as string[]
        const newBoneIds = oldBoneIds.map((bid) => nodeIdMap.get(bid) ?? bid)
        // Verify all bones exist
        let valid = true
        for (const bid of newBoneIds) {
          try {
            this.getNode(bid)
          } catch {
            valid = false
            break
          }
        }
        if (!valid) continue
        const target = chainJson.target as import('./ikChain').BoneIKTarget
        const poleTarget = chainJson.poleTarget as import('./ikChain').PoleTarget | null
        const newTarget: import('./ikChain').BoneIKTarget = target.nodeId
          ? { ...target, nodeId: nodeIdMap.get(target.nodeId) ?? target.nodeId }
          : { ...target }
        const newPole: import('./ikChain').PoleTarget | null = poleTarget
          ? poleTarget.nodeId
            ? { ...poleTarget, nodeId: nodeIdMap.get(poleTarget.nodeId) ?? poleTarget.nodeId }
            : { ...poleTarget }
          : null
        // Create chain via manager; this will also create new ghost nodes, but we already have imported ghost nodes as scene nodes.
        // To avoid duplicate ghosts, we will create chain then overwrite its ghost ids to point to imported ghosts.
        let created: import('./ikChain').IKChain
        try {
          created = this.#ik.createChain(activeSlide.id, newBoneIds, newTarget, newPole)
        } catch {
          continue
        }
        const oldGhostId = (chainJson as unknown as { ghostNodeId?: string | null }).ghostNodeId
        const oldPoleGhostId = (chainJson as unknown as { poleGhostNodeId?: string | null })
          .poleGhostNodeId
        const newGhostId = oldGhostId ? (nodeIdMap.get(oldGhostId) ?? oldGhostId) : null
        const newPoleGhostId = oldPoleGhostId
          ? (nodeIdMap.get(oldPoleGhostId) ?? oldPoleGhostId)
          : null
        // If imported ghost nodes exist, delete the auto-created ghosts and replace
        if (newGhostId) {
          const autoGhost = (created as unknown as { ghostNodeId: string | null }).ghostNodeId
          if (autoGhost && autoGhost !== newGhostId) {
            try {
              // Remove auto ghost node (it was created under handle)
              this.removeNode(autoGhost)
            } catch {
              void 0
            }
            ;(created as unknown as { ghostNodeId: string | null }).ghostNodeId = newGhostId
            // Ensure the imported ghost's parent is correct (should already be handle)
            // Update target nodeId to point to newGhost
            created.target = { ...created.target, nodeId: newGhostId }
          }
        }
        if (newPoleGhostId) {
          const autoPole = (created as unknown as { poleGhostNodeId: string | null })
            .poleGhostNodeId
          if (autoPole && autoPole !== newPoleGhostId) {
            try {
              this.removeNode(autoPole)
            } catch {
              void 0
            }
            ;(created as unknown as { poleGhostNodeId: string | null }).poleGhostNodeId =
              newPoleGhostId
            if (created.poleTarget) {
              created.poleTarget = { ...created.poleTarget, nodeId: newPoleGhostId }
            }
          }
        }
      }
    }

    // Constraints
    if (objectJson.constraints) {
      for (const [oldNodeId, list] of Object.entries(objectJson.constraints.nodeConstraints)) {
        const newNodeId = nodeIdMap.get(oldNodeId) ?? oldNodeId
        try {
          this.getNode(newNodeId)
        } catch {
          continue
        }
        for (const c of list as unknown as readonly {
          id: string
          type: string
          priority: number
          params: Record<string, unknown>
        }[]) {
          const newParams: Record<string, unknown> = { ...c.params }
          if (typeof newParams.targetNodeId === 'string') {
            newParams.targetNodeId =
              nodeIdMap.get(newParams.targetNodeId as string) ?? (newParams.targetNodeId as string)
          }
          try {
            this.#constraints.addConstraint(
              newNodeId,
              c.type as ConstraintType,
              c.priority,
              newParams as unknown as ConstraintParams,
            )
          } catch {
            void 0
          }
        }
      }
    }

    const rootNewId = nodeIdMap.get(objectJson.rootId)!
    this.#bus.emit({ type: 'NodeCreated', nodeId: rootNewId })
    return { nodeIdMap, clipIdMap, collectionIdMap, rootNewId }
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
    const hasClipCollections = this.#clipCollections.collections.length > 0
    // Add clips and collections to the top-level arrays
    if (this.#clips.clips.length > 0 || hasIK || hasConstraints || hasClipCollections) {
      return {
        ...json,
        ...(this.#clips.clips.length > 0
          ? { clips: this.#clips.clips.map((clip) => clip.toJSON()) }
          : {}),
        ...(hasClipCollections
          ? { clipCollections: this.#clipCollections.collections.map((c) => c.toJSON()) }
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
      // Restore clip collections
      const collections = parseClipCollectionsFromLessonJSON(json)
      for (const col of collections) {
        this.#clipCollections.importCollection(col)
      }
      // Restore IK chains from JSON
      if (json.ikChains) {
        this.#ik.restoreFromJSON(json.ikChains)
        // Migration: ensure ghost handles follow the chain's root parent (one-way parent-follow)
        for (const slide of project.slides) {
          for (const chain of this.#ik.getChainsForSlide(slide.id)) {
            try {
              const rootBone = this.getNode(chain.boneIds[0])
              const expectedParentId = rootBone.parent ? rootBone.parent.id : slide.scene.root.id
              for (const ghostId of [chain.ghostNodeId, chain.poleGhostNodeId].filter(
                Boolean,
              ) as string[]) {
                try {
                  const ghost = this.getNode(ghostId)
                  if (ghost.parent?.id !== expectedParentId) {
                    const scene = this.getNodeScene(ghostId)
                    const oldWorld = worldTransformOf(scene, ghostId)
                    const newParentWorld = worldTransformOf(scene, expectedParentId)
                    this.#nodes.reparent(ghostId, expectedParentId)
                    if (oldWorld && newParentWorld) {
                      const adjusted = relativeTransform(oldWorld, newParentWorld)
                      if (adjusted) {
                        const cur = this.getNode(ghostId).transform
                        if (
                          adjusted.x !== cur.x ||
                          adjusted.y !== cur.y ||
                          adjusted.rotation !== cur.rotation ||
                          adjusted.scaleX !== cur.scaleX ||
                          adjusted.scaleY !== cur.scaleY
                        ) {
                          this.setTransform(ghostId, adjusted)
                        }
                      }
                    }
                  }
                } catch {
                  void 0
                }
              }
            } catch {
              void 0
            }
          }
        }
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
    // Ghosts should be siblings of the chain's root bone so they follow the same parent (e.g., Rig Handle)
    const rootBone = this.getNode(boneIds[0])
    const ghostParentId = rootBone.parent ? rootBone.parent.id : slide.scene.root.id
    const ghostParentWorld = worldTransformOf(slide.scene, ghostParentId)
    const targetWorld = {
      x: target.position.x,
      y: target.position.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    } as import('./worldTransform').WorldTransform
    const ghostLocal = ghostParentWorld ? relativeTransform(targetWorld, ghostParentWorld) : null
    const ghostNode = this.createGhostNode(
      slide.scene.id,
      'IK Target',
      ghostLocal ? ghostLocal.x : target.position.x,
      ghostLocal ? ghostLocal.y : target.position.y,
      undefined,
      ghostParentId,
    )
    // Ensure ghost local preserves exact target world even if parent has rotation/scale
    if (ghostLocal) {
      this.setTransform(ghostNode.id, {
        x: ghostLocal.x,
        y: ghostLocal.y,
        rotation: ghostLocal.rotation,
        scaleX: ghostLocal.scaleX,
        scaleY: ghostLocal.scaleY,
      })
    }
    let resolvedPole: import('./ikChain').PoleTarget | null = poleTarget
    let poleGhostId: string | null = null
    if (poleTarget) {
      if (!poleTarget.nodeId) {
        // Create a ghost node for the pole vector so it can be parented under a Rig Handle.
        // Keep poleTarget plain (no nodeId) for backward compat; ghost is tracked via poleGhostNodeId.
        const poleWorld = {
          x: poleTarget.position.x,
          y: poleTarget.position.y,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        } as import('./worldTransform').WorldTransform
        const poleLocal = ghostParentWorld ? relativeTransform(poleWorld, ghostParentWorld) : null
        const poleGhost = this.createGhostNode(
          slide.scene.id,
          'Pole Target',
          poleLocal ? poleLocal.x : poleTarget.position.x,
          poleLocal ? poleLocal.y : poleTarget.position.y,
          undefined,
          ghostParentId,
        )
        if (poleLocal) {
          this.setTransform(poleGhost.id, {
            x: poleLocal.x,
            y: poleLocal.y,
            rotation: poleLocal.rotation,
            scaleX: poleLocal.scaleX,
            scaleY: poleLocal.scaleY,
          })
        }
        resolvedPole = { position: { ...poleTarget.position } }
        poleGhostId = poleGhost.id
      } else {
        // Caller supplied explicit nodeId — track it as pole ghost if it's a ghost node
        poleGhostId = poleTarget.nodeId
      }
    }
    const chain = this.#ik.createChain(
      slideId,
      boneIds,
      { ...target, nodeId: ghostNode.id },
      resolvedPole,
    )
    chain.ghostNodeId = ghostNode.id
    if (poleGhostId) {
      chain.poleGhostNodeId = poleGhostId
    }
    return chain
  }

  deleteIKChain(chainId: string): import('./ikChain').IKChain {
    const chain = this.#ik.getChain(chainId)
    if (chain.ghostNodeId) {
      try {
        this.deleteGhostNode(chain.ghostNodeId)
      } catch {
        void 0
      }
    }
    if (chain.poleGhostNodeId) {
      try {
        this.deleteGhostNode(chain.poleGhostNodeId)
      } catch {
        void 0
      }
    } else if (chain.poleTarget?.nodeId) {
      // Pole was attached via nodeId (could be ghost or external); clean up if it's a ghost
      try {
        const node = this.getNode(chain.poleTarget.nodeId)
        if (node.components.ghost) {
          this.deleteGhostNode(node.id)
        }
      } catch {
        void 0
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
    const chain = this.#ik.getChain(chainId)
    if (poleTarget && !poleTarget.nodeId) {
      // No explicit node — reuse or create a ghost so the pole can follow a Rig Handle.
      // Keep poleTarget plain; ghost identity tracked via poleGhostNodeId.
      // Ghost position is updated by the caller (e.g., IK interaction) via MoveNode/keyframes, not here,
      // to keep animationMode semantics (keyframes vs direct move) consistent with target handling.
      if (chain.poleGhostNodeId) {
        try {
          this.getNode(chain.poleGhostNodeId)
        } catch {
          const slide = this.getSlide(chain.slideId)
          const ghost = this.createGhostNode(
            slide.scene.id,
            'Pole Target',
            poleTarget.position.x,
            poleTarget.position.y,
          )
          ;(chain as unknown as { poleGhostNodeId: string | null }).poleGhostNodeId = ghost.id
        }
        const resolved: import('./ikChain').PoleTarget = {
          position: { x: poleTarget.position.x, y: poleTarget.position.y },
        }
        this.#ik.setPoleTarget(chainId, resolved)
        return
      }
      if (chain.poleTarget?.nodeId) {
        try {
          this.getNode(chain.poleTarget.nodeId)
          const resolved: import('./ikChain').PoleTarget = {
            position: { x: poleTarget.position.x, y: poleTarget.position.y },
          }
          this.#ik.setPoleTarget(chainId, resolved)
          ;(chain as unknown as { poleGhostNodeId: string | null }).poleGhostNodeId =
            chain.poleTarget.nodeId
          return
        } catch {
          void 0
        }
      }
      // Create new ghost for pole
      const slide = this.getSlide(chain.slideId)
      const ghost = this.createGhostNode(
        slide.scene.id,
        'Pole Target',
        poleTarget.position.x,
        poleTarget.position.y,
      )
      const resolved: import('./ikChain').PoleTarget = {
        position: { x: poleTarget.position.x, y: poleTarget.position.y },
      }
      ;(chain as unknown as { poleGhostNodeId: string | null }).poleGhostNodeId = ghost.id
      this.#ik.setPoleTarget(chainId, resolved)
      return
    }
    if (poleTarget && poleTarget.nodeId) {
      // Explicit nodeId — sync ghost field and ensure ghost cleanup of old pole ghost if different
      if (chain.poleGhostNodeId && chain.poleGhostNodeId !== poleTarget.nodeId) {
        try {
          const oldGhost = this.getNode(chain.poleGhostNodeId)
          if (oldGhost.components.ghost) {
            this.deleteGhostNode(oldGhost.id)
          }
        } catch {
          void 0
        }
      }
      ;(chain as unknown as { poleGhostNodeId: string | null }).poleGhostNodeId = poleTarget.nodeId
    } else if (poleTarget === null && chain.poleGhostNodeId) {
      // Clearing pole — remove its ghost if it's a ghost node
      try {
        const ghost = this.getNode(chain.poleGhostNodeId)
        if (ghost.components.ghost) {
          this.deleteGhostNode(ghost.id)
        }
      } catch {
        void 0
      }
      ;(chain as unknown as { poleGhostNodeId: string | null }).poleGhostNodeId = null
    }
    this.#ik.setPoleTarget(chainId, poleTarget)
  }

  /** Internal method to expose IKManager to renderer for IK evaluation. */
  getIKManager(): import('./ikManager').IKManager {
    return this.#ik
  }

  // --- Ghost node helpers (for IK target anchors) ---

  createGhostNode(
    sceneId: string,
    name: string,
    x: number,
    y: number,
    id?: string,
    parentId?: string,
  ): SceneNode {
    const scene = this.getScene(sceneId)
    const parent = parentId ?? scene.root.id
    return this.createNode(sceneId, parent, name, {
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
    this.#clips.clear()
    this.#clipCollections.clear()
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
    get clipCollections() {
      return engine.clipCollections
    },
    subscribe: (listener) => engine.subscribe(listener),
    openProject: (project, clips, clipCollections) =>
      engine.openProject(project, clips, clipCollections),
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
    deleteEmbeddedAsset: (assetId) => engine.deleteEmbeddedAsset(assetId),
    embedMaterial: (definition) => engine.embedMaterial(definition),
    embedShader: (definition) => engine.embedShader(definition),
    embedDataSource: (definition) => engine.embedDataSource(definition),
    removeDataSource: (id) => engine.removeDataSource(id),
    setTableComponent: (nodeId, table) => engine.setTableComponent(nodeId, table),
    setChartComponent: (nodeId, chart) => engine.setChartComponent(nodeId, chart),
    setTextComponent: (nodeId, text) => engine.setTextComponent(nodeId, text),
    setCircleComponent: (nodeId, circle) => engine.setCircleComponent(nodeId, circle),
    getKeyframes: (nodeId, property) => engine.getKeyframes(nodeId, property),
    getMaterialKeyframes: (nodeId, parameter) => engine.getMaterialKeyframes(nodeId, parameter),
    hasMaterialTrack: (nodeId, parameter) => engine.hasMaterialTrack(nodeId, parameter),
    hasDataLabelTrack: (nodeId, label) => engine.hasDataLabelTrack(nodeId, label),
    getDataLabelKeyframes: (nodeId, label) => engine.getDataLabelKeyframes(nodeId, label),
    getCircleKeyframes: (nodeId, property) => engine.getCircleKeyframes(nodeId, property),
    hasCircleTrack: (nodeId, property) => engine.hasCircleTrack(nodeId, property),
    getTableKeyframes: (nodeId, property) => engine.getTableKeyframes(nodeId, property),
    hasTableTrack: (nodeId, property) => engine.hasTableTrack(nodeId, property),
    getShapes: (nodeId) => engine.getShapes(nodeId),
    getVisibleKeyframes: (nodeId) => engine.getVisibleKeyframes(nodeId),
    hasVisibleTrack: (nodeId) => engine.hasVisibleTrack(nodeId),
    evaluateVisible: (nodeId, time) => engine.evaluateVisible(nodeId, time),
    getMorphKeyframes: (nodeId) => engine.getMorphKeyframes(nodeId),
    hasMorphTrack: (nodeId) => engine.hasMorphTrack(nodeId),
    getMorphBinding: (nodeId) => engine.getMorphBinding(nodeId),
    setMorphBinding: (nodeId, binding) => engine.setMorphBinding(nodeId, binding),
    evaluateMorph: (nodeId, time) => engine.evaluateMorph(nodeId, time),
    evaluateMorphValue: (nodeId, time) => engine.evaluateMorphValue(nodeId, time),
    getAnimatableParameters: (nodeId) => engine.getAnimatableParameters(nodeId),
    evaluateNode: (nodeId, time, target) => engine.evaluateNode(nodeId, time, target),
    evaluateMaterialOverrides: (nodeId, time, target) =>
      engine.evaluateMaterialOverrides(nodeId, time, target),
    evaluateDataLabels: (nodeId, time) => engine.evaluateDataLabels(nodeId, time),
    evaluateCircle: (nodeId, time) => engine.evaluateCircle(nodeId, time),
    evaluateTable: (nodeId, time) => engine.evaluateTable(nodeId, time),
    evaluateMeshDeformation: (nodeId, time, boneWorldTransforms, world) =>
      engine.evaluateMeshDeformation(nodeId, time, boneWorldTransforms, world),
    getIKManager: () => engine.getIKManager(),
    getConstraintManager: () => engine.getConstraintManager(),
    getClip: (clipId) => engine.getClip(clipId),
    getClipChannelKeyframes: (clipId, channel) => engine.getClipChannelKeyframes(clipId, channel),
    getClipInstances: (nodeId) => engine.getClipInstances(nodeId),
    isClipReferenced: (clipId) => engine.isClipReferenced(clipId),
    getClipBlockingNodeNames: (clipId) => engine.getClipBlockingNodeNames(clipId),
    getShadowEffect: (nodeId) => engine.getShadowEffect(nodeId),
    evaluateShadow: (nodeId, time) => engine.evaluateShadow(nodeId, time),
    getCastShadow: (nodeId) => engine.getCastShadow(nodeId),
    setCastShadow: (nodeId, castShadow) => engine.setCastShadow(nodeId, castShadow),
    getClipCollection: (collectionId) => engine.getClipCollection(collectionId),
    createClipCollection: (name, bindings, sourceNodeId) =>
      engine.createClipCollection(name, bindings, sourceNodeId),
    deleteClipCollection: (collectionId) => engine.deleteClipCollection(collectionId),
    renameClipCollection: (collectionId, name) => engine.renameClipCollection(collectionId, name),
    exportClipCollection: (parentNodeId, name) => engine.exportClipCollection(parentNodeId, name),
    applyClipCollection: (collectionId, targetNodeId) =>
      engine.applyClipCollection(collectionId, targetNodeId),
    getExportFrameCount: (duration, fps) => engine.getExportFrameCount(duration, fps),
    getExportFrameTimestamps: (duration, fps) => engine.getExportFrameTimestamps(duration, fps),
    getRubberbandTempoForPlaybackRate: (rate) => engine.getRubberbandTempoForPlaybackRate(rate),
    getDerivedAssetCacheKey: (assetId, rate) => engine.getDerivedAssetCacheKey(assetId, rate),
    buildPerSlideExportDescriptor: (slideId, settings) =>
      engine.buildPerSlideExportDescriptor(slideId, settings),
    buildExportJobDescriptor: (settings) => engine.buildExportJobDescriptor(settings),
    toJSON: () => engine.toJSON(),
    restoreFromJSON: (json) => engine.restoreFromJSON(json),
    exportReusableObject: (rootNodeId, name, description) =>
      engine.exportReusableObject(rootNodeId, name, description),
    importReusableObject: (objectJson, targetParentId) =>
      engine.importReusableObject(objectJson, targetParentId),
  }
}

export type { EnginePublic } from './engine'
