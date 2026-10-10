import type { AnimationProperty, EnginePublic, SceneNode, Slide } from '../engine'
import { composeChain } from '../engine/worldTransform'

export interface ContextSnapshotSlide {
  id: string
  name: string
  order: number
}

export interface ContextSnapshotNodeSummary {
  id: string
  name: string
  parentId: string | null
  depth: number
  semanticName: string | null
  components: string[]
  transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
  worldTransform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number } | null
  visible: boolean
  childCount: number
}

export interface ContextSnapshotClipSummary {
  id: string | null
  name: string
  duration: number | null
  category: string | null
  channelCount: number
  channels: string[]
}

export interface ContextSnapshotCollectionSummary {
  id: string | null
  name: string
  category: string | null
  bindingCount: number
  bindings: Record<string, string>
  hasAlignmentOffsets: boolean
}

export interface ContextSnapshotRigSummary {
  boneCount: number
  bones: { id: string; name: string }[]
  shapeInventory: { nodeId: string; shapeCount: number; shapeNames: string[] }[]
  morphBindings: { nodeId: string; fromShapeId: string | null; toShapeId: string | null }[]
  controls: { hostNodeId: string; keys: string[] }[]
}

export interface ContextSnapshotTimelineNodeSummary {
  nodeId: string
  keyframes: number
  clipInstances: number
  placements: number
}

export interface ContextSnapshotTimelineSummary {
  slideId: string | null
  duration: number | null
  animatedNodeCount: number
  totalKeyframes: number
  clipInstanceCount: number
  placementCount: number
  perNode: ContextSnapshotTimelineNodeSummary[]
  controlHosts: { nodeId: string; keys: string[] }[]
  hasAnimationScript: boolean
}

/** Bounded scene/rig/animation/timeline digest for the animation assistant. */
export interface AnimationAssistantSnapshot {
  nodes: ContextSnapshotNodeSummary[]
  rig: ContextSnapshotRigSummary
  clips: ContextSnapshotClipSummary[]
  collections: ContextSnapshotCollectionSummary[]
  timeline: ContextSnapshotTimelineSummary
  truncated: {
    nodes: boolean
    clips: boolean
    collections: boolean
    timelineNodes: boolean
  }
}

/** Boundedness contract: every list below is capped; flags report truncation. */
export const ANIMATION_SNAPSHOT_LIMITS = {
  nodes: 150,
  bones: 100,
  shapesPerNode: 50,
  clips: 100,
  channelsPerClip: 50,
  collections: 100,
  bindingsPerCollection: 50,
  timelineNodes: 150,
} as const

export interface ContextSnapshot {
  projectName: string
  projectId: string | null
  activeSlideName: string | null
  activeSlideDuration: number | null
  slides: ContextSnapshotSlide[]
  sceneNodes: string[]
  selection: string[]
  materials: string[]
  shaders: string[]
  clips: string[]
  assets: string[]
  clipCollections: string[]
  audio: string[]
  embeddedAudio: string[]
  animatableParams: string[]
  scriptVerbs: string[]
  /** Bounded live-project scene/rig/animation/timeline digest (issue #438). */
  animation: AnimationAssistantSnapshot
}

export interface SnapshotSources {
  selection?: readonly string[]
  assetNames?: readonly string[]
  audioNames?: readonly string[]
}

/** Animatable surface mirrored from engine/animationProperties.ts (Stage B motion checks). */
export const SNAPSHOT_ANIMATABLE_PARAMS: readonly string[] = [
  'positionX',
  'positionY',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
  'radius',
  'startAngle',
  'endAngle',
  'segments',
  'borderRadius',
  'padding',
  'morphCoefficient',
  'tint',
]

/** Animation Script reveal/mark/wipe verbs. */
export const SNAPSHOT_SCRIPT_VERBS: readonly string[] = ['reveal', 'mark', 'wipe']

/**
 * Assemble a read-only digest of the current project state for AI requests.
 * Reads only from the engine read API + UI stores — never from mutation paths.
 * Regenerated per request, never serialized into conversations or the project.
 */
export function buildContextSnapshot(
  engine: EnginePublic,
  sources: SnapshotSources = {},
): ContextSnapshot {
  const started = performance.now()
  const project = engine.project
  const slides: ContextSnapshotSlide[] = project
    ? project.slides.map((slide, index) => ({ id: slide.id, name: slide.name, order: index }))
    : []
  let active: Slide | null = null
  try {
    active = engine.getActiveSlide()
  } catch {
    active = null
  }
  const sceneNodes: string[] = []
  const collected: { node: SceneNode; depth: number }[] = []
  let nodesTruncated = false
  if (active) {
    const visit = (nodeId: string, depth: number): void => {
      if (collected.length >= ANIMATION_SNAPSHOT_LIMITS.nodes) {
        nodesTruncated = true
        return
      }
      try {
        const node = engine.getNode(nodeId)
        collected.push({ node, depth })
        const isCamera = Boolean(node.components?.camera)
        sceneNodes.push(
          isCamera ? `${node.name} [${node.id}] (camera)` : `${node.name} [${node.id}]`,
        )
        for (const child of node.children) visit(child.id, depth + 1)
      } catch {
        // Unresolvable node ids are skipped — snapshot never throws.
      }
    }
    try {
      visit(active.scene.root.id, 0)
    } catch {
      // No scene — empty hierarchy.
    }
  }
  const snapshot: ContextSnapshot = {
    projectName: project?.name ?? '',
    projectId: project?.id ?? null,
    activeSlideName: active?.name ?? null,
    activeSlideDuration: active ? active.duration : null,
    slides,
    sceneNodes: sceneNodes.slice(0, 200),
    selection: [...(sources.selection ?? [])].slice(0, 100),
    materials: engine.materialDefinitions.map((m) => m.name).slice(0, 200),
    shaders: engine.shaderDefinitions.map((s) => s.name).slice(0, 200),
    clips: engine.clips.map((c) => c.name).slice(0, 200),
    assets: [...(sources.assetNames ?? [])].slice(0, 300),
    clipCollections: readCollectionNames(engine).slice(0, 200),
    audio: [...(sources.audioNames ?? [])].slice(0, 200),
    embeddedAudio: readEmbeddedAudioNames(engine).slice(0, 200),
    animatableParams: [...SNAPSHOT_ANIMATABLE_PARAMS],
    scriptVerbs: [...SNAPSHOT_SCRIPT_VERBS],
    animation: buildAnimationSnapshot(engine, active, collected, nodesTruncated),
  }
  const elapsed = performance.now() - started
  if (elapsed > 50) {
    // Performance contract: typical projects assemble well under 50 ms.
    // We log rather than throw so degraded machines still function.
    console.warn(`Context snapshot took ${elapsed.toFixed(1)} ms`)
  }
  return snapshot
}

function buildAnimationSnapshot(
  engine: EnginePublic,
  active: Slide | null,
  collected: readonly { node: SceneNode; depth: number }[],
  nodesTruncated: boolean,
): AnimationAssistantSnapshot {
  const nodes: ContextSnapshotNodeSummary[] = []
  const bones: { id: string; name: string }[] = []
  const shapeInventory: ContextSnapshotRigSummary['shapeInventory'] = []
  const morphBindings: ContextSnapshotRigSummary['morphBindings'] = []
  const controls: ContextSnapshotRigSummary['controls'] = []
  const perNode: ContextSnapshotTimelineNodeSummary[] = []
  let boneTotal = 0
  let totalKeyframes = 0
  let clipInstanceCount = 0
  let placementCount = 0

  for (const { node, depth } of collected) {
    nodes.push(summarizeNode(node, depth))
    try {
      if (node.components?.bone) {
        boneTotal += 1
        if (bones.length < ANIMATION_SNAPSHOT_LIMITS.bones) {
          bones.push({ id: node.id, name: node.name })
        }
      }
    } catch {
      // Component reads never break the snapshot.
    }
    const shapes = readShapes(engine, node.id)
    if (shapes !== null && shapes.shapeCount > 0)
      shapeInventory.push({ nodeId: node.id, ...shapes })
    const morph = readMorphBinding(engine, node.id)
    if (morph !== null) morphBindings.push({ nodeId: node.id, ...morph })
    const keys = readControlKeys(node)
    if (keys.length > 0) controls.push({ hostNodeId: node.id, keys })

    // Timeline state per node — keyframes, clip instances, placements.
    let keyframes = 0
    for (const property of SNAPSHOT_ANIMATABLE_PARAMS) {
      // Only the uniform-six carry engine keyframe lanes; the rest resolve
      // through their own accessors below (morph) or are informational.
      if (
        property !== 'positionX' &&
        property !== 'positionY' &&
        property !== 'rotation' &&
        property !== 'scaleX' &&
        property !== 'scaleY' &&
        property !== 'opacity'
      ) {
        continue
      }
      try {
        const lane = engine.getKeyframes(node.id, property as AnimationProperty)
        if (Array.isArray(lane)) keyframes += lane.length
      } catch {
        // Missing lanes read as empty.
      }
    }
    try {
      const lane = engine.getMorphKeyframes(node.id)
      if (Array.isArray(lane)) keyframes += lane.length
    } catch {
      // Engines without morph lanes read as empty.
    }
    let instances = 0
    try {
      const list = engine.getClipInstances(node.id)
      if (Array.isArray(list)) instances = list.length
    } catch {
      // No instances.
    }
    let placements = 0
    try {
      const list = engine.getCollectionPlacements(node.id)
      if (Array.isArray(list)) placements = list.length
    } catch {
      // No placements.
    }
    totalKeyframes += keyframes
    clipInstanceCount += instances
    placementCount += placements
    if (perNode.length < ANIMATION_SNAPSHOT_LIMITS.timelineNodes) {
      perNode.push({ nodeId: node.id, keyframes, clipInstances: instances, placements })
    }
  }

  const { summaries: clips, truncated: clipsTruncated } = readClipSummaries(engine)
  const { summaries: collections, truncated: collectionsTruncated } =
    readCollectionSummaries(engine)
  let hasAnimationScript = false
  try {
    hasAnimationScript = active?.animationScript != null
  } catch {
    hasAnimationScript = false
  }

  return {
    nodes,
    rig: { boneCount: boneTotal, bones, shapeInventory, morphBindings, controls },
    clips,
    collections,
    timeline: {
      slideId: active?.id ?? null,
      duration: active ? active.duration : null,
      animatedNodeCount: perNode.filter(
        (entry) => entry.keyframes > 0 || entry.clipInstances > 0 || entry.placements > 0,
      ).length,
      totalKeyframes,
      clipInstanceCount,
      placementCount,
      perNode,
      controlHosts: controls.map((entry) => ({ nodeId: entry.hostNodeId, keys: entry.keys })),
      hasAnimationScript,
    },
    truncated: {
      nodes: nodesTruncated,
      clips: clipsTruncated,
      collections: collectionsTruncated,
      timelineNodes: collected.length > perNode.length,
    },
  }
}

function summarizeNode(node: SceneNode, depth: number): ContextSnapshotNodeSummary {
  let parentId: string | null = null
  try {
    parentId = node.parent?.id ?? null
  } catch {
    parentId = null
  }
  let components: string[] = []
  try {
    const record = (node.components ?? {}) as Record<string, unknown>
    components = Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
  } catch {
    components = []
  }
  const transform = readTransform(node)
  return {
    id: node.id,
    name: node.name,
    parentId,
    depth,
    semanticName:
      typeof node.semanticName === 'string' && node.semanticName.trim()
        ? node.semanticName.trim()
        : null,
    components,
    transform,
    worldTransform: readWorldTransform(node),
    visible: node.visible !== false,
    childCount: Array.isArray(node.children) ? node.children.length : 0,
  }
}

function readTransform(node: SceneNode): ContextSnapshotNodeSummary['transform'] {
  const fallback = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
  try {
    const num = (value: unknown, otherwise: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : otherwise
    return {
      x: num(node.transform?.x, fallback.x),
      y: num(node.transform?.y, fallback.y),
      rotation: num(node.transform?.rotation, fallback.rotation),
      scaleX: num(node.transform?.scaleX, fallback.scaleX),
      scaleY: num(node.transform?.scaleY, fallback.scaleY),
    }
  } catch {
    return fallback
  }
}

/**
 * Pure parent-chain composition (no renderer, no engine cache writes — the
 * snapshot never mutates project data, including memo caches).
 */
function readWorldTransform(node: SceneNode): ContextSnapshotNodeSummary['worldTransform'] {
  try {
    const chain: SceneNode[] = []
    for (let cursor: SceneNode | null = node; cursor !== null;) {
      chain.push(cursor)
      cursor = cursor.parent
    }
    chain.reverse()
    const world = composeChain(chain, (link) => link.transform)
    return {
      x: world.x,
      y: world.y,
      rotation: world.rotation,
      scaleX: world.scaleX,
      scaleY: world.scaleY,
    }
  } catch {
    return null
  }
}

function readShapes(
  engine: EnginePublic,
  nodeId: string,
): { shapeCount: number; shapeNames: string[] } | null {
  try {
    const shapes = engine.getShapes(nodeId)
    if (!Array.isArray(shapes)) return null
    const names: string[] = []
    for (const shape of shapes.slice(0, ANIMATION_SNAPSHOT_LIMITS.shapesPerNode)) {
      if (typeof shape?.name === 'string' && shape.name.trim()) names.push(shape.name.trim())
    }
    return { shapeCount: shapes.length, shapeNames: names }
  } catch {
    return null
  }
}

function readMorphBinding(
  engine: EnginePublic,
  nodeId: string,
): { fromShapeId: string | null; toShapeId: string | null } | null {
  try {
    const binding = engine.getMorphBinding(nodeId)
    if (!binding) return null
    return {
      fromShapeId: binding.fromShapeId ?? null,
      toShapeId: binding.toShapeId ?? null,
    }
  } catch {
    return null
  }
}

function readControlKeys(node: SceneNode): string[] {
  try {
    const controls = node.controlSet?.controls
    if (!Array.isArray(controls)) return []
    return controls
      .map((control) => control?.key)
      .filter((key): key is string => typeof key === 'string' && key.trim() !== '')
      .map((key) => key.trim())
  } catch {
    return []
  }
}

function readClipSummaries(engine: EnginePublic): {
  summaries: ContextSnapshotClipSummary[]
  truncated: boolean
} {
  try {
    const clips = engine.clips ?? []
    const summaries = clips.slice(0, ANIMATION_SNAPSHOT_LIMITS.clips).map((clip) => {
      const channelDefs = clip.channels ?? []
      const channels: string[] = []
      for (const channel of channelDefs.slice(0, ANIMATION_SNAPSHOT_LIMITS.channelsPerClip)) {
        if (typeof channel?.property === 'string') channels.push(channel.property)
      }
      return {
        id: typeof clip.id === 'string' ? clip.id : null,
        name: clip.name,
        duration: clip.duration,
        category: clip.category,
        channelCount: channelDefs.length,
        channels,
      }
    })
    return { summaries, truncated: clips.length > summaries.length }
  } catch {
    return { summaries: [], truncated: false }
  }
}

function readCollectionSummaries(engine: EnginePublic): {
  summaries: ContextSnapshotCollectionSummary[]
  truncated: boolean
} {
  try {
    const collections = engine.clipCollections ?? []
    const summaries = collections
      .slice(0, ANIMATION_SNAPSHOT_LIMITS.collections)
      .map((collection) => {
        const entries = readBindingEntries(collection.bindings)
        const bindings: Record<string, string> = {}
        for (const [key, clipId] of entries.slice(
          0,
          ANIMATION_SNAPSHOT_LIMITS.bindingsPerCollection,
        )) {
          bindings[key] = clipId
        }
        let hasAlignmentOffsets = false
        try {
          const offsets = collection.alignmentOffsets as Record<string, unknown> | undefined
          hasAlignmentOffsets = !!offsets && Object.keys(offsets).length > 0
        } catch {
          hasAlignmentOffsets = false
        }
        return {
          id: typeof collection.id === 'string' ? collection.id : null,
          name: collection.name,
          category: collection.category,
          bindingCount: entries.length,
          bindings,
          hasAlignmentOffsets,
        }
      })
    return { summaries, truncated: collections.length > summaries.length }
  } catch {
    return { summaries: [], truncated: false }
  }
}

function readBindingEntries(bindings: unknown): [string, string][] {
  try {
    if (bindings instanceof Map) {
      return [...bindings.entries()].filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      )
    }
    if (bindings && typeof bindings === 'object') {
      return Object.entries(bindings).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      )
    }
  } catch {
    // Unreadable bindings read as empty.
  }
  return []
}

function readCollectionNames(engine: EnginePublic): string[] {
  try {
    const collections = (
      engine as unknown as {
        clipCollections?: readonly {
          name?: unknown
          bindings?: unknown
        }[]
      }
    ).clipCollections
    if (!Array.isArray(collections)) return []
    const names: string[] = []
    for (const collection of collections) {
      if (typeof collection?.name === 'string' && collection.name.trim()) {
        names.push(collection.name.trim())
      }
      const bindings = (collection as { bindings?: unknown }).bindings
      if (bindings instanceof Map) {
        for (const key of bindings.keys()) {
          if (typeof key === 'string' && key.trim()) names.push(key.trim())
        }
      } else if (bindings && typeof bindings === 'object') {
        for (const key of Object.keys(bindings)) {
          if (key.trim()) names.push(key.trim())
        }
      }
    }
    return names
  } catch {
    return []
  }
}

function readEmbeddedAudioNames(engine: EnginePublic): string[] {
  try {
    const embedded = (
      engine as unknown as {
        embeddedAssets?: readonly { name?: unknown; mimeType?: unknown }[]
      }
    ).embeddedAssets
    if (!Array.isArray(embedded)) return []
    return embedded
      .filter(
        (asset) =>
          typeof asset?.mimeType === 'string' &&
          (asset.mimeType as string).startsWith('audio/') &&
          typeof asset?.name === 'string' &&
          (asset.name as string).trim(),
      )
      .map((asset) => (asset.name as string).trim())
  } catch {
    return []
  }
}

export function filterConversations<
  T extends { id: string; title: string },
  M extends { content: string; role: string },
>(
  conversations: readonly T[],
  messagesById: ReadonlyMap<string, readonly M[]> | Record<string, readonly M[] | undefined>,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...conversations]
  const lookup = (id: string): readonly M[] => {
    if (messagesById instanceof Map) return messagesById.get(id) ?? []
    const record = messagesById as Record<string, readonly M[] | undefined>
    return record[id] ?? []
  }
  return conversations.filter((conv) => {
    if (conv.title.toLowerCase().includes(needle)) return true
    for (const message of lookup(conv.id)) {
      if (message.content.toLowerCase().includes(needle)) return true
    }
    return false
  })
}
