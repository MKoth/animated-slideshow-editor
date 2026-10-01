import type { EnginePublic } from './internal'
import type { DispatchCommand } from './commands/dispatcher'
import type { UndoStack } from './commands/undoStack'
import { PasteKeyframesCommand } from './commands/pasteKeyframesCommand'
import { walkPreOrder } from './sceneNode'
import type { KeyframeTarget } from './keyframeTarget'
import type { InterpolationType, Keyframe, KeyframeTangent } from './keyframe'
import { ZERO_TANGENT } from './keyframe'
import { CLIP_CHANNELS } from './clipDefinition'
import type { ClipChannel } from './clipDefinition'
import { resolveClipShapeByNameAndPath } from './shape'
import { MIN_VISUAL_DURATION, MIN_CLIP_SPEED } from './animationManagerModel'

export type FreezePoseSource = 'first' | 'last'

export interface FreezePlan {
  readonly placementId: string
  readonly source: FreezePoseSource
  /** Optional explicit target time; defaults to placement end. */
  readonly atTime?: number
}

export interface FreezePreviewEntry {
  readonly nodeId: string
  readonly nodeName: string
  readonly semanticName: string
  readonly clipId: string
  readonly clipName: string
  readonly writeCount: number
}

export interface FreezePreview {
  readonly entries: readonly FreezePreviewEntry[]
  readonly totalWrites: number
  readonly targetTime: number
  readonly placementId: string
  readonly source: FreezePoseSource
  readonly warnings: readonly string[]
}

export type FreezeResult =
  | {
      readonly ok: true
      readonly writtenCount: number
      readonly targetTime: number
      readonly warnings: readonly string[]
    }
  | { readonly ok: false; readonly error: string }

interface PendingWrite {
  target: KeyframeTarget
  nodeName: string
  time: number
  value: unknown
  interpolation: InterpolationType
  tangentIn: KeyframeTangent
  tangentOut: KeyframeTangent
}

function targetKey(target: KeyframeTarget): string {
  if (target.kind === 'node' && 'property' in target)
    return `node:${target.nodeId}:${target.property}`
  if (target.kind === 'node' && 'parameter' in target)
    return `node-param:${target.nodeId}:${target.parameter}`
  if (target.kind === 'visible') return `visible:${target.nodeId}`
  if (target.kind === 'zIndex') return `zIndex:${target.nodeId}`
  if (target.kind === 'morph') return `morph:${target.nodeId}`
  if (target.kind === 'symmetry') return `symmetry:${target.nodeId}`
  if (target.kind === 'circle') return `circle:${target.nodeId}:${target.property}`
  if (target.kind === 'shadow') return `shadow:${target.nodeId}:${target.property}`
  return `unknown:${(target as { nodeId?: string }).nodeId ?? ''}:${JSON.stringify(target)}`
}

function pickEdge(keyframes: readonly Keyframe[], source: FreezePoseSource): Keyframe | null {
  if (keyframes.length === 0) return null
  let best = keyframes[0]!
  for (const kf of keyframes) {
    if (source === 'first' ? kf.time < best.time : kf.time > best.time) best = kf
  }
  return best
}

function resolveMorphForNode(engine: EnginePublic, nodeId: string, raw: unknown): unknown {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'object' || raw === null) return raw
  const r = raw as Record<string, unknown>
  if (!('coefficient' in r)) return raw
  if ('fromShapeId' in r || 'toShapeId' in r) return raw
  const fromName = (r.fromShapeName as string | null) ?? null
  const toName = (r.toShapeName as string | null) ?? null
  const parsePath = (v: unknown): readonly string[] | null | undefined => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return [...v]
    return undefined
  }
  const fromPath = parsePath(r.fromCategoryPath)
  const toPath = parsePath(r.toCategoryPath)
  let fromId: string | null = null
  let toId: string | null = null
  try {
    const shapes = engine.getShapes(nodeId)
    let categories: readonly import('./shapeCategory').ShapeCategory[] = []
    try {
      categories = engine.getShapeCategories(nodeId)
    } catch {
      categories = []
    }
    if (fromName) {
      const s = resolveClipShapeByNameAndPath(shapes, categories, fromName, fromPath)
      if (s) fromId = s.id
    }
    if (toName) {
      const s = resolveClipShapeByNameAndPath(shapes, categories, toName, toPath)
      if (s) toId = s.id
    }
  } catch {
    // no shapes — keep nulls
  }
  return { fromShapeId: fromId, toShapeId: toId, coefficient: r.coefficient }
}

export function placementEndTime(
  engine: EnginePublic,
  placementId: string,
): { end: number; visual: number; start: number } {
  const placement = engine.getCollectionPlacement(placementId)
  const members = engine.getPlacementMembers(placementId)
  let maxVisual = MIN_VISUAL_DURATION
  let hasMember = false
  for (const m of members) {
    hasMember = true
    let duration = 0
    try {
      duration = engine.getClip(m.instance.clipId).duration
    } catch {
      continue
    }
    const speed = m.instance.speed < MIN_CLIP_SPEED ? MIN_CLIP_SPEED : m.instance.speed
    const visual = Math.max(duration / speed, MIN_VISUAL_DURATION)
    if (visual > maxVisual) maxVisual = visual
  }
  if (!hasMember) maxVisual = MIN_VISUAL_DURATION
  return { start: placement.startTime, visual: maxVisual, end: placement.startTime + maxVisual }
}

function collectFreezeWrites(
  engine: EnginePublic,
  plan: FreezePlan,
):
  | {
      writes: PendingWrite[]
      perNode: Map<string, FreezePreviewEntry & { writeCount: number }>
      targetTime: number
      warnings: string[]
    }
  | { error: string } {
  let placement
  try {
    placement = engine.getCollectionPlacement(plan.placementId)
  } catch {
    return { error: 'Collection placement not found — reopen the timeline.' }
  }
  let collection
  try {
    collection = engine.getClipCollection(placement.collectionId)
  } catch {
    return { error: 'Collection not found for this placement.' }
  }
  const active = (() => {
    try {
      return engine.getActiveSlide()
    } catch {
      return null
    }
  })()
  const { end, start } = placementEndTime(engine, plan.placementId)
  let target = plan.atTime ?? end
  if (!Number.isFinite(target) || target < 0) return { error: 'Target time must be ≥ 0.' }
  if (active) target = Math.min(target, active.duration)
  target = Math.round(target * 1000) / 1000
  // Hold prefix: a lone frozen keyframe drives its whole track (the evaluator
  // returns the first/last value outside the key range), so on a track with no
  // keys it would hijack the pose BEFORE the block too — surviving placement
  // deletion and looking like irreparably broken posing. Anchor such tracks
  // with a hold key of the static base value at block start.
  let prefixTime = Math.max(0, start)
  if (active) prefixTime = Math.min(prefixTime, active.duration)
  prefixTime = Math.round(prefixTime * 1000) / 1000

  let parent = null as null | ReturnType<EnginePublic['getNode']>
  try {
    parent = engine.getNode(placement.parentNodeId)
  } catch {
    return { error: 'Parent node for this placement no longer exists.' }
  }
  const bySemantic = new Map<string, ReturnType<EnginePublic['getNode']>[]>()
  for (const node of walkPreOrder(parent)) {
    const sem = node.semanticName
    if (!sem || sem.trim() === '') continue
    const key = sem.trim()
    const arr = bySemantic.get(key)
    if (arr) arr.push(node)
    else bySemantic.set(key, [node])
  }

  const bindings = collection.getBindingsObject()
  const writes: PendingWrite[] = []
  const perNode = new Map<string, FreezePreviewEntry & { writeCount: number }>()
  const warnings: string[] = []
  const pushEdge = (
    node: ReturnType<EnginePublic['getNode']>,
    sem: string,
    clipId: string,
    clipName: string,
    clipDuration: number,
    targetDef: KeyframeTarget,
    edge: Keyframe | null,
  ) => {
    if (!edge) return
    let value: unknown = edge.value
    if (targetDef.kind === 'morph') value = resolveMorphForNode(engine, node.id, edge.value)
    writes.push({
      target: targetDef,
      nodeName: node.name,
      time: target,
      value,
      interpolation: edge.interpolation,
      tangentIn: { time: edge.tangentIn.time * clipDuration, value: edge.tangentIn.value },
      tangentOut: { time: edge.tangentOut.time * clipDuration, value: edge.tangentOut.value },
    })
    const entry = perNode.get(node.id)
    if (entry) entry.writeCount += 1
    else
      perNode.set(node.id, {
        nodeId: node.id,
        nodeName: node.name,
        semanticName: sem,
        clipId,
        clipName,
        writeCount: 1,
      })
  }

  const baseValueFor = (node: ReturnType<EnginePublic['getNode']>, prop: ClipChannel): number => {
    if (prop === 'positionX') return node.transform.x
    if (prop === 'positionY') return node.transform.y
    if (prop === 'rotation') return node.transform.rotation
    if (prop === 'scaleX') return node.transform.scaleX
    if (prop === 'scaleY') return node.transform.scaleY
    return node.opacity
  }

  const hasEnabledKeys = (nodeId: string, prop: ClipChannel): boolean => {
    let kfs: readonly Keyframe[] = []
    try {
      kfs = engine.getKeyframes(nodeId, prop)
    } catch {
      return false
    }
    for (const kf of kfs) {
      if (!(kf as unknown as { disabled?: boolean }).disabled) return true
    }
    return false
  }

  let prefixCount = 0
  const pushPrefix = (
    node: ReturnType<EnginePublic['getNode']>,
    sem: string,
    clipId: string,
    clipName: string,
    prop: ClipChannel,
  ) => {
    if (!(prefixTime < target - 1e-9)) return
    if (hasEnabledKeys(node.id, prop)) return
    writes.push({
      target: { kind: 'node', nodeId: node.id, property: prop },
      nodeName: node.name,
      time: prefixTime,
      value: baseValueFor(node, prop),
      interpolation: 'hold',
      tangentIn: { ...ZERO_TANGENT },
      tangentOut: { ...ZERO_TANGENT },
    })
    prefixCount += 1
    const entry = perNode.get(node.id)
    if (entry) entry.writeCount += 1
    else
      perNode.set(node.id, {
        nodeId: node.id,
        nodeName: node.name,
        semanticName: sem,
        clipId,
        clipName,
        writeCount: 1,
      })
  }

  for (const [sem, clipId] of Object.entries(bindings)) {
    const targets = bySemantic.get(sem.trim())
    if (!targets || targets.length === 0) {
      warnings.push(`No matching node for "${sem}" — skipped.`)
      continue
    }
    let clip
    try {
      clip = engine.getClip(clipId)
    } catch {
      return { error: `Clip bound to "${sem}" no longer exists.` }
    }
    for (const node of targets) {
      for (const prop of CLIP_CHANNELS) {
        const edge = pickEdge(clip.getChannelKeyframes(prop), plan.source)
        if (!edge) continue
        pushEdge(
          node,
          sem,
          clip.id,
          clip.name,
          clip.duration,
          { kind: 'node', nodeId: node.id, property: prop },
          edge,
        )
        pushPrefix(node, sem, clip.id, clip.name, prop)
      }
      for (const param of clip.materialChannelParameterKeys) {
        pushEdge(
          node,
          sem,
          clip.id,
          clip.name,
          clip.duration,
          { kind: 'node', nodeId: node.id, parameter: param },
          pickEdge(clip.getMaterialChannelKeyframes(param), plan.source),
        )
      }
      pushEdge(
        node,
        sem,
        clip.id,
        clip.name,
        clip.duration,
        { kind: 'visible', nodeId: node.id },
        pickEdge(clip.getVisibleKeyframes(), plan.source),
      )
      pushEdge(
        node,
        sem,
        clip.id,
        clip.name,
        clip.duration,
        { kind: 'zIndex', nodeId: node.id },
        pickEdge(clip.getZIndexKeyframes(), plan.source),
      )
      pushEdge(
        node,
        sem,
        clip.id,
        clip.name,
        clip.duration,
        { kind: 'morph', nodeId: node.id },
        pickEdge(clip.getMorphKeyframes(), plan.source),
      )
      pushEdge(
        node,
        sem,
        clip.id,
        clip.name,
        clip.duration,
        { kind: 'symmetry', nodeId: node.id },
        pickEdge(clip.getSymmetryKeyframes(), plan.source),
      )
      for (const prop of clip.circleTrackKeys) {
        pushEdge(
          node,
          sem,
          clip.id,
          clip.name,
          clip.duration,
          { kind: 'circle', nodeId: node.id, property: prop },
          pickEdge(clip.getCircleKeyframes(prop), plan.source),
        )
      }
      for (const prop of clip.shadowChannelKeys) {
        pushEdge(
          node,
          sem,
          clip.id,
          clip.name,
          clip.duration,
          { kind: 'shadow', nodeId: node.id, property: prop },
          pickEdge(clip.getShadowChannelKeyframes(prop), plan.source),
        )
      }
    }
  }
  if (writes.length === 0)
    return { error: 'Nothing to freeze: no clip keyframes found for first/last pose.' }
  // Dedupe same target (two semantics hitting same node+track keeps last)
  const kept: PendingWrite[] = []
  const indexBySlot = new Map<string, number>()
  for (const w of writes) {
    const slot = `${targetKey(w.target)}@${w.time}`
    const prev = indexBySlot.get(slot)
    if (prev === undefined) {
      indexBySlot.set(slot, kept.length)
      kept.push(w)
    } else {
      kept[prev] = w
    }
  }
  // fix perNode counts after dedupe
  const counts = new Map<string, number>()
  for (const w of kept) {
    const id = (w.target as { nodeId?: string }).nodeId ?? ''
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const [id, entry] of perNode) {
    entry.writeCount = counts.get(id) ?? 0
    if (entry.writeCount === 0) perNode.delete(id)
  }
  if (prefixCount > 0) {
    warnings.push(
      `${prefixCount} hold key(s) at block start preserve the pre-block pose on tracks with no keys — a lone frozen key would otherwise drive the whole slide.`,
    )
  }
  return { writes: kept, perNode, targetTime: target, warnings }
}

export function previewCollectionFreeze(engine: EnginePublic, plan: FreezePlan): FreezePreview {
  const collected = collectFreezeWrites(engine, plan)
  if ('error' in collected) {
    return {
      entries: [],
      totalWrites: 0,
      targetTime: 0,
      placementId: plan.placementId,
      source: plan.source,
      warnings: [collected.error],
    }
  }
  const entries = [...collected.perNode.values()].sort((a, b) =>
    a.nodeName.localeCompare(b.nodeName),
  )
  return {
    entries,
    totalWrites: collected.writes.length,
    targetTime: collected.targetTime,
    placementId: plan.placementId,
    source: plan.source,
    warnings: [...collected.warnings],
  }
}

function mergeRecords(undoStack: UndoStack, records: number): void {
  if (records <= 1) return
  try {
    undoStack.mergeLastAsTransaction(records)
  } catch {
    /* best-effort */
  }
}

export function executeCollectionFreeze(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  plan: FreezePlan,
): FreezeResult {
  const collected = collectFreezeWrites(engine, plan)
  if ('error' in collected) return { ok: false, error: collected.error }
  const groups = new Map<string, { target: KeyframeTarget; items: PendingWrite[] }>()
  for (const w of collected.writes) {
    const key = targetKey(w.target)
    const g = groups.get(key)
    if (g) g.items.push(w)
    else groups.set(key, { target: w.target, items: [w] })
  }
  const cmds = [...groups.values()].map(
    (g) =>
      new PasteKeyframesCommand({
        target: g.target,
        atTime: 0,
        payload: {
          keyframes: [...g.items]
            .sort((a, b) => a.time - b.time)
            .map((w) => ({
              time: w.time,
              value: w.value,
              interpolation: w.interpolation,
              tangentIn: { ...w.tangentIn },
              tangentOut: { ...w.tangentOut },
            })),
        },
      }),
  )
  let records = 0
  for (const cmd of cmds) {
    const res = dispatch(cmd as never)
    if (!res.ok) {
      mergeRecords(undoStack, records)
      return { ok: false, error: res.error.message }
    }
    records += 1
  }
  mergeRecords(undoStack, records)
  const warnings = [...collected.warnings]
  warnings.push(
    'Collection lane left in place — frozen keyframes hold the pose after the block ends.',
  )
  return {
    ok: true,
    writtenCount: collected.writes.length,
    targetTime: collected.targetTime,
    warnings,
  }
}
