import { Project } from './project'
import type { ProjectMetadata } from './project'
import { Slide } from './slide'
import type { Scene } from './scene'
import { Scene as SceneModel } from './scene'
import { SceneNode, wouldFormCycle, walkPreOrder } from './sceneNode'
import { SlideAnimation } from './animation'
import type { LessonJSON, SceneJSON, SlideJSON } from './json'
import {
  buildEmbeddedAssetsFromJSON,
  buildEmbeddedMaterialsFromJSON,
  buildEmbeddedShadersFromJSON,
  buildEmbeddedDataSourcesFromJSON,
  embeddedLibraryJSON,
  validateLibrary,
  validateLibraryClips,
  validateLibraryClipCollections,
} from './librarySection'
import { ANIMATABLE_PROPERTIES } from './animationProperties'
import type { AnimationProperty } from './animationProperties'
import { isOverrideValue, isRecord, requireString, requireStringAllowEmpty } from './guards'
import { fullscreenShaderFromJSON } from './fullscreenShader'
import {
  validateFullscreenShader,
  validateKeyframeList,
  validateMaterial,
} from './lessonValidation'
import { validateAudioClipJSON, audioClipFromJSON } from './audioClip'
import { validatePrompterJSON, prompterFromJSON } from './prompter'
import type { MaterialParameterKindOf } from './nodeAnimation'
import { DEFAULT_MATERIAL_DEFINITION_ID } from './materialInstance'
import { DEFAULT_MATERIAL_PARAMETERS } from './materialResolution'
import type { MaterialDefinition } from './materialDefinition'
import { ClipDefinition } from './clipDefinition'
import { ClipCollection } from './clipCollection'

export const LESSON_VERSION = 2

export function parseClipsFromLessonJSON(json: LessonJSON): ClipDefinition[] {
  const clipsJson = json.clips ?? json.library?.clips
  const clips: ClipDefinition[] = []
  if (Array.isArray(clipsJson)) {
    for (const clipJson of clipsJson) {
      try {
        clips.push(ClipDefinition.fromJSON(clipJson))
      } catch {
        // Skip invalid clips (already validated)
      }
    }
  }
  return clips
}

export function parseClipCollectionsFromLessonJSON(json: LessonJSON): ClipCollection[] {
  const collectionsJson = json.clipCollections ?? json.library?.clipCollections
  const out: ClipCollection[] = []
  if (Array.isArray(collectionsJson)) {
    for (const colJson of collectionsJson) {
      try {
        out.push(ClipCollection.fromJSON(colJson))
      } catch {
        // skip invalid
      }
    }
  }
  return out
}

const TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const
const TEXT_ALIGNMENTS: readonly string[] = ['left', 'center', 'right']
const ANIMATABLE_PROPERTY_NAMES: readonly string[] = ANIMATABLE_PROPERTIES
const DEFAULT_MATERIAL_KINDS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_MATERIAL_PARAMETERS.map((parameter) => [parameter.key, parameter.kind]),
)

export function serialize(
  project: Project,
  clips?: readonly ClipDefinition[],
  clipCollections?: readonly ClipCollection[],
): string {
  return JSON.stringify(toLessonJSON(project, clips, clipCollections))
}

export function toLessonJSON(
  project: Project,
  clips?: readonly ClipDefinition[],
  clipCollections?: readonly ClipCollection[],
): LessonJSON {
  const library =
    project.embeddedAssets.length > 0 ||
    project.embeddedMaterials.length > 0 ||
    project.embeddedShaders.length > 0 ||
    project.embeddedDataSources.length > 0
      ? embeddedLibraryJSON(
          project.embeddedAssets,
          project.embeddedMaterials,
          project.embeddedShaders,
          project.embeddedDataSources,
        )
      : undefined
  return {
    version: LESSON_VERSION,
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      author: project.author,
      createdAt: project.createdAt,
      modifiedAt: project.updatedAt,
      settings: { ...project.settings },
    },
    slides: project.slides.map((slide) => slide.toJSON()),
    ...(clips !== undefined && clips.length > 0
      ? { clips: clips.map((clip) => clip.toJSON()) }
      : {}),
    ...(clipCollections !== undefined && clipCollections.length > 0
      ? { clipCollections: clipCollections.map((c) => c.toJSON()) }
      : {}),
    ...(library !== undefined ? { library } : {}),
  }
}

export interface DeserializeResult {
  readonly project: Project
  readonly clips: readonly ClipDefinition[]
}

export function deserialize(text: string): Project {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid lesson JSON: the file is not valid JSON')
  }
  const errors = validate(parsed)
  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
  return buildProjectFromJSON(parsed as LessonJSON)
}

export function deserializeWithClips(text: string): DeserializeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid lesson JSON: the file is not valid JSON')
  }
  const errors = validate(parsed)
  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
  const lessonJson = parsed as LessonJSON
  const project = buildProjectFromJSON(lessonJson)
  const clips = parseClipsFromLessonJSON(lessonJson)
  return { project, clips }
}

export function upgrade(text: string): Project {
  return deserialize(text)
}

export function validate(json: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(json)) {
    return ['Invalid lesson JSON: expected an object with version, project, and slides']
  }
  if (json.version !== LESSON_VERSION && json.version !== 1) {
    return [
      `Invalid lesson JSON: unsupported version ${String(json.version)}. Only versions 1 and ${LESSON_VERSION} are supported.`,
    ]
  }
  const project = json.project
  if (!isRecord(project)) {
    errors.push('Invalid lesson JSON: missing project')
  } else {
    requireNonEmptyString(errors, project.id, 'Project id')
    requireNonEmptyString(errors, project.name, 'Project name')
    requireStringValue(errors, project.description, 'Project description')
    requireStringValue(errors, project.author, 'Project author')
    requireNonEmptyString(errors, project.createdAt, 'Project createdAt')
    requireNonEmptyString(errors, project.modifiedAt, 'Project modifiedAt')
    if (project.settings !== undefined && !isRecord(project.settings)) {
      errors.push('Project settings must be an object')
    }
  }
  const slides = json.slides
  if (!Array.isArray(slides)) {
    errors.push('Invalid lesson JSON: missing slides')
    return errors
  }
  if (!isRecord(project)) {
    return errors
  }
  validateLibrary(errors, json.library)
  validateLibraryClips(errors, (json as { clips?: unknown }).clips)
  validateLibraryClipCollections(errors, (json as { clipCollections?: unknown }).clipCollections)
  // also validate library clipCollections if present in library but already covered by validateLibrary
  validateClipReferencesInJSON(errors, json as LessonJSON)
  validateClipCollectionReferencesInJSON(errors, json as LessonJSON)
  const slideIds = new Set<string>()
  const sceneIds = new Set<string>()
  const nodeIds = new Set<string>()
  const keyframeIds = new Set<string>()
  for (const slideJson of slides) {
    validateSlide(errors, slideJson, slideIds, sceneIds, nodeIds, keyframeIds)
  }
  return errors
}

function validateSlide(
  errors: string[],
  slideJson: unknown,
  slideIds: Set<string>,
  sceneIds: Set<string>,
  nodeIds: Set<string>,
  keyframeIds: Set<string>,
): void {
  if (!isRecord(slideJson)) {
    errors.push('Slide must be an object')
    return
  }
  const slideId = requireNonEmptyString(errors, slideJson.id, 'Slide id')
  if (slideId !== undefined) {
    if (slideIds.has(slideId)) {
      errors.push(`A slide with id "${slideId}" already exists`)
    } else {
      slideIds.add(slideId)
    }
  }
  requireNonEmptyString(errors, slideJson.name, 'Slide name')
  const duration = slideJson.duration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    errors.push('Slide duration must be a non-negative finite number')
  }
  if (slideJson.fullscreenShader !== undefined) {
    validateFullscreenShader(errors, slideJson.fullscreenShader, String(slideJson.id))
  }
  const scene = slideJson.scene
  if (!isRecord(scene)) {
    errors.push('Slide scene is missing')
    return
  }
  const sceneId = requireNonEmptyString(errors, scene.id, 'Scene id')
  if (sceneId !== undefined) {
    if (sceneIds.has(sceneId)) {
      errors.push(`A scene with id "${sceneId}" already exists`)
    } else {
      sceneIds.add(sceneId)
    }
  }
  const nodes = scene.nodes
  if (!Array.isArray(nodes)) {
    errors.push('Slide scene must have a nodes array')
    return
  }
  for (const nodeJson of nodes) {
    validateNode(errors, nodeJson, nodeIds)
  }
  // Unique Name per scene validation (block duplicate)
  {
    const seen = new Set<string>()
    for (const nodeJson of nodes) {
      if (isRecord(nodeJson) && typeof nodeJson.name === 'string') {
        if (seen.has(nodeJson.name)) {
          errors.push(`Duplicate node name "${nodeJson.name}" in scene "${String(scene.id)}"`)
        } else {
          seen.add(nodeJson.name)
        }
      }
    }
  }
  const nodeById = new Map<string, Record<string, unknown>>()
  for (const nodeJson of nodes) {
    if (isRecord(nodeJson) && typeof nodeJson.id === 'string') {
      nodeById.set(nodeJson.id, nodeJson)
    }
  }

  const roots = nodes.filter((nodeJson) => isRecord(nodeJson) && nodeJson.parentId === null)
  if (roots.length !== 1) {
    errors.push('A scene must have exactly one root node')
  }
  const cameras = nodes.filter(
    (nodeJson) =>
      isRecord(nodeJson) &&
      isRecord(nodeJson.components) &&
      nodeJson.components.camera !== undefined,
  )
  if (cameras.length !== 1) {
    errors.push('A scene must have exactly one camera node')
  } else {
    const root = roots[0]
    const camera = cameras[0]
    if (isRecord(camera) && isRecord(root) && camera.parentId !== root.id) {
      errors.push('The camera node must be a child of the scene root')
    }
  }

  for (const nodeJson of nodes) {
    if (!isRecord(nodeJson) || typeof nodeJson.parentId !== 'string') {
      continue
    }
    if (!nodeById.has(nodeJson.parentId)) {
      errors.push(`Parent node not found: ${nodeJson.parentId}`)
    }
  }

  for (const nodeJson of nodes) {
    if (!isRecord(nodeJson) || typeof nodeJson.id !== 'string') {
      continue
    }
    let cursor: Record<string, unknown> | undefined = nodeJson
    let steps = 0
    while (
      cursor !== undefined &&
      typeof cursor.parentId === 'string' &&
      cursor.parentId !== cursor.id
    ) {
      if (steps > nodes.length) {
        errors.push('A node cannot become a descendant of itself')
        break
      }
      const next = nodeById.get(cursor.parentId)
      if (next === nodeJson) {
        errors.push('A node cannot become a descendant of itself')
        break
      }
      if (next === undefined) {
        break
      }
      cursor = next
      steps += 1
    }
  }

  validateAnimation(
    errors,
    slideJson.animation,
    typeof duration === 'number' ? duration : 0,
    nodeById,
    keyframeIds,
  )

  if (slideJson.prompter !== undefined) {
    validatePrompterJSON(errors, slideJson.prompter, String(slideJson.id))
  }
  if (slideJson.audio !== undefined) {
    if (!isRecord(slideJson.audio) || !Array.isArray(slideJson.audio.clips)) {
      errors.push(`Slide "${String(slideJson.id)}" audio.clips must be an array`)
    } else {
      const clipIds = new Set<string>()
      for (let i = 0; i < slideJson.audio.clips.length; i++) {
        const clip = slideJson.audio.clips[i] as unknown
        validateAudioClipJSON(errors, clip, `Slide "${String(slideJson.id)}" audio.clips[${i}]`)
        if (isRecord(clip) && typeof clip.id === 'string' && clip.id !== '') {
          if (clipIds.has(clip.id)) errors.push(`Duplicate audio clip id: ${clip.id}`)
          else clipIds.add(clip.id)
        }
      }
    }
  }
}

function validateNode(errors: string[], nodeJson: unknown, nodeIds: Set<string>): void {
  if (!isRecord(nodeJson)) {
    errors.push('Scene node must be an object')
    return
  }
  const id = requireNonEmptyString(errors, nodeJson.id, 'Node id')
  if (id !== undefined) {
    if (nodeIds.has(id)) {
      errors.push(`A node with id "${id}" already exists`)
    } else {
      nodeIds.add(id)
    }
  }
  requireNonEmptyString(errors, nodeJson.name, 'Node name')
  if (
    nodeJson.semanticName !== undefined &&
    (typeof nodeJson.semanticName !== 'string' || nodeJson.semanticName.trim() === '')
  ) {
    errors.push(`Node "${String(nodeJson.id)}" semanticName must be a non-empty string if provided`)
  }
  if (typeof nodeJson.parentId !== 'string' && nodeJson.parentId !== null) {
    errors.push('Node parentId must be a string or null')
  }
  const transform = nodeJson.transform
  if (!isRecord(transform)) {
    errors.push(`Node "${String(nodeJson.id)}" must have a transform`)
  } else {
    for (const key of TRANSFORM_KEYS) {
      if (typeof transform[key] !== 'number' || !Number.isFinite(transform[key])) {
        errors.push(`Node "${String(nodeJson.id)}" transform.${key} must be a number`)
      }
    }
    if ((transform as Record<string, unknown>).localPivot !== undefined) {
      const lp = (transform as Record<string, unknown>).localPivot as Record<string, unknown>
      if (
        typeof lp.x !== 'number' ||
        !Number.isFinite(lp.x) ||
        typeof lp.y !== 'number' ||
        !Number.isFinite(lp.y)
      ) {
        errors.push(`Node "${String(nodeJson.id)}" localPivot must have finite x,y`)
      } else if (lp.x < -0.5 || lp.x > 0.5 || lp.y < -0.5 || lp.y > 0.5) {
        errors.push(`Node "${String(nodeJson.id)}" localPivot must be between -0.5 and 0.5`)
      }
    }
  }
  const localPivot = (nodeJson as Record<string, unknown>).localPivot
  if (localPivot !== undefined) {
    if (
      !isRecord(localPivot) ||
      typeof localPivot.x !== 'number' ||
      typeof localPivot.y !== 'number' ||
      !Number.isFinite(localPivot.x) ||
      !Number.isFinite(localPivot.y)
    ) {
      errors.push(`Node "${String(nodeJson.id)}" localPivot must have finite x,y`)
    } else if (
      (localPivot.x as number) < -0.5 ||
      (localPivot.x as number) > 0.5 ||
      (localPivot.y as number) < -0.5 ||
      (localPivot.y as number) > 0.5
    ) {
      errors.push(`Node "${String(nodeJson.id)}" localPivot must be between -0.5 and 0.5`)
    }
  }
  if (typeof nodeJson.visible !== 'boolean') {
    errors.push(`Node "${String(nodeJson.id)}" visible must be a boolean`)
  }
  if (nodeJson.material !== undefined) {
    validateMaterial(errors, nodeJson.material, String(nodeJson.id))
  }
  if (nodeJson.opacity !== undefined) {
    if (
      typeof nodeJson.opacity !== 'number' ||
      !Number.isFinite(nodeJson.opacity) ||
      nodeJson.opacity < 0 ||
      nodeJson.opacity > 1
    ) {
      errors.push(`Node "${String(nodeJson.id)}" opacity must be a number between 0 and 1`)
    }
  }
  const components = nodeJson.components
  if (!isRecord(components)) {
    errors.push(`Node "${String(nodeJson.id)}" must have a components object`)
    return
  }
  if (components.camera !== undefined) {
    if (!isRecord(components.camera) || components.camera.kind !== 'camera') {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid camera component`)
    }
  }
  if (components.assetInstance !== undefined) {
    const instance = components.assetInstance
    if (
      !isRecord(instance) ||
      instance.kind !== 'assetInstance' ||
      typeof instance.assetDefinitionId !== 'string' ||
      instance.assetDefinitionId === ''
    ) {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid asset definition id`)
    }
  }
  if (components.text !== undefined) {
    const text = components.text
    if (
      !isRecord(text) ||
      text.kind !== 'text' ||
      typeof text.content !== 'string' ||
      typeof text.fontSize !== 'number'
    ) {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid text component`)
    }
    if (
      !isRecord(text) ||
      typeof text.alignment !== 'string' ||
      !(TEXT_ALIGNMENTS as readonly string[]).includes(text.alignment)
    ) {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid text alignment`)
    }
  }
  if (components.table !== undefined) {
    const table = components.table
    if (!isRecord(table) || table.kind !== 'table') {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid table component`)
    } else {
      if (!Array.isArray(table.columns) || table.columns.length === 0) {
        errors.push(`Node "${String(nodeJson.id)}" table must have a non-empty columns array`)
      }
    }
  }
  if (components.chart !== undefined) {
    const chart = components.chart
    if (!isRecord(chart) || chart.kind !== 'chart') {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid chart component`)
    } else {
      if (typeof chart.chartType !== 'string' || chart.chartType === '') {
        errors.push(`Node "${String(nodeJson.id)}" chart must have a non-empty chartType`)
      }
      if (typeof chart.dataSourceId !== 'string' || chart.dataSourceId === '') {
        errors.push(`Node "${String(nodeJson.id)}" chart must have a non-empty dataSourceId`)
      }
    }
  }
  if (components.circle !== undefined) {
    const circle = components.circle as Record<string, unknown>
    if (!isRecord(circle) || circle.kind !== 'circle') {
      errors.push(`Node "${String(nodeJson.id)}" has an invalid circle component`)
    } else {
      if (
        typeof circle.radius !== 'number' ||
        !Number.isFinite(circle.radius) ||
        circle.radius <= 0
      ) {
        errors.push(`Node "${String(nodeJson.id)}" circle radius must be a positive finite number`)
      }
      if (
        typeof circle.startAngle !== 'number' ||
        !Number.isFinite(circle.startAngle) ||
        circle.startAngle < 0 ||
        circle.startAngle > 360
      ) {
        errors.push(`Node "${String(nodeJson.id)}" circle startAngle must be between 0 and 360`)
      }
      if (
        typeof circle.endAngle !== 'number' ||
        !Number.isFinite(circle.endAngle) ||
        circle.endAngle < 0 ||
        circle.endAngle > 360
      ) {
        errors.push(`Node "${String(nodeJson.id)}" circle endAngle must be between 0 and 360`)
      }
      if (circle.segments !== undefined) {
        if (
          typeof circle.segments !== 'number' ||
          !Number.isFinite(circle.segments) ||
          !Number.isInteger(circle.segments) ||
          circle.segments < 3 ||
          circle.segments > 256
        ) {
          errors.push(
            `Node "${String(nodeJson.id)}" circle segments must be an integer between 3 and 256`,
          )
        }
      }
    }
  }
}

function validateAnimation(
  errors: string[],
  animation: unknown,
  duration: number,
  nodeById: Map<string, Record<string, unknown>>,
  keyframeIds: Set<string>,
): void {
  if (animation === undefined) {
    return
  }
  if (!isRecord(animation)) {
    errors.push('Slide animation must be an object')
    return
  }
  if (!Array.isArray(animation.nodes)) {
    errors.push('Slide animation must have a nodes array')
    return
  }
  for (const entry of animation.nodes) {
    if (!isRecord(entry)) {
      errors.push('Slide animation node must be an object')
      continue
    }
    const nodeId = requireNonEmptyString(errors, entry.nodeId, 'Animation node id')
    if (nodeId === undefined) {
      continue
    }
    const node = nodeById.get(nodeId)
    if (!node) {
      errors.push(`Animation references unknown node: ${nodeId}`)
      continue
    }
    const isCamera = isRecord(node.components) && node.components.camera !== undefined
    if (!Array.isArray(entry.tracks)) {
      errors.push('Node animation must have a tracks array')
      continue
    }
    for (const track of entry.tracks) {
      if (!isRecord(track)) {
        errors.push('Animation track must be an object')
        continue
      }
      const property = requireAnimationProperty(errors, track.property)
      if (property === undefined) {
        continue
      }
      if (isCamera && property === 'rotation') {
        errors.push('Camera rotation is not animatable')
      }
      validateKeyframeList(
        errors,
        track.keyframes,
        `Track "${property}"`,
        duration,
        keyframeIds,
        (value, id) => {
          if (property === 'opacity') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
              return `Keyframe "${id}" value (opacity) must be a number between 0 and 1`
            }
            return null
          }
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return `Keyframe "${id}" value must be a finite number`
          }
          return null
        },
      )
    }
    const materialTracks = entry.materialTracks
    if (materialTracks !== undefined) {
      if (!Array.isArray(materialTracks)) {
        errors.push('Node animation materialTracks must be an array')
        continue
      }
      for (const track of materialTracks) {
        if (!isRecord(track)) {
          errors.push('Material track must be an object')
          continue
        }
        const parameter = requireNonEmptyString(errors, track.parameter, 'Material track parameter')
        if (parameter === undefined) {
          continue
        }
        validateKeyframeList(
          errors,
          track.keyframes,
          `Material track "${parameter}"`,
          duration,
          keyframeIds,
          (value, id) =>
            isOverrideValue(value)
              ? null
              : `Keyframe "${id}" value must be a non-empty string, a finite number, a boolean, or a number array`,
        )
      }
    }
    const dataLabelTracks = entry.dataLabelTracks
    if (dataLabelTracks !== undefined) {
      if (!Array.isArray(dataLabelTracks)) {
        errors.push('Node animation dataLabelTracks must be an array')
        continue
      }
      for (const track of dataLabelTracks) {
        if (!isRecord(track)) {
          errors.push('Data label track must be an object')
          continue
        }
        const label = requireNonEmptyString(errors, track.label, 'Data label track label')
        if (label === undefined) {
          continue
        }
        validateKeyframeList(
          errors,
          track.keyframes,
          `Data label track "${label}"`,
          duration,
          keyframeIds,
          (value, id) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              return `Keyframe "${id}" value must be a finite number`
            }
            return null
          },
        )
      }
    }
    const circleTracks = (entry as unknown as Record<string, unknown>).circleTracks
    if (circleTracks !== undefined) {
      if (!Array.isArray(circleTracks)) {
        errors.push('Node animation circleTracks must be an array')
        continue
      }
      for (const track of circleTracks) {
        if (!isRecord(track)) {
          errors.push('Circle track must be an object')
          continue
        }
        const property = requireCircleProperty(errors, track.property)
        if (property === undefined) {
          continue
        }
        validateKeyframeList(
          errors,
          track.keyframes,
          `Circle track "${property}"`,
          duration,
          keyframeIds,
          (value, id) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              return `Keyframe "${id}" value must be a finite number`
            }
            return null
          },
        )
      }
    }
    const tableTracks = (entry as unknown as Record<string, unknown>).tableTracks
    if (tableTracks !== undefined) {
      if (!Array.isArray(tableTracks)) {
        errors.push('Node animation tableTracks must be an array')
        continue
      }
      for (const track of tableTracks) {
        if (!isRecord(track)) {
          errors.push('Table track must be an object')
          continue
        }
        const property = requireTableProperty(errors, track.property)
        if (property === undefined) {
          continue
        }
        validateKeyframeList(
          errors,
          track.keyframes,
          `Table track "${property}"`,
          duration,
          keyframeIds,
          (value, id) => {
            if (typeof value !== 'number' || !Number.isFinite(value) || (value as number) < 0) {
              return `Keyframe "${id}" value must be a non-negative finite number`
            }
            return null
          },
        )
      }
    }
    const visibleTrack = (entry as unknown as Record<string, unknown>).visibleTrack
    if (visibleTrack !== undefined) {
      if (!isRecord(visibleTrack) || !Array.isArray(visibleTrack.keyframes)) {
        errors.push('Visible track must be an object with a keyframes array')
        continue
      }
      validateKeyframeList(
        errors,
        visibleTrack.keyframes,
        'Visible track',
        duration,
        keyframeIds,
        (value, id) => {
          if (typeof value !== 'boolean') {
            return `Keyframe "${id}" value must be a boolean for visible`
          }
          return null
        },
      )
      // Validate hold-only
      for (const kf of visibleTrack.keyframes as unknown[]) {
        if (isRecord(kf) && kf.interpolation !== undefined && kf.interpolation !== 'hold') {
          errors.push(`Visible track keyframe "${String(kf.id)}" interpolation must be "hold"`)
        }
      }
    }
    const morphTrack = (entry as unknown as Record<string, unknown>).morphTrack
    if (morphTrack !== undefined) {
      if (!isRecord(morphTrack) || !Array.isArray(morphTrack.keyframes)) {
        errors.push('Morph track must be an object with a keyframes array')
        continue
      }
      validateKeyframeList(
        errors,
        morphTrack.keyframes,
        'Morph track',
        duration,
        keyframeIds,
        (value, id) => {
          if (typeof value === 'number') {
            if (!Number.isFinite(value) || value < 0 || value > 1) {
              return `Keyframe "${id}" value must be a number between 0 and 1`
            }
            return null
          }
          if (typeof value === 'object' && value !== null) {
            const r = value as Record<string, unknown>
            const from = r.fromShapeId
            const to = r.toShapeId
            const coeff = r.coefficient
            if (from !== null && typeof from !== 'string') {
              return `Keyframe "${id}" fromShapeId must be string or null`
            }
            if (to !== null && typeof to !== 'string') {
              return `Keyframe "${id}" toShapeId must be string or null`
            }
            if (typeof coeff !== 'number' || !Number.isFinite(coeff) || coeff < 0 || coeff > 1) {
              return `Keyframe "${id}" coefficient must be between 0 and 1`
            }
            return null
          }
          return `Keyframe "${id}" value must be number or morph object`
        },
      )
    }
    const morphBinding = (entry as unknown as Record<string, unknown>).morphBinding
    if (morphBinding !== undefined && morphBinding !== null) {
      if (!isRecord(morphBinding)) {
        errors.push(`Node "${nodeId}" morphBinding must be an object`)
      } else {
        const from = morphBinding.fromShapeId
        const to = morphBinding.toShapeId
        if (from !== null && typeof from !== 'string') {
          errors.push(`Node "${nodeId}" morphBinding fromShapeId must be string or null`)
        }
        if (to !== null && typeof to !== 'string') {
          errors.push(`Node "${nodeId}" morphBinding toShapeId must be string or null`)
        }
      }
    }
  }
}

export function buildProjectFromJSON(
  json: LessonJSON,
  registeredDefinitions: readonly MaterialDefinition[] = [],
): Project {
  const projectJson = json.project
  const metadata: ProjectMetadata = {
    id: requireString(projectJson.id, 'Project id'),
    name: requireString(projectJson.name, 'Project name'),
    description: requireStringAllowEmpty(projectJson.description, 'Project description'),
    author: requireStringAllowEmpty(projectJson.author, 'Project author'),
    createdAt: requireString(projectJson.createdAt, 'Project createdAt'),
    updatedAt: requireString(projectJson.modifiedAt, 'Project modifiedAt'),
  }
  const settings = isRecord(projectJson.settings) ? projectJson.settings : {}
  const kindOf = materialKindResolver(json, registeredDefinitions)
  const slides = json.slides.map((slideJson) => buildSlideFromJSON(slideJson, kindOf))
  // Parse clips from top-level clips array, fallback to library.clips
  const clips = parseClipsFromLessonJSON(json)
  // Validate clip references in nodes
  const clipIds = new Set(clips.map((c) => c.id))
  const clipParams = new Map<string, Set<string>>()
  for (const clip of clips) {
    const paramKeys = new Set(clip.params.map((p) => p.key))
    clipParams.set(clip.id, paramKeys)
  }
  for (const slide of slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      for (const instance of node.clipInstances) {
        if (!clipIds.has(instance.clipId)) {
          throw new Error(`Clip instance references unknown clip id: ${instance.clipId}`)
        }
        const paramSet = clipParams.get(instance.clipId)
        if (paramSet) {
          for (const key of Object.keys(instance.paramOverrides)) {
            if (!paramSet.has(key)) {
              throw new Error(
                `Clip instance param override references unknown param key: ${key} in clip ${instance.clipId}`,
              )
            }
          }
        }
      }
    }
  }
  return new Project(
    metadata,
    slides,
    settings,
    buildEmbeddedAssetsFromJSON(json.library),
    buildEmbeddedMaterialsFromJSON(json.library),
    buildEmbeddedShadersFromJSON(json.library),
    buildEmbeddedDataSourcesFromJSON(json.library),
  )
}

function materialKindResolver(
  json: LessonJSON,
  registeredDefinitions: readonly MaterialDefinition[],
): MaterialParameterKindOf {
  const embedded = new Map<string, Readonly<Record<string, string>>>()
  for (const material of buildEmbeddedMaterialsFromJSON(json.library)) {
    const kinds: Record<string, string> = {}
    for (const parameter of material.parameters) {
      kinds[parameter.key] = parameter.kind
    }
    embedded.set(material.id, kinds)
  }
  return (node, parameterKey) => {
    const materialId = node.material?.materialDefinitionId
    if (!materialId) {
      return undefined
    }
    const embeddedKinds = embedded.get(materialId)
    if (embeddedKinds && parameterKey in embeddedKinds) {
      return embeddedKinds[parameterKey]
    }
    if (materialId === DEFAULT_MATERIAL_DEFINITION_ID) {
      return DEFAULT_MATERIAL_KINDS[parameterKey]
    }
    for (const definition of registeredDefinitions) {
      if (definition.id === materialId) {
        return definition.parameters.find((parameter) => parameter.key === parameterKey)?.kind
      }
    }
    return undefined
  }
}

function buildSlideFromJSON(json: SlideJSON, parameterKindOf: MaterialParameterKindOf): Slide {
  const scene = buildSceneFromJSON(json.scene)
  const duration = typeof json.duration === 'number' ? json.duration : 0
  const animation = SlideAnimation.fromJSON(
    json.animation,
    duration,
    (nodeId) => scene.getNode(nodeId),
    parameterKindOf,
  )
  const prompter = json.prompter !== undefined ? prompterFromJSON(json.prompter) : null
  const audioClips =
    json.audio?.clips !== undefined
      ? json.audio.clips.map((clipJson) => audioClipFromJSON(clipJson))
      : []
  return new Slide(
    requireString(json.id, 'Slide id'),
    requireString(json.name, 'Slide name'),
    duration,
    scene,
    animation,
    json.fullscreenShader === undefined
      ? null
      : fullscreenShaderFromJSON(
          json.fullscreenShader,
          `Slide "${String(json.id)}" fullscreenShader`,
        ),
    prompter,
    { clips: audioClips },
  )
}

function buildSceneFromJSON(json: SceneJSON): Scene {
  const sceneId = requireString(json.id, 'Scene id')
  const built = json.nodes.map((nodeJson) => SceneNode.fromJSON(nodeJson))
  const roots = json.nodes.filter((nodeJson) => nodeJson.parentId === null)
  if (roots.length !== 1) {
    throw new Error('A scene must have exactly one root node')
  }
  const root = built.find((node) => node.id === roots[0]?.id)
  if (!root) {
    throw new Error(`Root node not found: ${roots[0]?.id}`)
  }
  const cameras = built.filter((node) => node.components.camera)
  if (cameras.length !== 1) {
    throw new Error('A scene must have exactly one camera node')
  }
  const scene = new SceneModel(sceneId, root, cameras[0])
  for (const node of built) {
    if (node !== root && node !== cameras[0]) {
      scene.register(node)
    }
  }
  for (const nodeJson of json.nodes) {
    if (nodeJson.parentId === null) {
      continue
    }
    const parent = scene.getNode(nodeJson.parentId)
    if (!parent) {
      throw new Error(`Parent node not found: ${nodeJson.parentId}`)
    }
    const node = scene.getNode(nodeJson.id)
    if (!node) {
      throw new Error(`Node not found: ${nodeJson.id}`)
    }
    if (wouldFormCycle(node, parent)) {
      throw new Error('A node cannot become a descendant of itself')
    }
    parent.children.push(node)
    node.parent = parent
  }
  const camera = cameras[0]
  if (camera.parent !== root) {
    throw new Error('The camera node must be a child of the scene root')
  }
  return scene
}

function validateClipReferencesInJSON(errors: string[], json: LessonJSON): void {
  // Parse clips to build lookup maps
  const clips = parseClipsFromLessonJSON(json)
  const clipIds = new Set(clips.map((c) => c.id))
  const clipParams = new Map<string, Set<string>>()
  for (const clip of clips) {
    const paramKeys = new Set(clip.params.map((p) => p.key))
    clipParams.set(clip.id, paramKeys)
  }
  // Walk all nodes in all slides
  for (const slideJson of json.slides) {
    if (!isRecord(slideJson) || !isRecord(slideJson.scene)) continue
    const nodes = slideJson.scene.nodes
    if (!Array.isArray(nodes)) continue
    for (const nodeJson of nodes) {
      if (!isRecord(nodeJson) || !Array.isArray(nodeJson.clipInstances)) continue
      for (const instance of nodeJson.clipInstances) {
        if (!isRecord(instance)) continue
        const clipId = instance.clipId
        if (typeof clipId !== 'string') continue
        if (!clipIds.has(clipId)) {
          errors.push(`Clip instance references unknown clip id: ${clipId}`)
          continue
        }
        const paramSet = clipParams.get(clipId)
        if (paramSet && isRecord(instance.paramOverrides)) {
          for (const key of Object.keys(instance.paramOverrides)) {
            if (!paramSet.has(key)) {
              errors.push(
                `Clip instance param override references unknown param key: ${key} in clip ${clipId}`,
              )
            }
          }
        }
      }
    }
  }
}

function validateClipCollectionReferencesInJSON(errors: string[], json: LessonJSON): void {
  const clips = parseClipsFromLessonJSON(json)
  const clipIds = new Set(clips.map((c) => c.id))
  const collections = parseClipCollectionsFromLessonJSON(json)
  const collectionIds = new Set<string>()
  for (const col of collections) {
    if (collectionIds.has(col.id)) {
      errors.push(`A clipCollection with id "${col.id}" already exists`)
    } else {
      collectionIds.add(col.id)
    }
    if (col.name.trim() === '') {
      errors.push(`ClipCollection "${col.id}" name must be non-empty`)
    }
    for (const [semanticName, clipId] of col.bindings) {
      if (typeof semanticName !== 'string' || semanticName.trim() === '') {
        errors.push(`ClipCollection "${col.id}" has empty semanticName`)
      }
      if (!clipIds.has(clipId)) {
        errors.push(
          `ClipCollection "${col.id}" binding "${semanticName}" references unknown clip id: ${clipId}`,
        )
      }
    }
  }
  // Also validate raw JSON for structural errors not caught by fromJSON (duplicate ids, missing fields)
  const rawCollections =
    (json.clipCollections as unknown) ?? (json.library?.clipCollections as unknown)
  if (Array.isArray(rawCollections)) {
    const seen = new Set<string>()
    for (const raw of rawCollections) {
      if (!isRecord(raw)) {
        errors.push('ClipCollection must be an object')
        continue
      }
      const id = raw.id
      if (typeof id !== 'string' || id === '') {
        errors.push('ClipCollection id must be non-empty string')
      } else if (seen.has(id)) {
        // already reported via collectionIds but also raw
      } else {
        seen.add(id)
      }
      if (typeof raw.name !== 'string' || raw.name === '') {
        errors.push(`ClipCollection "${String(id)}" name must be non-empty string`)
      }
      if (!isRecord(raw.bindings)) {
        errors.push(`ClipCollection "${String(id)}" bindings must be an object`)
      }
    }
  }
}

function requireNonEmptyString(errors: string[], value: unknown, what: string): string | undefined {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${what} must be a non-empty string`)
    return undefined
  }
  return value
}

function requireStringValue(errors: string[], value: unknown, what: string): void {
  if (typeof value !== 'string') {
    errors.push(`${what} must be a string`)
  }
}

function requireAnimationProperty(errors: string[], value: unknown): AnimationProperty | undefined {
  if (
    typeof value !== 'string' ||
    !(ANIMATABLE_PROPERTY_NAMES as readonly string[]).includes(value)
  ) {
    errors.push(`Unknown animation property: ${String(value)}`)
    return undefined
  }
  return value as AnimationProperty
}

const CIRCLE_PROPERTY_NAMES: readonly string[] = ['radius', 'startAngle', 'endAngle', 'segments']

function requireCircleProperty(errors: string[], value: unknown): string | undefined {
  if (typeof value !== 'string' || !(CIRCLE_PROPERTY_NAMES as readonly string[]).includes(value)) {
    errors.push(`Unknown circle animation property: ${String(value)}`)
    return undefined
  }
  return value as string
}

const TABLE_PROPERTY_NAMES: readonly string[] = ['borderRadius', 'padding']

function requireTableProperty(errors: string[], value: unknown): string | undefined {
  if (typeof value !== 'string' || !(TABLE_PROPERTY_NAMES as readonly string[]).includes(value)) {
    errors.push(`Unknown table animation property: ${String(value)}`)
    return undefined
  }
  return value as string
}
