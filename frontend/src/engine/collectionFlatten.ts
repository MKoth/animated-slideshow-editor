import type { EnginePublic } from './internal'
import type { DispatchCommand } from './commands/dispatcher'
import type { UndoStack } from './commands/undoStack'
import { PasteKeyframesCommand } from './commands/pasteKeyframesCommand'
import { walkPreOrder } from './sceneNode'
import type { KeyframeTarget } from './keyframeTarget'
import type { Keyframe, InterpolationType, KeyframeTangent } from './keyframe'
import { SEGMENT_EPS } from './timeSegmentExtraction'
import { CLIP_CHANNELS } from './clipDefinition'
import { resolveClipShapeByNameAndPath } from './shape'

export interface FlattenPlan {
  readonly collectionId: string
  readonly from: number
  readonly to: number
}

export interface FlattenPreviewEntry {
  readonly nodeId: string
  readonly nodeName: string
  readonly semanticName: string
  readonly clipId: string
  readonly clipName: string
  readonly writeCount: number
}

export interface FlattenConflict {
  readonly target: KeyframeTarget
  readonly nodeName: string
  readonly label: string
  readonly existingCount: number
}

export interface FlattenPreview {
  readonly entries: readonly FlattenPreviewEntry[]
  readonly totalWrites: number
  readonly truncatedCount: number
  readonly conflicts: readonly FlattenConflict[]
  readonly warnings: readonly string[]
}

export type FlattenResult =
  | {
      readonly ok: true
      readonly writtenCount: number
      readonly truncatedCount: number
      readonly warnings: readonly string[]
    }
  | { readonly ok: false; readonly error: string; readonly conflicts?: readonly FlattenConflict[] }

interface PendingWrite {
  target: KeyframeTarget
  nodeName: string
  time: number
  value: unknown
  interpolation: InterpolationType
  tangentIn: KeyframeTangent
  tangentOut: KeyframeTangent
}

function describeTarget(target: KeyframeTarget): string {
  if (target.kind === 'node' && 'property' in target) return target.property
  if (target.kind === 'node' && 'parameter' in target) return `material ${target.parameter}`
  if (target.kind === 'visible') return 'visible'
  if (target.kind === 'zIndex') return 'zIndex'
  if (target.kind === 'morph') return 'morphCoefficient'
  if (target.kind === 'symmetry') return 'symmetry'
  if (target.kind === 'circle') return `circle ${target.property}`
  if (target.kind === 'shadow') return `shadow ${target.property}`
  return target.kind
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

function existingInRange(
  engine: EnginePublic,
  target: KeyframeTarget,
  from: number,
  to: number,
): Keyframe[] {
  let kfs: readonly Keyframe[] = []
  try {
    if (target.kind === 'node' && 'property' in target) {
      kfs = engine.getKeyframes(target.nodeId, target.property)
    } else if (target.kind === 'node' && 'parameter' in target) {
      kfs = engine.getMaterialKeyframes(target.nodeId, target.parameter)
    } else if (target.kind === 'visible') {
      kfs = engine.getVisibleKeyframes(target.nodeId)
    } else if (target.kind === 'zIndex') {
      kfs = engine.getZIndexKeyframes(target.nodeId)
    } else if (target.kind === 'morph') {
      kfs = engine.getMorphKeyframes(target.nodeId)
    } else if (target.kind === 'symmetry') {
      kfs = engine.getSymmetryKeyframes(target.nodeId)
    } else if (target.kind === 'circle') {
      kfs = engine.getCircleKeyframes(target.nodeId, target.property)
    } else if (target.kind === 'shadow') {
      kfs = engine.getShadowKeyframes(target.nodeId, target.property)
    } else {
      return []
    }
  } catch {
    return []
  }
  return kfs.filter((k) => k.time >= from - SEGMENT_EPS && k.time <= to + SEGMENT_EPS)
}

function resolveMorphForNode(engine: EnginePublic, nodeId: string, raw: unknown): unknown {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'object' || raw === null) return raw
  const r = raw as Record<string, unknown>
  if (!('coefficient' in r)) return raw
  const coefficient = r.coefficient
  // Already id-based orphan value?
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
  return { fromShapeId: fromId, toShapeId: toId, coefficient }
}

interface Collected {
  writes: PendingWrite[]
  perNode: Map<
    string,
    {
      nodeId: string
      nodeName: string
      semanticName: string
      clipId: string
      clipName: string
      writeCount: number
    }
  >
  truncatedCount: number
  warnings: string[]
}

function collectWrites(engine: EnginePublic, plan: FlattenPlan): Collected | { error: string } {
  const { from, to } = plan
  if (!Number.isFinite(from) || !Number.isFinite(to))
    return { error: 'Enter numeric From and To times.' }
  if (from < 0) return { error: 'From must be ≥ 0.' }
  if (!(to - from > SEGMENT_EPS)) return { error: 'Require From < To with a non-zero range.' }
  let collection
  try {
    collection = engine.getClipCollection(plan.collectionId)
  } catch {
    return { error: 'Collection not found — reopen the dialog.' }
  }
  const active = (() => {
    try {
      return engine.getActiveSlide()
    } catch {
      return null
    }
  })()
  if (active && to > active.duration + SEGMENT_EPS) {
    return { error: `To must be ≤ slide duration (${active.duration.toFixed(2)}s).` }
  }
  const bindings = collection.getBindingsObject()
  const sems = Object.keys(bindings)
  if (sems.length === 0)
    return { error: `Collection "${collection.name}" has no bindings to flatten.` }

  // Resolve root for broadcast: source parent subtree, fallback to active slide root.
  let root = null as null | ReturnType<EnginePublic['getNode']>
  if (collection.sourceNodeId) {
    try {
      root = engine.getNode(collection.sourceNodeId)
    } catch {
      root = null
    }
  }
  if (!root && active) {
    try {
      root = active.scene.root as unknown as ReturnType<EnginePublic['getNode']>
    } catch {
      root = null
    }
  }
  if (!root) return { error: 'Cannot resolve the collection source hierarchy — reopen the dialog.' }

  const bySemantic = new Map<string, ReturnType<EnginePublic['getNode']>[]>()
  for (const node of walkPreOrder(root)) {
    const sem = node.semanticName
    if (!sem || sem.trim() === '') continue
    const key = sem.trim()
    const arr = bySemantic.get(key)
    if (arr) arr.push(node)
    else bySemantic.set(key, [node])
  }

  const writes: PendingWrite[] = []
  const perNode = new Map<
    string,
    {
      nodeId: string
      nodeName: string
      semanticName: string
      clipId: string
      clipName: string
      writeCount: number
    }
  >()
  let truncatedCount = 0
  const warnings: string[] = []

  for (const [sem, clipId] of Object.entries(bindings)) {
    const targets = bySemantic.get(sem.trim())
    if (!targets || targets.length === 0) {
      warnings.push(`No matching node for "${sem}" under the collection source — skipped.`)
      continue
    }
    let clip
    try {
      clip = engine.getClip(clipId)
    } catch {
      return { error: `Clip bound to "${sem}" no longer exists — reopen the dialog.` }
    }
    const duration = clip.duration
    if (!Number.isFinite(duration) || duration < 0) {
      return { error: `Clip "${clip.name}" has an invalid duration.` }
    }
    const pushForNode = (
      node: ReturnType<EnginePublic['getNode']>,
      target: KeyframeTarget,
      kf: {
        time: number
        value: unknown
        interpolation: InterpolationType
        tangentIn: KeyframeTangent
        tangentOut: KeyframeTangent
      },
    ) => {
      const timeline = from + kf.time * duration
      if (timeline > to + SEGMENT_EPS) {
        truncatedCount += 1
        return
      }
      const clamped = Math.min(Math.max(timeline, from), to)
      let value: unknown = kf.value
      if (target.kind === 'morph') value = resolveMorphForNode(engine, node.id, kf.value)
      writes.push({
        target,
        nodeName: node.name,
        time: clamped,
        value,
        interpolation: kf.interpolation,
        tangentIn: { time: kf.tangentIn.time * duration, value: kf.tangentIn.value },
        tangentOut: { time: kf.tangentOut.time * duration, value: kf.tangentOut.value },
      })
      const entry = perNode.get(node.id)
      if (entry) entry.writeCount += 1
      else
        perNode.set(node.id, {
          nodeId: node.id,
          nodeName: node.name,
          semanticName: sem,
          clipId: clip.id,
          clipName: clip.name,
          writeCount: 1,
        })
    }

    for (const node of targets) {
      for (const prop of CLIP_CHANNELS) {
        const kfs = clip.getChannelKeyframes(prop)
        for (const kf of kfs) {
          pushForNode(node, { kind: 'node', nodeId: node.id, property: prop }, kf)
        }
      }
      for (const param of clip.materialChannelParameterKeys) {
        const kfs = clip.getMaterialChannelKeyframes(param)
        for (const kf of kfs) {
          pushForNode(node, { kind: 'node', nodeId: node.id, parameter: param }, kf)
        }
      }
      for (const kf of clip.getVisibleKeyframes()) {
        pushForNode(node, { kind: 'visible', nodeId: node.id }, kf)
      }
      for (const kf of clip.getZIndexKeyframes()) {
        pushForNode(node, { kind: 'zIndex', nodeId: node.id }, kf)
      }
      for (const kf of clip.getMorphKeyframes()) {
        pushForNode(node, { kind: 'morph', nodeId: node.id }, kf)
      }
      for (const kf of clip.getSymmetryKeyframes()) {
        pushForNode(node, { kind: 'symmetry', nodeId: node.id }, kf)
      }
      for (const prop of clip.circleTrackKeys) {
        for (const kf of clip.getCircleKeyframes(prop)) {
          pushForNode(node, { kind: 'circle', nodeId: node.id, property: prop }, kf)
        }
      }
      for (const prop of clip.shadowChannelKeys) {
        for (const kf of clip.getShadowChannelKeyframes(prop)) {
          pushForNode(node, { kind: 'shadow', nodeId: node.id, property: prop }, kf)
        }
      }
    }
  }

  if (writes.length === 0 && truncatedCount === 0) {
    return { error: 'Nothing to flatten: no clip keyframes resolve to the range.' }
  }
  return { writes, perNode, truncatedCount, warnings }
}

export function previewCollectionFlatten(engine: EnginePublic, plan: FlattenPlan): FlattenPreview {
  const collected = collectWrites(engine, plan)
  if ('error' in collected) {
    return {
      entries: [],
      totalWrites: 0,
      truncatedCount: 0,
      conflicts: [],
      warnings: [collected.error],
    }
  }
  const conflicts = collectConflicts(engine, collected.writes, plan.from, plan.to)
  const entries: FlattenPreviewEntry[] = [...collected.perNode.values()]
    .map((e) => ({ ...e }))
    .sort((a, b) => a.nodeName.localeCompare(b.nodeName))
  return {
    entries,
    totalWrites: collected.writes.length,
    truncatedCount: collected.truncatedCount,
    conflicts,
    warnings: [...collected.warnings],
  }
}

function collectConflicts(
  engine: EnginePublic,
  writes: readonly PendingWrite[],
  from: number,
  to: number,
): FlattenConflict[] {
  const byTarget = new Map<string, { target: KeyframeTarget; nodeName: string }>()
  for (const w of writes) {
    const key = targetKey(w.target)
    if (!byTarget.has(key)) byTarget.set(key, { target: w.target, nodeName: w.nodeName })
  }
  const conflicts: FlattenConflict[] = []
  for (const { target, nodeName } of byTarget.values()) {
    const existing = existingInRange(engine, target, from, to)
    if (existing.length > 0) {
      conflicts.push({
        target,
        nodeName,
        label: describeTarget(target),
        existingCount: existing.length,
      })
    }
  }
  return conflicts
}

export function longestClipDuration(engine: EnginePublic, collectionId: string): number {
  try {
    const col = engine.getClipCollection(collectionId)
    let max = 0
    for (const clipId of Object.values(col.getBindingsObject())) {
      try {
        const clip = engine.getClip(clipId)
        if (Number.isFinite(clip.duration) && clip.duration > max) max = clip.duration
      } catch {
        continue
      }
    }
    return max
  } catch {
    return 0
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

export function executeCollectionFlatten(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  plan: FlattenPlan,
): FlattenResult {
  const collected = collectWrites(engine, plan)
  if ('error' in collected) return { ok: false, error: collected.error }

  // Block-on-conflict: any existing orphan in range on an affected track fails with zero writes.
  const conflicts = collectConflicts(engine, collected.writes, plan.from, plan.to)
  if (conflicts.length > 0) {
    const bits = conflicts.map(
      (c) => `"${c.nodeName}" ${c.label} already has ${c.existingCount} keyframe(s) in the range`,
    )
    return {
      ok: false,
      error: `Flatten blocked: ${bits.join('; ')}. Clear the range or pick another.`,
      conflicts,
    }
  }

  // Group writes per track → one PasteKeyframesCommand each (preserves interp/tangents).
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
  // Note: no cmd.validate(engine) pre-check here — PasteKeyframesCommand.validate
  // needs the internal Engine (getSlideOfNode), while this executor only receives
  // the public facade. Conflict and range checks above already guarantee the
  // common failure modes are atomic (zero writes); dispatch failures below merge
  // for single-step undo like the segment executor's uncommon-failure path.

  let records = 0
  for (const cmd of cmds) {
    const res = dispatch(cmd)
    if (!res.ok) {
      mergeRecords(undoStack, records)
      return { ok: false, error: res.error.message }
    }
    records += 1
  }
  mergeRecords(undoStack, records)

  const warnings = [...collected.warnings]
  if (collected.truncatedCount > 0) {
    warnings.push(
      `${collected.truncatedCount} keyframe(s) past To were skipped — extend To to include them.`,
    )
  }
  warnings.push(
    'Collection lanes and clip instances were left in place — overlapping ranges now double-drive until one side is removed.',
  )
  return {
    ok: true,
    writtenCount: collected.writes.length,
    truncatedCount: collected.truncatedCount,
    warnings,
  }
}
