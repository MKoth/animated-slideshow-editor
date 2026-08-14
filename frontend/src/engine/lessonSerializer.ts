import { Project } from './project'
import type { ProjectMetadata } from './project'
import { Slide } from './slide'
import type { Scene } from './scene'
import { Scene as SceneModel } from './scene'
import { SceneNode, wouldFormCycle } from './sceneNode'
import { SlideAnimation } from './animation'
import type { LessonJSON, SceneJSON, SlideJSON } from './json'
import { ANIMATABLE_PROPERTIES } from './animationProperties'
import type { AnimationProperty } from './animationProperties'
import { isRecord, requireString, requireStringAllowEmpty } from './guards'

export const LESSON_VERSION = 1

const TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const
const TEXT_ALIGNMENTS: readonly string[] = ['left', 'center', 'right']
const ANIMATABLE_PROPERTY_NAMES: readonly string[] = ANIMATABLE_PROPERTIES

export function serialize(project: Project): string {
  return JSON.stringify(toLessonJSON(project))
}

export function toLessonJSON(project: Project): LessonJSON {
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
  }
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

export function upgrade(text: string): Project {
  return deserialize(text)
}

export function validate(json: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(json)) {
    return ['Invalid lesson JSON: expected an object with version, project, and slides']
  }
  if (json.version !== LESSON_VERSION) {
    return [
      `Invalid lesson JSON: unsupported version ${String(json.version)}. Only version ${LESSON_VERSION} is supported.`,
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
      if (!Array.isArray(track.keyframes)) {
        errors.push(`Track "${property}" must have a keyframes array`)
        continue
      }
      let previousTime = -Infinity
      for (const keyframeJson of track.keyframes) {
        if (!isRecord(keyframeJson)) {
          errors.push(`Track "${property}" keyframe must be an object`)
          continue
        }
        const id = requireNonEmptyString(errors, keyframeJson.id, `Track "${property}" keyframe id`)
        if (id !== undefined) {
          if (keyframeIds.has(id)) {
            errors.push(`Duplicate keyframe id: ${id}`)
          } else {
            keyframeIds.add(id)
          }
        }
        const time = keyframeJson.time
        if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > duration) {
          errors.push(`Keyframe "${String(keyframeJson.id)}" time must be within [0, ${duration}]`)
        } else if (time < previousTime) {
          errors.push(
            `Track "${property}" keyframe times must not decrease (out-of-order time ${time})`,
          )
        } else if (time === previousTime && time !== duration) {
          errors.push(
            `Track "${property}" keyframe times must be distinct (duplicate time ${time} not at the slide duration)`,
          )
        } else {
          previousTime = time
        }
        const value = keyframeJson.value
        if (property === 'opacity') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
            errors.push(
              `Keyframe "${String(keyframeJson.id)}" value (opacity) must be a number between 0 and 1`,
            )
          }
        } else if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`Keyframe "${String(keyframeJson.id)}" value must be a finite number`)
        }
      }
    }
  }
}

export function buildProjectFromJSON(json: LessonJSON): Project {
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
  const slides = json.slides.map((slideJson) => buildSlideFromJSON(slideJson))
  return new Project(metadata, slides, settings)
}

function buildSlideFromJSON(json: SlideJSON): Slide {
  const scene = buildSceneFromJSON(json.scene)
  const duration = typeof json.duration === 'number' ? json.duration : 0
  const animation = SlideAnimation.fromJSON(json.animation, duration, (nodeId) =>
    scene.getNode(nodeId),
  )
  return new Slide(
    requireString(json.id, 'Slide id'),
    requireString(json.name, 'Slide name'),
    duration,
    scene,
    animation,
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
