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
import type { MaterialParameterKindOf } from './nodeAnimation'
import { DEFAULT_MATERIAL_DEFINITION_ID } from './materialInstance'
import { DEFAULT_MATERIAL_PARAMETERS } from './materialResolution'
import type { MaterialDefinition } from './materialDefinition'
import { ClipDefinition } from './clipDefinition'

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

const TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const
const TEXT_ALIGNMENTS: readonly string[] = ['left', 'center', 'right']
const ANIMATABLE_PROPERTY_NAMES: readonly string[] = ANIMATABLE_PROPERTIES
const DEFAULT_MATERIAL_KINDS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_MATERIAL_PARAMETERS.map((parameter) => [parameter.key, parameter.kind]),
)

export function serialize(project: Project, clips?: readonly ClipDefinition[]): string {
  return JSON.stringify(toLessonJSON(project, clips))
}

export function toLessonJSON(project: Project, clips?: readonly ClipDefinition[]): LessonJSON {
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
  validateClipReferencesInJSON(errors, json as LessonJSON)
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
      if (!Array.isArray(table.rows) || table.rows.length === 0) {
        errors.push(`Node "${String(nodeJson.id)}" table must have a non-empty rows array`)
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
