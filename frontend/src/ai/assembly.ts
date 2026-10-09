/**
 * Spec 12 assembly helpers (issue #428). Client mirror of the backend
 * `app/ai/assembly.py` seam: agent project ops stay limited to
 * create-blank-middle, open-named-intro/outro-read-only, and
 * duplicate-to-assembly-target (no delete/rename, sources never mutated).
 * The assembly target is a new project (fresh id, uniquified assembled name,
 * fresh timestamps) from a duplicate-middle base — preserving prompter
 * settings and clip/script libraries — ordered intro then middle then outro.
 *
 * Name collisions resolve first-keeps with ordered numeric auto-suffix
 * (slide names and incoming definition names; node Unique Names untouched in
 * per-scene scope). Embedded assets, materials, shaders, and data sources
 * dedupe by union-on-id (same id keeps target, different ids kept separate,
 * no hash dedup). Full id-domain remapping follows the duplicate plus
 * reusable-object import pattern, then lesson validation plus an
 * embedded-first Missing Assets Report gates the merge.
 */

import type {
  ClipCollectionJSON,
  ClipJSON,
  ConstraintManagerJSON,
  EmbeddedAssetJSON,
  EmbeddedDataSourceJSON,
  EmbeddedFlowchartDataSourceJSON,
  EmbeddedMaterialJSON,
  EmbeddedShaderJSON,
  IKManagerJSON,
  LessonJSON,
  ScriptFunctionJSON,
  SlideJSON,
} from '../engine/json'

export type EmbeddedDataSourceAnyJSON = EmbeddedDataSourceJSON | EmbeddedFlowchartDataSourceJSON

export interface IncomingLibraryJSON {
  readonly assets?: readonly EmbeddedAssetJSON[]
  readonly materials?: readonly EmbeddedMaterialJSON[]
  readonly shaders?: readonly EmbeddedShaderJSON[]
  readonly data_sources?: readonly EmbeddedDataSourceAnyJSON[]
  readonly clips?: readonly ClipJSON[]
  readonly clipCollections?: readonly ClipCollectionJSON[]
  readonly scriptFunctions?: readonly ScriptFunctionJSON[]
  readonly ikChains?: IKManagerJSON | null
  readonly constraints?: ConstraintManagerJSON | null
}

export interface MergeSlidesInput {
  readonly target: LessonJSON
  readonly slides: readonly SlideJSON[]
  /** Source top-level clips/collections (scope-preserved into target top-level). */
  readonly clips?: readonly ClipJSON[] | null
  readonly clipCollections?: readonly ClipCollectionJSON[] | null
  /** Source library scopes (embedded assets/materials/shaders/data sources plus library clips). */
  readonly library?: IncomingLibraryJSON | null
  readonly targetIndex?: number
}

export interface MergeAddedIds {
  readonly assets: readonly string[]
  readonly materials: readonly string[]
  readonly shaders: readonly string[]
  readonly dataSources: readonly string[]
  readonly clips: readonly string[]
  readonly clipCollections: readonly string[]
  readonly scriptFunctions: readonly string[]
}

export interface MergeSlidesOutput {
  readonly lesson: LessonJSON
  readonly insertedSlideIds: readonly string[]
  readonly added: MergeAddedIds
  readonly renamedSlides: Readonly<Record<string, string>>
  readonly renamedDefinitions: Readonly<Record<string, string>>
}

export const ASSEMBLY_FAILED_MESSAGE = 'Assembly merge failed.'
export const ASSEMBLY_STALE_MESSAGE =
  'merge runs only on fully accepted Stage C, D, and E versions — accept the narration, calibration, and board scripts first'

/** Deep-clone JSON without mutating the source (sources never mutated). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Read-only open of a named lesson: deep clone, never the live object. */
export function openNamedReadOnly(lesson: LessonJSON): LessonJSON {
  return cloneJson(lesson)
}

/**
 * Agent project ops allowlist (issue #428). The agent may only
 * create-blank-middle, open-named-intro/outro-read-only, and
 * duplicate-to-assembly-target — never delete or rename, and sources are
 * never mutated. Proposals enforce the same limit through the canonical
 * AI_COMMAND_ALLOWLIST (delete/rename types are rejected schema-side).
 */
export const AGENT_PROJECT_OPS = [
  'create-blank-middle',
  'open-named-intro-outro-read-only',
  'duplicate-to-assembly-target',
] as const

export function assertAgentProjectOpAllowed(op: string): void {
  if (!(AGENT_PROJECT_OPS as readonly string[]).includes(op)) {
    throw new Error(
      `agent project ops are limited to ${AGENT_PROJECT_OPS.join(', ')} — '${op}' is forbidden (no delete/rename; sources never mutated)`,
    )
  }
}

/**
 * Agent op: create a blank middle lesson (fresh id, one middle slide).
 * Built as pure JSON (no engine import — app code mutates only through the
 * command dispatcher); the shape mirrors the engine's blank-project
 * template: version 2, one slide, one scene with exactly one root and one
 * camera child.
 */
export function createBlankMiddle(name: string): LessonJSON {
  assertAgentProjectOpAllowed('create-blank-middle')
  const trimmed = name.trim()
  if (!trimmed) throw new Error('create-blank-middle needs a non-empty name')
  const now = new Date().toISOString()
  const rootId = freshId('node')
  const cameraId = freshId('node')
  const blank = {
    version: 2,
    project: {
      id: freshId('project'),
      name: trimmed,
      description: '',
      author: '',
      createdAt: now,
      modifiedAt: now,
      settings: {},
    },
    slides: [
      {
        id: freshId('slide'),
        name: 'Middle 1',
        duration: 10,
        scene: {
          id: freshId('scene'),
          nodes: [
            {
              id: rootId,
              name: 'Root',
              parentId: null,
              transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
              visible: true,
              components: {},
            },
            {
              id: cameraId,
              name: 'Camera',
              parentId: rootId,
              transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
              visible: true,
              components: { camera: { kind: 'camera' } },
            },
          ],
        },
      },
    ],
  } as unknown as LessonJSON
  return cloneJson(blank)
}

/** Uniquified assembled name: `<base> (assembled)` with ordered numeric suffix. */
export function getUniqueAssembledName(baseName: string, existingNames: readonly string[]): string {
  const existing = new Set(existingNames)
  const base = baseName.trim() || 'Lesson'
  const first = `${base} (assembled)`
  if (!existing.has(first)) return first
  let counter = 2
  while (true) {
    const candidate = `${base} (assembled ${counter})`
    if (!existing.has(candidate)) return candidate
    counter += 1
  }
}

/** Ordered numeric auto-suffix: first-keeps, later `name (2)`, `name (3)`, … */
export function suffixName(name: string, occurrence: number): string {
  if (occurrence <= 1) return name
  return `${name} (${occurrence})`
}

function occurrenceFor(seen: Map<string, number>, name: string): number {
  const next = (seen.get(name) ?? 0) + 1
  seen.set(name, next)
  return next
}

/**
 * Resolve slide-name collisions first-keeps in order. Target names win;
 * each incoming slide keeps its name on first use, otherwise gains an
 * ordered numeric suffix. Node Unique Names are per-scene and untouched.
 */
export function resolveSlideNames(
  targetNames: readonly string[],
  incomingNames: readonly string[],
): string[] {
  const seen = new Map<string, number>()
  for (const name of targetNames) occurrenceFor(seen, name)
  return incomingNames.map((name) => {
    const occurrence = occurrenceFor(seen, name)
    return suffixName(name, occurrence)
  })
}

/** Same first-keeps rule for incoming reusable-definition names. */
export function resolveDefinitionNames(
  targetNames: readonly string[],
  incomingNames: readonly string[],
): string[] {
  return resolveSlideNames(targetNames, incomingNames)
}

/** Union-on-id: same id keeps target, different ids kept separate. */
export function unionById<T extends { readonly id: string }>(
  target: readonly T[],
  incoming: readonly T[] | undefined,
): { merged: T[]; addedIds: string[] } {
  const ids = new Set(target.map((entry) => entry.id))
  const merged: T[] = [...target]
  const addedIds: string[] = []
  for (const entry of incoming ?? []) {
    if (ids.has(entry.id)) continue
    ids.add(entry.id)
    merged.push(cloneJson(entry))
    addedIds.push(entry.id)
  }
  return { merged, addedIds }
}

function idMap(fresh: () => string, olds: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const old of olds) {
    if (!map.has(old)) map.set(old, fresh())
  }
  return map
}

let mergeCounter = 0
function freshId(prefix: string): string {
  mergeCounter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-merge-${Date.now().toString(36)}-${mergeCounter.toString(36)}-${random}`
}

interface RemapTables {
  readonly slide: Map<string, string>
  readonly scene: Map<string, string>
  readonly node: Map<string, string>
  readonly clip: Map<string, string>
  readonly collection: Map<string, string>
}

/** Collect every id in the incoming slides for full-domain remapping. */
function collectRemapTables(slides: readonly SlideJSON[]): RemapTables {
  const slideIds: string[] = []
  const sceneIds: string[] = []
  const nodeIds: string[] = []
  const clipIds = new Set<string>()
  const collectionIds = new Set<string>()
  for (const slide of slides) {
    if (typeof slide.id === 'string') slideIds.push(slide.id)
    const scene = (slide as { scene?: { id?: unknown; nodes?: unknown } }).scene
    if (scene && typeof scene.id === 'string') sceneIds.push(scene.id)
    const nodes = (scene as { nodes?: unknown } | undefined)?.nodes
    if (Array.isArray(nodes)) {
      for (const raw of nodes as Record<string, unknown>[]) {
        if (typeof raw.id === 'string') nodeIds.push(raw.id)
        for (const inst of (raw.clipInstances as Record<string, unknown>[] | undefined) ?? []) {
          if (typeof inst?.clipId === 'string') clipIds.add(inst.clipId)
          if (typeof inst?.collectionId === 'string') collectionIds.add(inst.collectionId)
        }
        for (const placement of (raw.collectionPlacements as
          Record<string, unknown>[] | undefined) ?? []) {
          if (typeof placement?.collectionId === 'string') collectionIds.add(placement.collectionId)
        }
        const controlSet = raw.controlSet as Record<string, unknown> | undefined
        if (controlSet && Array.isArray(controlSet.controls)) {
          for (const control of controlSet.controls as Record<string, unknown>[]) {
            for (const binding of Object.values(
              (control.bindings as Record<string, unknown> | undefined) ?? {},
            )) {
              collectClipRefs(binding, clipIds)
            }
            for (const group of (control.groups as Record<string, unknown>[] | undefined) ?? []) {
              for (const binding of Object.values(
                (group.bindings as Record<string, unknown> | undefined) ?? {},
              )) {
                collectClipRefs(binding, clipIds)
              }
              for (const block of (group.collectionBlocks as
                Record<string, unknown>[] | undefined) ?? []) {
                if (typeof block?.collectionId === 'string') collectionIds.add(block.collectionId)
              }
            }
          }
        }
      }
    }
    const animation = (slide as { animation?: { nodes?: unknown } }).animation
    if (animation && Array.isArray(animation.nodes)) {
      for (const nodeAnim of animation.nodes as Record<string, unknown>[]) {
        if (typeof nodeAnim?.nodeId === 'string') {
          // nodeId refs are covered by nodeIds; clips referenced via controlTracks stay id-stable
        }
      }
    }
  }
  return {
    slide: idMap((() => freshId('slide')) as () => string, slideIds),
    scene: idMap((() => freshId('scene')) as () => string, sceneIds),
    node: idMap((() => freshId('node')) as () => string, nodeIds),
    clip: idMap((() => freshId('clip')) as () => string, [...clipIds]),
    collection: idMap((() => freshId('collection')) as () => string, [...collectionIds]),
  }
}

function collectClipRefs(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectClipRefs(entry, into)
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.clipId === 'string') into.add(record.clipId)
  }
}

function remapBindingValue(value: unknown, clip: Map<string, string>): unknown {
  if (typeof value === 'string') return clip.get(value) ?? value
  if (Array.isArray(value)) return value.map((entry) => remapBindingValue(entry, clip))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.clipId === 'string') {
      return { ...record, clipId: clip.get(record.clipId) ?? record.clipId }
    }
  }
  return value
}

function mergeIkChains(
  target: IKManagerJSON | undefined,
  incoming: IKManagerJSON | null | undefined,
  tables: RemapTables,
): IKManagerJSON | undefined {
  if (!incoming) return target
  const incomingJson = cloneJson(incoming) as unknown as {
    slides?: Record<string, string[]>
    chains?: Record<string, unknown>[]
  }
  const targetSlides = { ...(target?.slides ?? {}) } as Record<string, readonly string[]>
  const targetChains = [...(target?.chains ?? [])]
  const chainIdMap = new Map<string, string>()
  for (const chain of incomingJson.chains ?? []) {
    if (typeof chain.id === 'string' && chain.id && !chainIdMap.has(chain.id)) {
      chainIdMap.set(chain.id, freshId('ikChain'))
    }
  }
  for (const [oldSlideId, chainIds] of Object.entries(incomingJson.slides ?? {})) {
    const nextSlideId = tables.slide.get(oldSlideId) ?? oldSlideId
    const nextChainIds = ((chainIds ?? []) as readonly string[]).map(
      (chainId) => chainIdMap.get(chainId) ?? chainId,
    )
    targetSlides[nextSlideId] = [...(targetSlides[nextSlideId] ?? []), ...nextChainIds]
  }
  const remappedChains: Record<string, unknown>[] = []
  for (const chain of incomingJson.chains ?? []) {
    if (typeof chain.id === 'string') chain.id = chainIdMap.get(chain.id) ?? freshId('ikChain')
    else chain.id = freshId('ikChain')
    if (typeof chain.slideId === 'string') {
      chain.slideId = tables.slide.get(chain.slideId) ?? chain.slideId
    }
    if (Array.isArray(chain.boneIds)) {
      chain.boneIds = (chain.boneIds as string[]).map((bid) => tables.node.get(bid) ?? bid)
    }
    for (const key of ['target', 'poleTarget'] as const) {
      const ref = chain[key] as Record<string, unknown> | null | undefined
      if (ref && typeof ref === 'object' && typeof ref.nodeId === 'string') {
        ref.nodeId = tables.node.get(ref.nodeId) ?? ref.nodeId
      }
    }
    for (const key of ['ghostNodeId', 'poleGhostNodeId'] as const) {
      if (typeof chain[key] === 'string' && chain[key]) {
        chain[key] = tables.node.get(chain[key] as string) ?? (chain[key] as string)
      }
    }
    remappedChains.push(chain)
  }
  return {
    slides: targetSlides,
    chains: [...targetChains, ...remappedChains],
  } as unknown as IKManagerJSON
}

function mergeConstraints(
  target: ConstraintManagerJSON | undefined,
  incoming: ConstraintManagerJSON | null | undefined,
  tables: RemapTables,
): ConstraintManagerJSON | undefined {
  if (!incoming) return target
  const incomingJson = cloneJson(incoming) as unknown as {
    nodeConstraints?: Record<string, Record<string, unknown>[]>
  }
  const merged = { ...(target?.nodeConstraints ?? {}) } as Record<string, unknown[]>
  for (const [oldNodeId, list] of Object.entries(incomingJson.nodeConstraints ?? {})) {
    const nextNodeId = tables.node.get(oldNodeId) ?? oldNodeId
    const remapped = (list ?? []).map((entry) => {
      const copy = { ...entry }
      copy.id = freshId('constraint')
      const params = { ...((copy.params as Record<string, unknown> | undefined) ?? {}) }
      if (typeof params.targetNodeId === 'string' && params.targetNodeId) {
        params.targetNodeId = tables.node.get(params.targetNodeId) ?? params.targetNodeId
      }
      copy.params = params
      return copy
    })
    merged[nextNodeId] = [...((merged[nextNodeId] as unknown[] | undefined) ?? []), ...remapped]
  }
  return { nodeConstraints: merged } as unknown as ConstraintManagerJSON
}

/**
 * Pure merge: target ordered with incoming slides inserted at targetIndex
 * (default append), full id-domain remap, suffix collisions, union-on-id.
 * Neither input is mutated. Throws a fixable message on empty input.
 */
export function mergeSlidesIntoLesson(input: MergeSlidesInput): MergeSlidesOutput {
  const target = cloneJson(input.target)
  const incomingSlides = cloneJson([...input.slides])
  if (incomingSlides.length === 0) {
    throw new Error(
      'assembly merge needs at least one incoming slide — open the named intro/outro project first',
    )
  }
  const library = input.library ? cloneJson(input.library) : {}
  const slideCount = target.slides.length
  const targetIndex = input.targetIndex ?? slideCount
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > slideCount) {
    throw new Error(
      `assembly merge targetIndex ${String(input.targetIndex)} is outside [0, ${slideCount}] — re-validate the proposal`,
    )
  }

  const targetSlideNames = (target.slides as SlideJSON[]).map((slide) => slide.name)
  const incomingNames = (incomingSlides as SlideJSON[]).map((slide) => slide.name)
  const resolvedNames = resolveSlideNames(targetSlideNames, incomingNames)
  const renamedSlides: Record<string, string> = {}

  const tables = collectRemapTables(incomingSlides as SlideJSON[])

  // Scope-preserved reusable definitions: source top-level clips stay
  // top-level, source library clips stay library-scoped (same for
  // collections). Both scopes share one id-remap so slide references
  // (clipInstances, bindings, placements) resolve regardless of scope.
  const incomingTopClips = [...(input.clips ?? [])] as ClipJSON[]
  const incomingTopCollections = [...(input.clipCollections ?? [])] as ClipCollectionJSON[]
  const incomingLibClips = [...(library.clips ?? [])] as ClipJSON[]
  const incomingLibCollections = [...(library.clipCollections ?? [])] as ClipCollectionJSON[]
  const clipIdRemap = new Map<string, string>()
  for (const clip of [...incomingTopClips, ...incomingLibClips]) {
    if (typeof clip.id !== 'string' || !clip.id) continue
    if (!clipIdRemap.has(clip.id)) clipIdRemap.set(clip.id, freshId('clip'))
  }
  const collectionIdRemap = new Map<string, string>()
  for (const col of [...incomingTopCollections, ...incomingLibCollections]) {
    if (typeof col.id !== 'string' || !col.id) continue
    if (!collectionIdRemap.has(col.id)) collectionIdRemap.set(col.id, freshId('collection'))
  }
  // Slide-embedded clip refs that are not in the carried library still get
  // fresh ids from the slide-domain tables so no id ever collides mid-flight.
  for (const [oldId, fresh] of tables.clip) {
    if (!clipIdRemap.has(oldId)) clipIdRemap.set(oldId, fresh)
  }
  for (const [oldId, fresh] of tables.collection) {
    if (!collectionIdRemap.has(oldId)) collectionIdRemap.set(oldId, fresh)
  }

  // Shared audio-clip map (duplicate pattern): prompter parts, word-level
  // segments, and slide audio clips reference one id domain, so every old
  // audio-clip id maps to exactly one fresh id — links survive the merge.
  const audioClipIdMap = new Map<string, string>()
  const collectAudioClipId = (rawId: unknown): void => {
    if (typeof rawId === 'string' && rawId && !audioClipIdMap.has(rawId)) {
      audioClipIdMap.set(rawId, freshId('audio-clip'))
    }
  }
  for (const slide of incomingSlides as SlideJSON[]) {
    const prompter = (slide as unknown as { prompter?: { parts?: Record<string, unknown>[] } })
      .prompter
    if (prompter && Array.isArray(prompter.parts)) {
      for (const part of prompter.parts) {
        collectAudioClipId(part.audioClipId)
        for (const seg of (part.segments as Record<string, unknown>[] | undefined) ?? []) {
          collectAudioClipId(seg.audioClipId)
        }
      }
    }
    const audio = (slide as unknown as { audio?: { clips?: Record<string, unknown>[] } }).audio
    if (audio && Array.isArray(audio.clips)) {
      for (const clip of audio.clips) collectAudioClipId(clip.id)
    }
  }
  const audioSegmentIdMap = new Map<string, string>()
  for (const slide of incomingSlides as SlideJSON[]) {
    const prompter = (slide as unknown as { prompter?: { parts?: Record<string, unknown>[] } })
      .prompter
    if (prompter && Array.isArray(prompter.parts)) {
      for (const part of prompter.parts) {
        for (const seg of (part.segments as Record<string, unknown>[] | undefined) ?? []) {
          if (typeof seg.id === 'string' && seg.id && !audioSegmentIdMap.has(seg.id)) {
            audioSegmentIdMap.set(seg.id, freshId('audio-segment'))
          }
        }
      }
    }
  }

  const remappedSlides = (incomingSlides as SlideJSON[]).map((slide, order) => {
    const copy = slide as unknown as Record<string, unknown>
    const resolvedName = resolvedNames[order] ?? slide.name
    if (resolvedName !== slide.name) renamedSlides[slide.id] = resolvedName
    const nextSlideId = tables.slide.get(slide.id) ?? freshId('slide')
    const scene = cloneJson(copy.scene) as unknown as Record<string, unknown>
    const nextSceneId =
      tables.scene.get(String((copy.scene as { id: unknown }).id)) ?? freshId('scene')
    scene.id = nextSceneId
    const shapeMapsByNewNode = new Map<string, Map<string, string>>()
    const nodes = (scene.nodes as Record<string, unknown>[]) ?? []
    for (const node of nodes) {
      const oldNodeId = String(node.id)
      const nextNodeId = tables.node.get(oldNodeId) ?? freshId('node')
      node.id = nextNodeId
      if (node.parentId !== null && typeof node.parentId === 'string') {
        node.parentId = tables.node.get(node.parentId) ?? node.parentId
      }
      // Node Unique Names are per-scene: untouched by design.
      for (const inst of (node.clipInstances as Record<string, unknown>[] | undefined) ?? []) {
        if (typeof inst.id === 'string') inst.id = freshId('clip-instance')
        if (typeof inst.clipId === 'string')
          inst.clipId = clipIdRemap.get(inst.clipId) ?? inst.clipId
        if (typeof inst.collectionId === 'string')
          inst.collectionId = collectionIdRemap.get(inst.collectionId) ?? inst.collectionId
        if (typeof inst.collectionTargetId === 'string')
          inst.collectionTargetId =
            tables.node.get(inst.collectionTargetId) ?? inst.collectionTargetId
        if (typeof inst.placementId === 'string') inst.placementId = freshId('placement')
      }
      for (const placement of (node.collectionPlacements as
        Record<string, unknown>[] | undefined) ?? []) {
        if (typeof placement.id === 'string') placement.id = freshId('placement')
        if (typeof placement.collectionId === 'string')
          placement.collectionId =
            collectionIdRemap.get(placement.collectionId) ?? placement.collectionId
        if (typeof placement.parentNodeId === 'string')
          placement.parentNodeId = tables.node.get(placement.parentNodeId) ?? placement.parentNodeId
      }
      const controlSet = node.controlSet as Record<string, unknown> | undefined
      if (controlSet && typeof controlSet === 'object') {
        controlSet.id = freshId('control-set')
        if (typeof controlSet.hostNodeId === 'string')
          controlSet.hostNodeId = tables.node.get(controlSet.hostNodeId) ?? String(node.id)
        else controlSet.hostNodeId = String(node.id)
        for (const control of (controlSet.controls as Record<string, unknown>[] | undefined) ??
          []) {
          control.id = freshId('control')
          if (control.bindings && typeof control.bindings === 'object') {
            const bindings = control.bindings as Record<string, unknown>
            for (const [key, value] of Object.entries(bindings)) {
              bindings[key] = remapBindingValue(value, clipIdRemap)
            }
          }
          for (const group of (control.groups as Record<string, unknown>[] | undefined) ?? []) {
            group.id = freshId('control-group')
            if (group.bindings && typeof group.bindings === 'object') {
              const bindings = group.bindings as Record<string, unknown>
              for (const [key, value] of Object.entries(bindings)) {
                bindings[key] = remapBindingValue(value, clipIdRemap)
              }
            }
            for (const block of (group.collectionBlocks as Record<string, unknown>[] | undefined) ??
              []) {
              block.id = freshId('control-block')
              if (typeof block.collectionId === 'string')
                block.collectionId = collectionIdRemap.get(block.collectionId) ?? block.collectionId
            }
          }
        }
      }
      const components = node.components as Record<string, unknown> | undefined
      const meshComp = (components?.mesh as Record<string, unknown> | undefined) ?? null
      if (meshComp && typeof meshComp === 'object') {
        const shapeMap = new Map<string, string>()
        const categoryMap = new Map<string, string>()
        if (Array.isArray(meshComp.shapes)) {
          for (const shape of meshComp.shapes as Record<string, unknown>[]) {
            if (typeof shape.id === 'string' && shape.id) {
              const fresh = freshId('shape')
              shapeMap.set(shape.id, fresh)
              shape.id = fresh
            }
            if (typeof shape.categoryId === 'string' && shape.categoryId) {
              if (!categoryMap.has(shape.categoryId))
                categoryMap.set(shape.categoryId, freshId('shapeCategory'))
              shape.categoryId = categoryMap.get(shape.categoryId)!
            }
          }
        }
        if (Array.isArray(meshComp.shapeCategories)) {
          for (const cat of meshComp.shapeCategories as Record<string, unknown>[]) {
            if (typeof cat.id === 'string' && cat.id) {
              cat.id = categoryMap.get(cat.id) ?? freshId('shapeCategory')
            }
            if (typeof cat.parentId === 'string' && cat.parentId) {
              cat.parentId = categoryMap.get(cat.parentId) ?? cat.parentId
            } else if (cat.parentId !== null && cat.parentId !== undefined) {
              // keep null parent as-is
            }
          }
        }
        if (shapeMap.size > 0) shapeMapsByNewNode.set(String(node.id), shapeMap)
      }
    }
    const animation = copy.animation as { nodes?: Record<string, unknown>[] } | undefined
    if (animation && Array.isArray(animation.nodes)) {
      for (const nodeAnim of animation.nodes) {
        const oldAnimNodeId = typeof nodeAnim.nodeId === 'string' ? nodeAnim.nodeId : null
        if (typeof nodeAnim.nodeId === 'string')
          nodeAnim.nodeId = tables.node.get(nodeAnim.nodeId) ?? nodeAnim.nodeId
        const shapeMap = oldAnimNodeId
          ? shapeMapsByNewNode.get(tables.node.get(oldAnimNodeId) ?? oldAnimNodeId)
          : undefined
        const morphBinding = (nodeAnim as Record<string, unknown>).morphBinding as
          Record<string, unknown> | null | undefined
        if (morphBinding && typeof morphBinding === 'object' && shapeMap) {
          if (typeof morphBinding.fromShapeId === 'string' && morphBinding.fromShapeId) {
            morphBinding.fromShapeId =
              shapeMap.get(morphBinding.fromShapeId) ?? morphBinding.fromShapeId
          }
          if (typeof morphBinding.toShapeId === 'string' && morphBinding.toShapeId) {
            morphBinding.toShapeId = shapeMap.get(morphBinding.toShapeId) ?? morphBinding.toShapeId
          }
        }
        for (const track of (nodeAnim.tracks as
          { keyframes?: Record<string, unknown>[] }[] | undefined) ?? []) {
          for (const kf of track.keyframes ?? []) kf.id = freshId('keyframe')
        }
        for (const key of [
          'materialTracks',
          'dataLabelTracks',
          'circleTracks',
          'tableTracks',
          'shadowTracks',
          'controlTracks',
        ] as const) {
          for (const track of ((nodeAnim as Record<string, unknown>)[key] as
            { keyframes?: Record<string, unknown>[] }[] | undefined) ?? []) {
            for (const kf of track.keyframes ?? []) kf.id = freshId('keyframe')
          }
        }
        for (const key of ['visibleTrack', 'morphTrack', 'symmetryTrack', 'zIndexTrack'] as const) {
          const track = (nodeAnim as Record<string, unknown>)[key] as
            { keyframes?: Record<string, unknown>[] } | undefined
          if (track && Array.isArray(track.keyframes)) {
            for (const kf of track.keyframes) {
              kf.id = freshId('keyframe')
              if (key === 'morphTrack' && shapeMap) {
                const value = kf.value as Record<string, unknown> | null | undefined
                if (value && typeof value === 'object') {
                  if (typeof value.fromShapeId === 'string' && value.fromShapeId) {
                    value.fromShapeId = shapeMap.get(value.fromShapeId) ?? value.fromShapeId
                  }
                  if (typeof value.toShapeId === 'string' && value.toShapeId) {
                    value.toShapeId = shapeMap.get(value.toShapeId) ?? value.toShapeId
                  }
                }
              }
            }
          }
        }
      }
    }
    // Slide-level animationScript footprint: remap node refs via the node map.
    const animationScript = copy.animationScript as Record<string, unknown> | undefined
    if (animationScript && typeof animationScript === 'object') {
      const compiled = animationScript.lastCompiled as Record<string, unknown> | undefined
      if (compiled && typeof compiled === 'object') {
        const tracks = compiled.tracks as { nodeId?: unknown }[] | undefined
        if (Array.isArray(tracks)) {
          for (const track of tracks) {
            if (track && typeof track.nodeId === 'string') {
              track.nodeId = tables.node.get(track.nodeId) ?? track.nodeId
            }
          }
        }
        for (const key of ['placementParents', 'instanceNodes', 'createdNodes'] as const) {
          const list = compiled[key] as unknown
          if (Array.isArray(list)) {
            compiled[key] = (list as unknown[]).map((entry) =>
              typeof entry === 'string' ? (tables.node.get(entry) ?? entry) : entry,
            )
          }
        }
      }
    }
    // Scene effects: fresh effect ids + node-id remap.
    const effects = copy.effects as Record<string, unknown>[] | undefined
    if (Array.isArray(effects)) {
      for (const effect of effects) {
        if (typeof effect.id === 'string' && effect.id) effect.id = freshId('scene-effect')
        for (const key of ['scopeNodeIds', 'nodeIds'] as const) {
          const list = effect[key] as unknown
          if (Array.isArray(list)) {
            effect[key] = (list as unknown[]).map((entry) =>
              typeof entry === 'string' ? (tables.node.get(entry) ?? entry) : entry,
            )
          }
        }
        const visual = effect.visual as Record<string, unknown> | undefined
        if (visual && typeof visual.nodeId === 'string') {
          visual.nodeId = tables.node.get(visual.nodeId) ?? visual.nodeId
        }
      }
    }
    const prompter = copy.prompter as { parts?: Record<string, unknown>[] } | undefined
    if (prompter && Array.isArray(prompter.parts)) {
      for (const part of prompter.parts) {
        if (typeof part.id === 'string') part.id = freshId('prompter-part')
        if (typeof part.audioClipId === 'string') {
          part.audioClipId = audioClipIdMap.get(part.audioClipId) ?? part.audioClipId
        }
        for (const seg of (part.segments as Record<string, unknown>[] | undefined) ?? []) {
          if (typeof seg.id === 'string') {
            seg.id = audioSegmentIdMap.get(seg.id) ?? freshId('audio-segment')
          }
          if (typeof seg.audioClipId === 'string') {
            seg.audioClipId = audioClipIdMap.get(seg.audioClipId) ?? seg.audioClipId
          }
        }
      }
    }
    const audio = copy.audio as { clips?: Record<string, unknown>[] } | undefined
    if (audio && Array.isArray(audio.clips)) {
      for (const clip of audio.clips) {
        if (typeof clip.id === 'string') {
          clip.id = audioClipIdMap.get(clip.id) ?? freshId('audio-clip')
        }
      }
    }
    copy.id = nextSlideId
    copy.name = resolvedName
    copy.scene = scene
    return copy as unknown as SlideJSON
  })

  // Incoming reusable definitions: fresh ids + suffix collisions on names,
  // scope-preserved (top-level stays top-level, library stays library).
  const targetClips = [...((target as { clips?: ClipJSON[] }).clips ?? [])]
  const targetCollections = [
    ...((target as { clipCollections?: ClipCollectionJSON[] }).clipCollections ?? []),
  ]
  const targetLibrary = (target.library ?? {}) as {
    clips?: ClipJSON[]
    clipCollections?: ClipCollectionJSON[]
    scriptFunctions?: ScriptFunctionJSON[]
  }
  const targetTopClipNames = targetClips.map((c) => c.name)
  const targetLibClipNames = [...(targetLibrary.clips ?? [])].map((c) => c.name)
  const targetTopCollectionNames = targetCollections.map((c) => c.name)
  const targetLibCollectionNames = [...(targetLibrary.clipCollections ?? [])].map((c) => c.name)
  const targetScriptNames = [...(targetLibrary.scriptFunctions ?? [])].map((s) => s.name)
  const renamedDefinitions: Record<string, string> = {}

  const remapClipList = (clips: ClipJSON[], scopeNames: readonly string[]): ClipJSON[] => {
    const remapped = clips.map((clip) => {
      const copy = { ...(clip as unknown as Record<string, unknown>) } as unknown as ClipJSON
      const nextId = clipIdRemap.get(clip.id) ?? freshId('clip')
      const record = copy as unknown as Record<string, unknown>
      record.id = nextId
      const channels = record.channelAnimations as
        Record<string, { keyframes?: Record<string, unknown>[] }> | undefined
      if (channels) {
        for (const anim of Object.values(channels)) {
          for (const kf of anim.keyframes ?? []) kf.id = freshId('keyframe')
        }
      }
      return copy
    })
    const resolved = resolveDefinitionNames(
      scopeNames,
      remapped.map((c) => c.name),
    )
    remapped.forEach((clip, index) => {
      const name = resolved[index] ?? clip.name
      if (name !== clip.name) renamedDefinitions[clip.id] = name
      ;(clip as unknown as Record<string, unknown>).name = name
    })
    return remapped
  }
  const remappedTopClips = remapClipList(incomingTopClips, targetTopClipNames)
  const remappedLibClips = remapClipList(incomingLibClips, targetLibClipNames)

  const remapCollectionList = (
    cols: ClipCollectionJSON[],
    scopeNames: readonly string[],
  ): ClipCollectionJSON[] => {
    const remapped = cols.map((col) => {
      const copy = {
        ...(col as unknown as Record<string, unknown>),
      } as unknown as ClipCollectionJSON
      const record = copy as unknown as Record<string, unknown>
      record.id = collectionIdRemap.get(col.id) ?? freshId('collection')
      const bindings = { ...((record.bindings as Record<string, string> | undefined) ?? {}) }
      for (const [key, clipId] of Object.entries(bindings)) {
        bindings[key] = clipIdRemap.get(clipId) ?? clipId
      }
      record.bindings = bindings
      if (typeof record.sourceNodeId === 'string')
        record.sourceNodeId = tables.node.get(record.sourceNodeId) ?? record.sourceNodeId
      return copy
    })
    const resolved = resolveDefinitionNames(
      scopeNames,
      remapped.map((c) => c.name),
    )
    remapped.forEach((col, index) => {
      const name = resolved[index] ?? col.name
      if (name !== col.name) renamedDefinitions[col.id] = name
      ;(col as unknown as Record<string, unknown>).name = name
    })
    return remapped
  }
  const remappedTopCollections = remapCollectionList(
    incomingTopCollections,
    targetTopCollectionNames,
  )
  const remappedLibCollections = remapCollectionList(
    incomingLibCollections,
    targetLibCollectionNames,
  )

  const incomingScripts = [...(library.scriptFunctions ?? [])] as ScriptFunctionJSON[]
  const resolvedScriptNames = resolveDefinitionNames(
    targetScriptNames,
    incomingScripts.map((s) => s.name),
  )
  const remappedScripts = incomingScripts.map((entry, index) => {
    const copy = {
      ...(entry as unknown as Record<string, unknown>),
    } as unknown as ScriptFunctionJSON
    const record = copy as unknown as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) record.id = freshId('script')
    else record.id = freshId('script')
    const resolved = resolvedScriptNames[index] ?? entry.name
    if (resolved !== entry.name) renamedDefinitions[String(record.id)] = resolved
    record.name = resolved
    return copy
  })

  // Library union-on-id (same id keeps target, no hash dedup).
  const targetLibraryFull = (target.library ?? {}) as unknown as Record<string, unknown>
  const existingAssets = [...((targetLibraryFull.assets as EmbeddedAssetJSON[] | undefined) ?? [])]
  const existingMaterials = [
    ...((targetLibraryFull.materials as EmbeddedMaterialJSON[] | undefined) ?? []),
  ]
  const existingShaders = [
    ...((targetLibraryFull.shaders as EmbeddedShaderJSON[] | undefined) ?? []),
  ]
  const existingDataSources = [
    ...((targetLibraryFull.data_sources as EmbeddedDataSourceAnyJSON[] | undefined) ?? []),
  ]
  const assetsUnion = unionById(existingAssets, library.assets as EmbeddedAssetJSON[] | undefined)
  const materialsUnion = unionById(
    existingMaterials,
    library.materials as EmbeddedMaterialJSON[] | undefined,
  )
  const shadersUnion = unionById(
    existingShaders,
    library.shaders as EmbeddedShaderJSON[] | undefined,
  )
  const dataSourcesUnion = unionById(
    existingDataSources,
    library.data_sources as EmbeddedDataSourceAnyJSON[] | undefined,
  )

  // Incoming definition names for assets/materials/shaders/data sources
  // also suffix (first-keeps, ordered numeric).
  const assetNames = existingAssets.map((a) => a.name)
  const materialNames = existingMaterials.map((m) => m.name)
  const shaderNames = existingShaders.map((s) => s.name)
  const dataSourceNames = existingDataSources.map((d) => d.name)
  const resolvedLibraryNames = {
    assets: resolveDefinitionNames(
      assetNames,
      (assetsUnion.merged.slice(existingAssets.length) as EmbeddedAssetJSON[]).map((a) => a.name),
    ),
    materials: resolveDefinitionNames(
      materialNames,
      (materialsUnion.merged.slice(existingMaterials.length) as EmbeddedMaterialJSON[]).map(
        (m) => m.name,
      ),
    ),
    shaders: resolveDefinitionNames(
      shaderNames,
      (shadersUnion.merged.slice(existingShaders.length) as EmbeddedShaderJSON[]).map(
        (s) => s.name,
      ),
    ),
    dataSources: resolveDefinitionNames(
      dataSourceNames,
      (
        dataSourcesUnion.merged.slice(existingDataSources.length) as EmbeddedDataSourceAnyJSON[]
      ).map((d) => d.name),
    ),
  }
  ;(assetsUnion.merged.slice(existingAssets.length) as EmbeddedAssetJSON[]).forEach(
    (entry, index) => {
      const resolved = resolvedLibraryNames.assets[index] ?? entry.name
      if (resolved !== entry.name) renamedDefinitions[entry.id] = resolved
      ;(entry as unknown as Record<string, unknown>).name = resolved
    },
  )
  ;(materialsUnion.merged.slice(existingMaterials.length) as EmbeddedMaterialJSON[]).forEach(
    (entry, index) => {
      const resolved = resolvedLibraryNames.materials[index] ?? entry.name
      if (resolved !== entry.name) renamedDefinitions[entry.id] = resolved
      ;(entry as unknown as Record<string, unknown>).name = resolved
    },
  )
  ;(shadersUnion.merged.slice(existingShaders.length) as EmbeddedShaderJSON[]).forEach(
    (entry, index) => {
      const resolved = resolvedLibraryNames.shaders[index] ?? entry.name
      if (resolved !== entry.name) renamedDefinitions[entry.id] = resolved
      ;(entry as unknown as Record<string, unknown>).name = resolved
    },
  )
  ;(
    dataSourcesUnion.merged.slice(existingDataSources.length) as EmbeddedDataSourceAnyJSON[]
  ).forEach((entry, index) => {
    const resolved = resolvedLibraryNames.dataSources[index] ?? entry.name
    if (resolved !== entry.name) renamedDefinitions[entry.id] = resolved
    ;(entry as unknown as Record<string, unknown>).name = resolved
  })

  const nextSlides = [...(target.slides as SlideJSON[])]
  nextSlides.splice(targetIndex, 0, ...remappedSlides)

  const nextClips = [...targetClips, ...remappedTopClips]
  const nextCollections = [...targetCollections, ...remappedTopCollections]
  const nextLibraryScripts = [...(targetLibrary.scriptFunctions ?? []), ...remappedScripts]
  const nextLibraryClips = [...(targetLibrary.clips ?? []), ...remappedLibClips]
  const nextLibraryCollections = [
    ...(targetLibrary.clipCollections ?? []),
    ...remappedLibCollections,
  ]

  // IK chains + constraints follow the duplicate pattern: fresh chain /
  // constraint ids, slide keys follow the slide map, bone/target/ghost node
  // ids follow the node map. Absent incoming managers merge as no-ops.
  const mergedIk = mergeIkChains(
    (target as { ikChains?: IKManagerJSON }).ikChains,
    library.ikChains ?? null,
    tables,
  )
  const mergedConstraints = mergeConstraints(
    (target as { constraints?: ConstraintManagerJSON }).constraints,
    library.constraints ?? null,
    tables,
  )

  const lesson = {
    ...target,
    slides: nextSlides,
    ...(nextClips.length > 0 ||
    nextCollections.length > 0 ||
    target.clips !== undefined ||
    target.clipCollections !== undefined
      ? {
          clips: nextClips.length > 0 ? nextClips : target.clips,
          clipCollections: nextCollections.length > 0 ? nextCollections : target.clipCollections,
        }
      : {}),
    ...(mergedIk ? { ikChains: mergedIk } : {}),
    ...(mergedConstraints ? { constraints: mergedConstraints } : {}),
    library: {
      ...(target.library as Record<string, unknown> | undefined),
      ...(assetsUnion.merged.length > 0 ? { assets: assetsUnion.merged } : {}),
      ...(materialsUnion.merged.length > 0 ? { materials: materialsUnion.merged } : {}),
      ...(shadersUnion.merged.length > 0 ? { shaders: shadersUnion.merged } : {}),
      ...(dataSourcesUnion.merged.length > 0 ? { data_sources: dataSourcesUnion.merged } : {}),
      ...(nextLibraryClips.length > 0 ? { clips: nextLibraryClips } : {}),
      ...(nextLibraryCollections.length > 0 ? { clipCollections: nextLibraryCollections } : {}),
      ...(nextLibraryScripts.length > 0 ? { scriptFunctions: nextLibraryScripts } : {}),
    },
  } as unknown as LessonJSON

  return {
    lesson,
    insertedSlideIds: remappedSlides.map((slide) => slide.id),
    added: {
      assets: assetsUnion.addedIds,
      materials: materialsUnion.addedIds,
      shaders: shadersUnion.addedIds,
      dataSources: dataSourcesUnion.addedIds,
      clips: [...remappedTopClips, ...remappedLibClips].map((clip) => clip.id),
      clipCollections: [...remappedTopCollections, ...remappedLibCollections].map((col) => col.id),
      scriptFunctions: remappedScripts.map((entry) => entry.id),
    },
    renamedSlides,
    renamedDefinitions,
  }
}

export interface AssemblyParts {
  readonly intro: LessonJSON
  readonly middle: LessonJSON
  readonly outro: LessonJSON
}

/**
 * Duplicate-middle base for the assembly target. Fresh id, uniquified
 * assembled name, fresh timestamps; prompter settings and clip/script
 * libraries preserved by the duplicate. Sources never mutated.
 */
export function duplicateToAssemblyTarget(
  middle: LessonJSON,
  existingNames: readonly string[],
  duplicate: (original: LessonJSON, existing: readonly string[]) => LessonJSON,
  assembledBaseName?: string,
): LessonJSON {
  const base = duplicate(openNamedReadOnly(middle), existingNames)
  const clone = cloneJson(base)
  const names = [...existingNames, clone.project.name]
  const wantedBase = (assembledBaseName ?? middle.project.name).trim() || middle.project.name
  const assembled = getUniqueAssembledName(
    wantedBase,
    names.filter((n) => n !== clone.project.name),
  )
  const now = new Date().toISOString()
  return {
    ...clone,
    project: {
      ...clone.project,
      id: clone.project.id,
      name: assembled,
      createdAt: now,
      modifiedAt: now,
    },
  } as LessonJSON
}

/**
 * Full three-part assembly ordered intro -> middle -> outro from a
 * duplicate-middle base. Pure: no input mutated. Merges intro slides at the
 * front and outro slides at the end with the same suffix/union/remap rules.
 */
export function assembleLesson(
  parts: AssemblyParts,
  existingNames: readonly string[],
  duplicate: (original: LessonJSON, existing: readonly string[]) => LessonJSON,
): LessonJSON {
  const introSlides = [...openNamedReadOnly(parts.intro).slides]
  const outroSlides = [...openNamedReadOnly(parts.outro).slides]
  const introLibrary = openNamedReadOnly(parts.intro).library as unknown as
    IncomingLibraryJSON | undefined
  const outroLibrary = openNamedReadOnly(parts.outro).library as unknown as
    IncomingLibraryJSON | undefined
  let assembled = duplicateToAssemblyTarget(parts.middle, existingNames, duplicate)
  const splitSource = (
    full: LessonJSON,
    lib: IncomingLibraryJSON | undefined,
  ): Pick<MergeSlidesInput, 'slides' | 'clips' | 'clipCollections' | 'library'> => ({
    slides: [...full.slides],
    clips: full.clips ? [...full.clips] : undefined,
    clipCollections: full.clipCollections ? [...full.clipCollections] : undefined,
    library: {
      assets: lib?.assets,
      materials: lib?.materials,
      shaders: lib?.shaders,
      data_sources: lib?.data_sources,
      clips: lib?.clips,
      clipCollections: lib?.clipCollections,
      scriptFunctions: (lib as { scriptFunctions?: ScriptFunctionJSON[] } | undefined)
        ?.scriptFunctions,
      ikChains: (full as { ikChains?: IKManagerJSON }).ikChains ?? null,
      constraints: (full as { constraints?: ConstraintManagerJSON }).constraints ?? null,
    },
  })
  if (introSlides.length > 0) {
    const introFull = openNamedReadOnly(parts.intro)
    const source = splitSource(introFull, introLibrary)
    const merged = mergeSlidesIntoLesson({
      target: assembled,
      slides: source.slides,
      ...(source.clips ? { clips: source.clips } : {}),
      ...(source.clipCollections ? { clipCollections: source.clipCollections } : {}),
      library: source.library,
      targetIndex: 0,
    })
    assembled = merged.lesson
  }
  if (outroSlides.length > 0) {
    const outroFull = openNamedReadOnly(parts.outro)
    const source = splitSource(outroFull, outroLibrary)
    const merged = mergeSlidesIntoLesson({
      target: assembled,
      slides: source.slides,
      ...(source.clips ? { clips: source.clips } : {}),
      ...(source.clipCollections ? { clipCollections: source.clipCollections } : {}),
      library: source.library,
      targetIndex: assembled.slides.length,
    })
    assembled = merged.lesson
  }
  return assembled
}

export interface StageStatuses {
  readonly narration?: string | null
  readonly calibration?: string | null
  readonly board?: string | null
}

/**
 * Merge gate: assembly runs only on fully accepted Stage C, D, and E
 * versions. Throws a fixable message naming the stale stage.
 */
export function requireAcceptedStages(statuses: StageStatuses): void {
  const pending: string[] = []
  if (statuses.narration !== 'accepted') pending.push('narration (Stage C Prompter fill)')
  if (statuses.calibration !== 'accepted') pending.push('calibration (Stage D)')
  if (statuses.board !== 'accepted') pending.push('board scripts (Stage E)')
  if (pending.length > 0) {
    throw new Error(
      `${ASSEMBLY_STALE_MESSAGE}: still waiting on ${pending.join(', ')} — accept each stage before the merge`,
    )
  }
}

/**
 * Canonical merge proposal: intro at 0, outro at end, one Transaction.
 * Runs only on fully accepted Stage C, D, and E versions — pass their
 * statuses and the gate throws a fixable message naming the stale stage.
 */
export function buildMergeProposalCommands(
  introLesson: LessonJSON,
  outroLesson: LessonJSON,
  middleSlideCount: number,
  statuses: StageStatuses,
): ({ type: string } & Record<string, unknown>)[] {
  requireAcceptedStages(statuses)
  const intro = openNamedReadOnly(introLesson)
  const outro = openNamedReadOnly(outroLesson)
  const packSource = (full: LessonJSON): ({ type: string } & Record<string, unknown>) | null => {
    if (full.slides.length === 0) return null
    const lib = full.library as unknown as IncomingLibraryJSON | undefined
    return {
      type: 'AiImportSlides',
      slideIds: full.slides.map((slide) => slide.id),
      slides: cloneJson([...full.slides]),
      ...(full.clips && full.clips.length > 0 ? { clips: cloneJson([...full.clips]) } : {}),
      ...(full.clipCollections && full.clipCollections.length > 0
        ? { clipCollections: cloneJson([...full.clipCollections]) }
        : {}),
      library: {
        ...(lib?.assets ? { assets: cloneJson([...lib.assets]) } : {}),
        ...(lib?.materials ? { materials: cloneJson([...lib.materials]) } : {}),
        ...(lib?.shaders ? { shaders: cloneJson([...lib.shaders]) } : {}),
        ...(lib?.data_sources ? { data_sources: cloneJson([...lib.data_sources]) } : {}),
        ...(lib?.clips ? { clips: cloneJson([...lib.clips]) } : {}),
        ...(lib?.clipCollections ? { clipCollections: cloneJson([...lib.clipCollections]) } : {}),
        ...((lib as { scriptFunctions?: ScriptFunctionJSON[] } | undefined)?.scriptFunctions
          ? {
              scriptFunctions: cloneJson([
                ...((lib as { scriptFunctions?: ScriptFunctionJSON[] }).scriptFunctions ?? []),
              ]),
            }
          : {}),
        ...((full as { ikChains?: IKManagerJSON }).ikChains
          ? { ikChains: cloneJson((full as { ikChains?: IKManagerJSON }).ikChains) }
          : {}),
        ...((full as { constraints?: ConstraintManagerJSON }).constraints
          ? {
              constraints: cloneJson((full as { constraints?: ConstraintManagerJSON }).constraints),
            }
          : {}),
      },
    }
  }
  const commands: ({ type: string } & Record<string, unknown>)[] = []
  const introCommand = packSource(intro)
  if (introCommand) commands.push({ ...introCommand, targetIndex: 0 })
  const outroCommand = packSource(outro)
  if (outroCommand) {
    commands.push({
      ...outroCommand,
      targetIndex: middleSlideCount + intro.slides.length,
    })
  }
  if (commands.length === 0) {
    throw new Error('assembly merge needs at least one intro or outro slide')
  }
  return commands
}
