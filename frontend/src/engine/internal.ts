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
    const previous = slide.prompter.parts
    const startTime = previous.slice(0, insertIndex).reduce((sum, part) => sum + part.duration, 0)
    const newPart = {
      id: input.id,
      text: input.text,
      startTime,
      endTime: startTime + input.duration,
      duration: input.duration,
    }
    slide.prompter.parts.splice(insertIndex, 0, newPart)
    if (slide.prompter) reflowPrompter(slide.prompter)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
  }

  importPrompter(
    slideId: string,
    rawText: string,
  ): {
    partIds: string[]
    oldParts: { id: string; text: string; startTime: number; endTime: number; duration: number }[]
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
        }))
      : []
    const texts = splitImportText(rawText, splitChars)
    const parts = texts.map((text) => {
      const duration = estimatePrompterDuration(text, secondsPerCharacter)
      // startTime/endTime will be set by reflow; temporary 0
      return { id: newPrompterPartId(), text, startTime: 0, endTime: duration, duration }
    })
    slide.prompter = { parts }
    reflowPrompter(slide.prompter)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return { partIds: parts.map((p) => p.id), oldParts }
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
    if (patch.text !== undefined && patch.text !== part.text) {
      const settings = this.#projects.current?.settings ?? {}
      const secondsPerCharacter = getPrompterSecondsPerCharacter(settings)
      const hasAudio = hasPrompterPartAudio(part as import('./prompter').PrompterPart)
      if (hasAudio) {
        part.text = patch.text
        part.status = 'stale'
        // duration frozen
      } else {
        part.text = patch.text
        const newDuration = estimatePrompterDuration(patch.text, secondsPerCharacter)
        if (newDuration !== part.duration) {
          part.duration = newDuration
          part.endTime = part.startTime + newDuration
          part.status = undefined
          // Free placement: keep downstream where it is, gap may change; no reflow gap-free
        } else {
          part.status = undefined
        }
      }
    }
    if (patch.duration !== undefined && patch.duration !== part.duration) {
      const delta = patch.duration - part.duration
      part.duration = patch.duration
      part.endTime = part.startTime + part.duration
      // If part has audio and duration changed via explicit duration edit, clear stale? Actually stale remains until resolved, but explicit duration edit may resolve? Keep status as is unless cleared.
      // For spec, duration edit with shift should not affect stale directly.
      if (patch.shiftDownstream) {
        for (let i = index + 1; i < slide.prompter.parts.length; i++) {
          const downstream = slide.prompter.parts[i]
          shiftedParts.push({
            id: downstream.id,
            oldStartTime: downstream.startTime,
            oldEndTime: downstream.endTime,
          })
          downstream.startTime += delta
          downstream.endTime += delta
        }
        for (const clip of slide.audio.clips) {
          if (clip.timelineStart > oldEndTime - 1e-6) {
            shiftedClips.push({ id: clip.id, oldTimelineStart: clip.timelineStart })
            clip.timelineStart += delta
          }
        }
      } else {
        // Free placement: do not reflow gap-free — keep downstream where it is, gap may change
        // Previously reflowPrompter(slide.prompter) would eliminate gaps; now we preserve gaps
      }
    } else if (patch.text !== undefined) {
      // Text-only change already reflowed if no audio case; if hasAudio, we froze duration, so still need to reflow? Duration frozen => no reflow needed, gap-free already holds because duration unchanged. But to be safe, reflow if duration changed via text re-estimate already did.
      if (hasPrompterPartAudio(part as import('./prompter').PrompterPart)) {
        // no duration change, no reflow needed
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

  deletePrompterPart(slideId: string, partId: string): void {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const index = slide.prompter.parts.findIndex((part) => part.id === partId)
    if (index === -1) throw new Error(`PrompterPart not found: ${partId}`)
    slide.prompter.parts.splice(index, 1)
    // Free placement: do not reflow gap-free; keep remaining parts where they are
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
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

  movePrompterPart(slideId: string, partId: string, newIndex: number): number {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const parts = slide.prompter.parts
    const oldIndex = parts.findIndex((p) => p.id === partId)
    if (oldIndex === -1) throw new Error(`PrompterPart not found: ${partId}`)
    if (newIndex < 0 || newIndex >= parts.length)
      throw new Error(`newIndex out of bounds: ${newIndex}`)
    if (oldIndex === newIndex) return oldIndex
    const [moved] = parts.splice(oldIndex, 1)
    parts.splice(newIndex, 0, moved)
    reflowPrompter(slide.prompter)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return oldIndex
  }

  movePrompterPartToTime(
    slideId: string,
    partId: string,
    newStartTime: number,
  ): { oldStartTime: number; oldEndTime: number } {
    const slide = this.getSlide(slideId)
    if (!slide.prompter) throw new Error(`Slide "${slideId}" has no prompter`)
    const part = slide.prompter.parts.find((p) => p.id === partId)
    if (!part) throw new Error(`PrompterPart not found: ${partId}`)
    if (typeof newStartTime !== 'number' || !Number.isFinite(newStartTime) || newStartTime < 0) {
      throw new Error('newStartTime must be a non-negative finite number')
    }
    const oldStartTime = part.startTime
    const oldEndTime = part.endTime
    part.startTime = newStartTime
    part.endTime = newStartTime + part.duration
    // Keep array sorted by startTime so order == time order (gap allowed)
    slide.prompter.parts.sort((a, b) => a.startTime - b.startTime)
    this.#bus.emit({
      type: 'PrompterChanged',
      slideId,
    } as unknown as import('./events').EngineEvent)
    return { oldStartTime, oldEndTime }
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
    const slide = this.getSlideOfNode(nodeTarget.nodeId)
    const animation = slide.animation.node(nodeTarget.nodeId)
    if (!animation) {
      return []
    }
    if (resolved.kind === 'property') {
      return animation.keyframes(resolved.property)
    }
    if (resolved.kind === 'dataLabel') {
      return animation.dataLabelKeyframes(resolved.label)
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
    deleteEmbeddedAsset: (assetId) => engine.deleteEmbeddedAsset(assetId),
    embedMaterial: (definition) => engine.embedMaterial(definition),
    embedShader: (definition) => engine.embedShader(definition),
    embedDataSource: (definition) => engine.embedDataSource(definition),
    removeDataSource: (id) => engine.removeDataSource(id),
    setTableComponent: (nodeId, table) => engine.setTableComponent(nodeId, table),
    setChartComponent: (nodeId, chart) => engine.setChartComponent(nodeId, chart),
    setTextComponent: (nodeId, text) => engine.setTextComponent(nodeId, text),
    getKeyframes: (nodeId, property) => engine.getKeyframes(nodeId, property),
    getMaterialKeyframes: (nodeId, parameter) => engine.getMaterialKeyframes(nodeId, parameter),
    hasMaterialTrack: (nodeId, parameter) => engine.hasMaterialTrack(nodeId, parameter),
    hasDataLabelTrack: (nodeId, label) => engine.hasDataLabelTrack(nodeId, label),
    getDataLabelKeyframes: (nodeId, label) => engine.getDataLabelKeyframes(nodeId, label),
    getAnimatableParameters: (nodeId) => engine.getAnimatableParameters(nodeId),
    evaluateNode: (nodeId, time, target) => engine.evaluateNode(nodeId, time, target),
    evaluateMaterialOverrides: (nodeId, time, target) =>
      engine.evaluateMaterialOverrides(nodeId, time, target),
    evaluateDataLabels: (nodeId, time) => engine.evaluateDataLabels(nodeId, time),
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
