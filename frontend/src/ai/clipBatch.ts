/**
 * Local clip-batch drafting from live timeline orphans.
 *
 * The LLM proposal drafter never sees orphan keyframe times/values (the
 * context snapshot carries only per-node keyframe counts), so any Clip
 * channels it emits are invented — and invented in a non-canonical dialect
 * (keyframes nested under `channels[]`, per-channel `nodeId`,
 * `morphAnimation.shapeName`) that the engine parses lossily into empty
 * clips. This module is the instant path that replaces invention with
 * extraction, mirroring the `shape-step` precedent:
 *
 * ```clip-batch
 * window: 0 - 4
 * clip: body lie-to-stand | node: body | semantic: body
 * clip: head lie-to-stand | node: node-abc123 | semantic: head
 * ```
 *
 * The builder resolves each step against live nodes, collects that node's
 * orphan keyframes inside the shared window, normalizes times to [0, 1], and
 * emits canonical ClipJSON (`duration: 1`, `channels` definitions plus
 * `channelAnimations` / `morphAnimation` maps with real keyframe ids,
 * interpolation, and tangents) — one single-operation `upsertClip` command
 * per step. Morph values convert from shape ids to shape names, exactly like
 * the timeline "Add to clip" extraction. Nothing here invents channel data.
 *
 * Pure apart from engine reads: parses text, reads the live engine, never
 * mutates it. Approval and execution stay in the proposal pipeline.
 */

import type { EnginePublic } from '../engine'
import type { ClipJSON } from '../engine/json'
import type { KeyframeTarget } from '../engine/keyframeTarget'
import type { AnimationProperty, CircleAnimationProperty } from '../engine/animationProperties'
import { ANIMATABLE_PROPERTIES, CIRCLE_ANIMATABLE_PROPERTIES } from '../engine/animationProperties'
import type { ShadowProperty } from '../engine/shadowEffect'
import { SHADOW_PROPERTIES } from '../engine/shadowEffect'
import type { InterpolationType } from '../engine/keyframe'
import type { ExtractableKeyframe, NormalizedKeyframe } from '../engine/clipExtraction'
import { channelKeyOf, validateNoDuplicateTimes } from '../engine/clipExtraction'
import { newKeyframeId } from '../engine/keyframe'
import { newClipId } from '../engine/clipDefinition'
import { newId } from '../engine/ids'
import type { ShapeCategory } from '../engine/shapeCategory'
import { categoryPathOfShape, qualifiedShapeName, splitQualifiedShapeName } from '../engine/shape'
import type { AnimationAssetOperation } from './animationAssetOperations'

export interface ClipBatchStep {
  /** New Clip name (required). */
  readonly name: string
  /** Target Scene Node id (or exact name — resolved against live inventory). */
  readonly node: string
  /** Semantic Name for the later Collection bindings. Defaults to the node's own. */
  readonly semantic: string | null
  /** Clip category. Defaults to the semantic name. */
  readonly category: string | null
  /**
   * Hand-authored track specs for nodes with no usable orphans. Empty means
   * "extract this step from live orphans". When present, these specs win
   * entirely — orphans on the node are ignored for this step.
   */
  readonly keys: readonly DesignedTrack[]
}

/** One hand-authored track: `keys: positionY = 0@0, -20@0.5:hold, 0@1`. */
export interface DesignedTrack {
  /** Uniform-six property, `morph`, `visible`, `zIndex`, or `circle.<prop>`. */
  readonly track: string
  /** Morph only: source shape ref — a bare name or `Category/Sub/name` for duplicates. */
  readonly morphFrom: string | null
  /** Morph only: target shape ref — a bare name or `Category/Sub/name` for duplicates. */
  readonly morphTo: string | null
  readonly points: readonly DesignedPoint[]
}

export interface DesignedPoint {
  readonly value: number | boolean
  /** Seconds in the batch window — normalized to [0, 1] at build time. */
  readonly time: number
  readonly interpolation: InterpolationType
}

export interface ClipBatchPlan {
  /** Shared extraction window in seconds. Defaults to the orphans' min/max. */
  readonly from: number | null
  readonly to: number | null
  readonly steps: readonly ClipBatchStep[]
  /** Optional closing Collection binding every step's semantic to its clip. */
  readonly collection: ClipBatchCollection | null
  /** Malformed collection line — surfaced as a build error, never silent. */
  readonly collectionError: string | null
}

/** `collection: <name> | source: <rig root node> | category?: <cat>`. */
export interface ClipBatchCollection {
  readonly name: string
  /** Rig root Scene Node id (or exact name) hosting the whole-rig preview. */
  readonly source: string
  readonly category: string | null
}

export interface ClipBatchStepResult {
  readonly operation: AnimationAssetOperation
  readonly clipId: string
  readonly clipName: string
  readonly semantic: string
  /** Human-readable channel coverage, e.g. ["positionY", "morphCoefficient"]. */
  readonly channels: readonly string[]
  readonly keyframeCount: number
}

export interface ClipBatchBuild {
  readonly operations: AnimationAssetOperation[]
  readonly steps: ClipBatchStepResult[]
  readonly collection: {
    readonly operation: AnimationAssetOperation
    readonly id: string
    readonly name: string
    readonly bindings: Readonly<Record<string, string>>
  } | null
  readonly from: number
  readonly to: number
  readonly summary: string
}

const FENCE_RE = /```(\w[\w-]*)\s*\n([\s\S]*?)```/g
const EPS = 1e-9

function clean(value: string | undefined): string | null {
  if (value === undefined) return null
  const stripped = value
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .trim()
  return stripped ? stripped : null
}

/** Parse one `clip: <name> | node: <...> | semantic: <...> | category: <...>` line. */
function parseStepLine(line: string): ClipBatchStep | null {
  const segments = line.split('|').map((part) => part.trim())
  if (segments.length === 0) return null
  const [first, ...rest] = segments as [string, ...string[]]
  const head = /^clip\s*[:=]\s*(.+?)\s*$/.exec(first)
  if (!head?.[1]) return null
  const name = clean(head[1])
  if (!name) return null
  let node: string | null = null
  let semantic: string | null = null
  let category: string | null = null
  for (const part of rest) {
    const match = /^([A-Za-z]+)\s*[:=]\s*(.+?)\s*$/.exec(part)
    if (!match?.[1] || match[2] === undefined) continue
    const value = clean(match[2])
    if (!value) continue
    switch (match[1].toLowerCase()) {
      case 'node':
        node = value
        break
      case 'semantic':
        semantic = value
        break
      case 'category':
        category = value
        break
      default:
        break
    }
  }
  if (!node) return null
  return { name, node, semantic, category, keys: [] }
}

function parseWindow(value: string): { from: number; to: number } | null {
  const match = /^(-?\d+(?:\.\d+)?)\s*(?:-|,|to)\s*(-?\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match?.[1] || !match[2]) return null
  const from = Number(match[1])
  const to = Number(match[2])
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to - from > EPS)) return null
  return { from, to }
}

const KNOWN_INTERPOLATIONS: readonly string[] = [
  'hold',
  'linear',
  'bezier',
  'bounce',
  'elastic',
  'spring',
]

/**
 * Parse one `keys:` line into a DesignedTrack.
 * `keys: positionY = 0@0, -20@0.5, 0@1`
 * `keys: morph standing -> stand = 0@0, 1@1`
 * `keys: morph profile/standing -> profile/stand = 0@0, 1@1`
 * `keys: visible = true@0, false@2`
 * Optional per-point interpolation: `0@0:hold`.
 */
function parseKeysLine(line: string): DesignedTrack | null {
  const match = /^keys\s*[:=]\s*(.+?)\s*$/.exec(line.trim())
  if (!match?.[1]) return null
  const spec = match[1]
  const eq = spec.indexOf('=')
  if (eq < 0) return null
  const head = spec.slice(0, eq).trim()
  const tail = spec.slice(eq + 1).trim()
  if (!head || !tail) return null
  let track: string
  let morphFrom: string | null = null
  let morphTo: string | null = null
  const morphHead = /^morph\s+(.+)$/i.exec(head)
  if (morphHead?.[1]) {
    // Split on the arrow (not \S+ tokens) so shape and category names may
    // contain spaces. A `morph <name>` line without an arrow falls through to
    // track handling, which fails loudly with the valid track vocabulary.
    const sides = morphHead[1].split('->')
    if (sides.length === 2) {
      const from = sides[0]?.trim().replace(/^["']|["']$/g, '')
      const to = sides[1]?.trim().replace(/^["']|["']$/g, '')
      if (from && to) {
        track = 'morph'
        morphFrom = from
        morphTo = to
      } else {
        return null
      }
    } else {
      const lower = head.toLowerCase()
      track = lower
    }
  } else {
    // Canonicalize case-insensitively — `positiony` must still hit `positionY`.
    const lower = head.toLowerCase()
    track =
      (ANIMATABLE_PROPERTIES as readonly string[]).find((prop) => prop.toLowerCase() === lower) ??
      (lower === 'zindex' ? 'zIndex' : null) ??
      (() => {
        const circle = /^circle\.([A-Za-z]+)$/.exec(head)
        const prop = circle?.[1]
        if (prop) {
          const canonical = (CIRCLE_ANIMATABLE_PROPERTIES as readonly string[]).find(
            (entry) => entry.toLowerCase() === prop.toLowerCase(),
          )
          if (canonical) return `circle.${canonical}`
        }
        return null
      })() ??
      lower
  }
  const points: DesignedPoint[] = []
  for (const chunk of tail.split(',')) {
    const point = /^\s*(\S+)\s*@\s*(\S+?)(?::\s*(\S+))?\s*$/.exec(chunk)
    if (!point?.[1] || !point[2]) return null
    const time = Number(point[2])
    if (!Number.isFinite(time)) return null
    let value: number | boolean
    if (point[1] === 'true' || point[1] === 'false') {
      value = point[1] === 'true'
    } else {
      const numeric = Number(point[1])
      if (!Number.isFinite(numeric)) return null
      value = numeric
    }
    const interp = (point[3] ?? 'linear').toLowerCase()
    if (!(KNOWN_INTERPOLATIONS as readonly string[]).includes(interp)) return null
    points.push({ value, time, interpolation: interp as InterpolationType })
  }
  if (points.length === 0) return null
  return { track, morphFrom, morphTo, points }
}

/** First well-formed ```clip-batch block wins; returns null when absent. */
export function extractClipBatchBlock(content: string): ClipBatchPlan | null {
  if (!content) return null
  FENCE_RE.lastIndex = 0
  for (const match of content.matchAll(FENCE_RE)) {
    const lang = (match[1] ?? '').toLowerCase()
    if (lang !== 'clip-batch' && lang !== 'clipbatch') continue
    const body = match[2] ?? ''
    let from: number | null = null
    let to: number | null = null
    const steps: ClipBatchStep[] = []
    let collection: ClipBatchCollection | null = null
    let collectionError: string | null = null
    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const windowMatch = /^window\s*[:=]\s*(.+?)\s*$/.exec(trimmed)
      if (windowMatch?.[1]) {
        const parsed = parseWindow(windowMatch[1])
        if (parsed) {
          from = parsed.from
          to = parsed.to
        }
        continue
      }
      if (/^collection\s*[:=]/i.test(trimmed)) {
        if (collection) {
          collectionError = 'Only one collection per batch — bind every step into it.'
        } else {
          collection = parseCollectionLine(trimmed)
          if (!collection) {
            collectionError =
              'The collection line needs a name and source: `collection: <name> | source: <rig root node>`.'
          }
        }
        continue
      }
      if (/^clip\s*[:=]/i.test(trimmed)) {
        const step = parseStepLine(trimmed)
        if (step) steps.push(step)
        continue
      }
      if (/^keys\s*[:=]/i.test(trimmed) && steps.length > 0) {
        const track = parseKeysLine(trimmed)
        if (track) {
          const last = steps[steps.length - 1]!
          steps[steps.length - 1] = { ...last, keys: [...last.keys, track] }
        }
      }
    }
    if (steps.length === 0) continue
    return { from, to, steps, collection, collectionError }
  }
  return null
}

/** Parse `collection: <name> | source: <node> | category?: <cat>`. */
function parseCollectionLine(line: string): ClipBatchCollection | null {
  const withoutKeyword = line.replace(/^collection\s*[:=]\s*/i, '')
  const segments = withoutKeyword.split('|').map((part) => part.trim())
  if (segments.length === 0) return null
  const [first, ...rest] = segments as [string, ...string[]]
  const name = clean(first)
  if (!name) return null
  let source: string | null = null
  let category: string | null = null
  for (const part of rest) {
    const match = /^([A-Za-z]+)\s*[:=]\s*(.+?)\s*$/.exec(part)
    if (!match?.[1] || match[2] === undefined) continue
    const value = clean(match[2])
    if (!value) continue
    switch (match[1].toLowerCase()) {
      case 'source':
        source = value
        break
      case 'category':
        category = value
        break
      default:
        break
    }
  }
  if (!source) return null
  return { name, source, category }
}

interface LiveNode {
  readonly id: string
  readonly name: string
}

function resolveNodeId(nodes: readonly LiveNode[], ref: string): LiveNode | null {
  const exact = nodes.find((entry) => entry.id === ref)
  if (exact) return exact
  const lowered = ref.toLowerCase()
  return nodes.find((entry) => entry.name.toLowerCase() === lowered) ?? null
}

function inWindow(time: number, from: number, to: number): boolean {
  return time >= from - EPS && time <= to + EPS
}

function toExtractable(
  target: KeyframeTarget,
  kf: {
    readonly id: string
    readonly time: number
    readonly value: unknown
    readonly interpolation: unknown
    readonly tangentIn: { readonly time: number; readonly value: number }
    readonly tangentOut: { readonly time: number; readonly value: number }
  },
): ExtractableKeyframe {
  return {
    target,
    time: kf.time,
    value: kf.value as ExtractableKeyframe['value'],
    interpolation: kf.interpolation as ExtractableKeyframe['interpolation'],
    tangentIn: { time: kf.tangentIn.time, value: kf.tangentIn.value },
    tangentOut: { time: kf.tangentOut.time, value: kf.tangentOut.value },
    keyframeId: kf.id,
  }
}

/**
 * Collect one node's orphan keyframes inside [from, to] across the
 * clip-storable track families (uniform-six, morph, visible, zIndex,
 * circle, symmetry, shadow). Material / table / data-label / control tracks
 * are not extracted — steps touching only those fail loudly below instead
 * of producing a silently partial clip.
 */
function collectOrphans(
  engine: EnginePublic,
  nodeId: string,
  from: number,
  to: number,
): ExtractableKeyframe[] {
  const out: ExtractableKeyframe[] = []
  const push = (target: KeyframeTarget, list: readonly unknown[]) => {
    for (const raw of list) {
      const kf = raw as {
        readonly id: string
        readonly time: number
        readonly value: unknown
        readonly interpolation: unknown
        readonly tangentIn: { readonly time: number; readonly value: number }
        readonly tangentOut: { readonly time: number; readonly value: number }
        readonly disabled?: unknown
      }
      if (kf?.disabled === true) continue
      if (typeof kf?.time !== 'number' || !inWindow(kf.time, from, to)) continue
      out.push(toExtractable(target, kf))
    }
  }
  const attempt = (read: () => void) => {
    try {
      read()
    } catch {
      // Missing track family on this node — skip, never fail the step.
    }
  }
  for (const property of ANIMATABLE_PROPERTIES) {
    attempt(() =>
      push(
        { kind: 'node', nodeId, property: property as AnimationProperty },
        engine.getKeyframes(nodeId, property as AnimationProperty) as readonly unknown[],
      ),
    )
  }
  attempt(() => push({ kind: 'morph', nodeId }, engine.getMorphKeyframes(nodeId)))
  attempt(() => push({ kind: 'visible', nodeId }, engine.getVisibleKeyframes(nodeId)))
  attempt(() => push({ kind: 'zIndex', nodeId }, engine.getZIndexKeyframes(nodeId)))
  for (const property of CIRCLE_ANIMATABLE_PROPERTIES) {
    attempt(() =>
      push(
        { kind: 'circle', nodeId, property: property as CircleAnimationProperty },
        engine.getCircleKeyframes(nodeId, property as CircleAnimationProperty),
      ),
    )
  }
  attempt(() => push({ kind: 'symmetry', nodeId }, engine.getSymmetryKeyframes(nodeId)))
  for (const property of SHADOW_PROPERTIES) {
    if (property === 'color') continue
    attempt(() =>
      push(
        { kind: 'shadow', nodeId, property: property as ShadowProperty },
        engine.getShadowKeyframes(nodeId, property as ShadowProperty),
      ),
    )
  }
  return out
}

/** Orphan morph values reference shape ids — clips carry shape names + category paths. */
function morphToClipValue(engine: EnginePublic, nodeId: string, raw: unknown): unknown {
  if (typeof raw === 'number') {
    return { fromShapeId: null, toShapeId: null, coefficient: raw }
  }
  if (typeof raw !== 'object' || raw === null) return raw
  const record = raw as Record<string, unknown>
  if (!('coefficient' in record)) return raw
  if ('fromShapeName' in record || 'toShapeName' in record) return raw
  let categories: readonly ShapeCategory[] | undefined
  try {
    categories = engine.getShapeCategories(nodeId)
  } catch {
    categories = undefined
  }
  // Category paths travel with the names so duplicate shape names resolve
  // exactly on the target (null = Uncategorized).
  let fromName: string | null = null
  let toName: string | null = null
  let fromPath: readonly string[] | null = null
  let toPath: readonly string[] | null = null
  try {
    const shapes = engine.getShapes(nodeId)
    const fromId = (record.fromShapeId as string | null) ?? null
    const toId = (record.toShapeId as string | null) ?? null
    if (fromId) {
      const found = shapes.find((shape) => shape.id === fromId)
      if (found) {
        fromName = found.name
        fromPath = categoryPathOfShape(found, categories)
      }
    }
    if (toId) {
      const found = shapes.find((shape) => shape.id === toId)
      if (found) {
        toName = found.name
        toPath = categoryPathOfShape(found, categories)
      }
    }
  } catch {
    // No mesh inventory — keep nulls; the dry-run names the missing shapes.
  }
  return {
    fromShapeName: fromName,
    toShapeName: toName,
    fromCategoryPath: fromPath,
    toCategoryPath: toPath,
    coefficient: record.coefficient,
  }
}

interface ShapeInventoryEntry {
  readonly id: string
  readonly name: string
  readonly categoryPath: readonly string[] | null
}

function shapeInventory(engine: EnginePublic, nodeId: string): ShapeInventoryEntry[] {
  try {
    const shapes = engine.getShapes(nodeId)
    let categories: readonly ShapeCategory[] | undefined
    try {
      categories = engine.getShapeCategories(nodeId)
    } catch {
      categories = undefined
    }
    return shapes.map((shape) => ({
      id: shape.id,
      name: shape.name,
      categoryPath: categoryPathOfShape(shape, categories),
    }))
  } catch {
    return []
  }
}

function pathsEqual(a: readonly string[] | null, b: readonly string[] | null): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function qualifiedInventory(inventory: readonly ShapeInventoryEntry[]): string {
  return (
    inventory.map((shape) => qualifiedShapeName(shape.categoryPath, shape.name)).join(', ') ||
    '(none)'
  )
}

type ShapeRefResolution =
  | { readonly status: 'ok'; readonly shape: ShapeInventoryEntry }
  | { readonly status: 'unknown' }
  | { readonly status: 'ambiguous'; readonly matches: readonly ShapeInventoryEntry[] }

/**
 * Resolve a morph shape ref — a bare name or `Category/Sub/name` — against
 * the live mesh inventory. Bare names matching several shapes (same name in
 * different categories) resolve as ambiguous instead of silently taking the
 * first match; the caller tells the author to qualify with Category/Name.
 */
function resolveShapeRef(
  inventory: readonly ShapeInventoryEntry[],
  wanted: string,
): ShapeRefResolution {
  const trimmed = wanted.trim()
  if (!trimmed) return { status: 'unknown' }
  const { categoryPath, name } = splitQualifiedShapeName(trimmed)
  if (!name) return { status: 'unknown' }
  if (categoryPath.length > 0) {
    const byPath = inventory.filter(
      (shape) => shape.name === name && pathsEqual(shape.categoryPath, categoryPath),
    )
    if (byPath.length > 0) return { status: 'ok', shape: byPath[0]! }
    const byPathInsensitive = inventory.filter(
      (shape) =>
        shape.name.toLowerCase() === name.toLowerCase() &&
        (shape.categoryPath ?? []).length === categoryPath.length &&
        (shape.categoryPath ?? []).every(
          (segment, index) => segment.toLowerCase() === categoryPath[index]!.toLowerCase(),
        ),
    )
    if (byPathInsensitive.length > 0) return { status: 'ok', shape: byPathInsensitive[0]! }
    // Fall through: the whole string may be a slash-containing shape name.
  }
  const named = inventory.filter((shape) => shape.name === trimmed)
  if (named.length === 1) return { status: 'ok', shape: named[0]! }
  if (named.length > 1) return { status: 'ambiguous', matches: named }
  const namedInsensitive = inventory.filter(
    (shape) => shape.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (namedInsensitive.length === 1) return { status: 'ok', shape: namedInsensitive[0]! }
  if (namedInsensitive.length > 1) return { status: 'ambiguous', matches: namedInsensitive }
  return { status: 'unknown' }
}

/** Map a designed track name to a live keyframe target — unknown tracks fail the step. */
function designedTarget(
  track: string,
  nodeId: string,
): { ok: true; target: KeyframeTarget } | { ok: false; error: string } {
  if ((ANIMATABLE_PROPERTIES as readonly string[]).includes(track)) {
    return { ok: true, target: { kind: 'node', nodeId, property: track as AnimationProperty } }
  }
  if (track === 'morph') return { ok: true, target: { kind: 'morph', nodeId } }
  if (track === 'visible') return { ok: true, target: { kind: 'visible', nodeId } }
  if (track === 'zindex') return { ok: true, target: { kind: 'zIndex', nodeId } }
  const circle = /^circle\.([A-Za-z]+)$/.exec(track)
  if (circle?.[1] && (CIRCLE_ANIMATABLE_PROPERTIES as readonly string[]).includes(circle[1])) {
    return {
      ok: true,
      target: { kind: 'circle', nodeId, property: circle[1] as CircleAnimationProperty },
    }
  }
  return {
    ok: false,
    error:
      `Unknown track “${track}” — use a uniform-six property ` +
      `(positionX, positionY, rotation, scaleX, scaleY, opacity), morph, visible, zIndex, or circle.<prop>.`,
  }
}

/**
 * Turn hand-authored track specs into normalized keyframes. Shape names
 * resolve against the live mesh inventory — unknown names fail loudly
 * instead of persisting as dead references.
 */
function designedExtractables(args: {
  engine: EnginePublic
  nodeId: string
  nodeName: string
  stepName: string
  tracks: readonly DesignedTrack[]
  from: number
  to: number
}): { ok: true; keyframes: NormalizedKeyframe[] } | { ok: false; error: string } {
  const { engine, nodeId, nodeName, stepName, tracks, from, to } = args
  const span = to - from
  const out: NormalizedKeyframe[] = []
  for (const spec of tracks) {
    const resolved = designedTarget(spec.track, nodeId)
    if (!resolved.ok) return { ok: false, error: `Clip “${stepName}”: ${resolved.error}` }
    let morphNames: {
      from: string
      to: string
      fromPath: readonly string[] | null
      toPath: readonly string[] | null
    } | null = null
    if (spec.track === 'morph') {
      const inventory = shapeInventory(engine, nodeId)
      if (inventory.length === 0) {
        return {
          ok: false,
          error: `Clip “${stepName}”: node “${nodeName}” has no mesh Shapes — morph needs a mesh target.`,
        }
      }
      const fromShape = resolveShapeRef(inventory, spec.morphFrom ?? '')
      const toShape = resolveShapeRef(inventory, spec.morphTo ?? '')
      const ambiguous = [fromShape, toShape].find(
        (entry): entry is Extract<ShapeRefResolution, { status: 'ambiguous' }> =>
          entry.status === 'ambiguous',
      )
      if (ambiguous) {
        const wanted = ambiguous === fromShape ? (spec.morphFrom ?? '') : (spec.morphTo ?? '')
        const options = ambiguous.matches
          .map((shape) => qualifiedShapeName(shape.categoryPath, shape.name))
          .join(', ')
        return {
          ok: false,
          error:
            `Clip “${stepName}”: morph shape “${wanted}” matches several shapes — ` +
            `qualify with Category/Name: ${options}.`,
        }
      }
      if (fromShape.status !== 'ok' || toShape.status !== 'ok') {
        return {
          ok: false,
          error:
            `Clip “${stepName}”: unknown morph shape — “${spec.morphFrom}” → “${spec.morphTo}”. ` +
            `Available on “${nodeName}”: ${qualifiedInventory(inventory)}.`,
        }
      }
      morphNames = {
        from: fromShape.shape.name,
        to: toShape.shape.name,
        fromPath: fromShape.shape.categoryPath,
        toPath: toShape.shape.categoryPath,
      }
    }
    for (const point of spec.points) {
      if (!(point.time >= from - EPS && point.time <= to + EPS)) {
        return {
          ok: false,
          error: `Clip “${stepName}”: keyframe at ${point.time}s is outside the window [${from}, ${to}].`,
        }
      }
      let value: ExtractableKeyframe['value']
      if (spec.track === 'morph') {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
          return { ok: false, error: `Clip “${stepName}”: morph coefficient must be a number.` }
        }
        if (point.value < 0 || point.value > 1) {
          return {
            ok: false,
            error: `Clip “${stepName}”: morph coefficient ${point.value} must be between 0 and 1.`,
          }
        }
        value = {
          fromShapeName: morphNames!.from,
          toShapeName: morphNames!.to,
          fromCategoryPath: morphNames!.fromPath,
          toCategoryPath: morphNames!.toPath,
          coefficient: point.value,
        } as unknown as ExtractableKeyframe['value']
      } else if (spec.track === 'visible') {
        if (typeof point.value !== 'boolean') {
          return { ok: false, error: `Clip “${stepName}”: visible takes true/false only.` }
        }
        value = point.value as unknown as ExtractableKeyframe['value']
      } else {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
          return {
            ok: false,
            error: `Clip “${stepName}”: track “${spec.track}” takes numbers only.`,
          }
        }
        if (spec.track === 'opacity' && (point.value < 0 || point.value > 1)) {
          return {
            ok: false,
            error: `Clip “${stepName}”: opacity ${point.value} must be between 0 and 1.`,
          }
        }
        value =
          spec.track === 'zindex'
            ? (Math.trunc(point.value) as unknown as ExtractableKeyframe['value'])
            : (point.value as unknown as ExtractableKeyframe['value'])
      }
      out.push({
        target: resolved.target,
        time: (point.time - from) / span,
        value,
        interpolation: point.interpolation,
        tangentIn: { time: 0, value: 0 },
        tangentOut: { time: 0, value: 0 },
        originalId: `designed-${spec.track}@${point.time}`,
      })
    }
  }
  if (out.length === 0) {
    return { ok: false, error: `Clip “${stepName}”: no keyframe points parsed.` }
  }
  return { ok: true, keyframes: out }
}

function channelLabel(target: KeyframeTarget): string {
  if (target.kind === 'node' && 'property' in target) return target.property
  if (target.kind === 'morph') return 'morphCoefficient'
  if (target.kind === 'visible') return 'visible'
  if (target.kind === 'zIndex') return 'zIndex'
  if (target.kind === 'circle') return `circle.${target.property}`
  if (target.kind === 'symmetry') return 'symmetry'
  if (target.kind === 'shadow') return `shadow.${target.property}`
  return target.kind
}

interface AssembledClip {
  readonly clip: ClipJSON
  readonly channels: readonly string[]
  readonly keyframeCount: number
}

/** Assemble canonical ClipJSON from window-normalized keyframes. */
function assembleClip(
  engine: EnginePublic,
  nodeId: string,
  name: string,
  category: string,
  normalized: readonly NormalizedKeyframe[],
): AssembledClip {
  const groups = new Map<string, NormalizedKeyframe[]>()
  for (const nk of normalized) {
    const key = channelKeyOf(nk.target)
    const arr = groups.get(key)
    if (arr) arr.push(nk)
    else groups.set(key, [nk])
  }
  validateNoDuplicateTimes(groups)

  const channels: { property: string; materialParameter?: string }[] = []
  const channelAnimations: Record<string, { keyframes: Record<string, unknown>[] }> = {}
  const circleChannelAnimations: Record<string, { keyframes: Record<string, unknown>[] }> = {}
  const shadowChannelAnimations: Record<string, { keyframes: Record<string, unknown>[] }> = {}
  let morphAnimation: { keyframes: Record<string, unknown>[] } | undefined
  let visibleAnimation: { keyframes: Record<string, unknown>[] } | undefined
  let zIndexAnimation: { keyframes: Record<string, unknown>[] } | undefined
  let symmetryAnimation: { keyframes: Record<string, unknown>[] } | undefined
  const labels = new Set<string>()
  let skipped = 0

  const toKeyframeJson = (nk: NormalizedKeyframe, forceHold = false): Record<string, unknown> => ({
    id: newKeyframeId(),
    time: nk.time,
    value: nk.value,
    interpolation: forceHold ? 'hold' : nk.interpolation,
    tangentIn: { time: nk.tangentIn.time, value: nk.tangentIn.value },
    tangentOut: { time: nk.tangentOut.time, value: nk.tangentOut.value },
  })

  for (const [, arr] of groups) {
    const sample = arr[0]!.target
    labels.add(channelLabel(sample))
    if (sample.kind === 'node' && 'property' in sample) {
      if (!channels.some((entry) => entry.property === sample.property)) {
        channels.push({ property: sample.property })
      }
      const slot = (channelAnimations[sample.property] ??= { keyframes: [] })
      for (const nk of arr) slot.keyframes.push(toKeyframeJson(nk))
    } else if (sample.kind === 'morph') {
      const slot = (morphAnimation ??= { keyframes: [] })
      for (const nk of arr) {
        slot.keyframes.push(
          toKeyframeJson({
            ...nk,
            value: morphToClipValue(engine, nodeId, nk.value) as NormalizedKeyframe['value'],
          }),
        )
      }
    } else if (sample.kind === 'visible') {
      const slot = (visibleAnimation ??= { keyframes: [] })
      for (const nk of arr) slot.keyframes.push(toKeyframeJson(nk, true))
    } else if (sample.kind === 'zIndex') {
      const slot = (zIndexAnimation ??= { keyframes: [] })
      for (const nk of arr) slot.keyframes.push(toKeyframeJson(nk, true))
    } else if (sample.kind === 'symmetry') {
      const slot = (symmetryAnimation ??= { keyframes: [] })
      for (const nk of arr) slot.keyframes.push(toKeyframeJson(nk))
    } else if (sample.kind === 'circle') {
      const slot = (circleChannelAnimations[sample.property] ??= { keyframes: [] })
      for (const nk of arr) slot.keyframes.push(toKeyframeJson(nk))
    } else if (sample.kind === 'shadow') {
      const slot = (shadowChannelAnimations[sample.property] ??= { keyframes: [] })
      for (const nk of arr) slot.keyframes.push(toKeyframeJson(nk))
    } else {
      skipped += arr.length
    }
  }

  const clip = {
    id: newClipId(),
    name,
    duration: 1,
    category,
    params: [],
    channels,
    channelAnimations,
    materialChannelAnimations: {},
    ...(Object.keys(circleChannelAnimations).length > 0 ? { circleChannelAnimations } : {}),
    ...(Object.keys(shadowChannelAnimations).length > 0 ? { shadowChannelAnimations } : {}),
    ...(morphAnimation ? { morphAnimation } : {}),
    ...(visibleAnimation ? { visibleAnimation } : {}),
    ...(zIndexAnimation ? { zIndexAnimation } : {}),
    ...(symmetryAnimation ? { symmetryAnimation } : {}),
  } as unknown as ClipJSON
  return { clip, channels: [...labels], keyframeCount: normalized.length - skipped }
}

function nodeSemantic(engine: EnginePublic, nodeId: string, fallback: string): string {
  try {
    const node = engine.getNode(nodeId) as unknown as {
      semanticName?: unknown
      name?: unknown
    }
    if (typeof node?.semanticName === 'string' && node.semanticName.trim()) {
      return node.semanticName.trim()
    }
    if (typeof node?.name === 'string' && node.name.trim()) return node.name.trim()
  } catch {
    // Unresolvable here — resolution errors surface per step below.
  }
  return fallback
}

export function buildClipBatchOperations(args: {
  engine: EnginePublic
  nodes: readonly LiveNode[]
  plan: ClipBatchPlan
}): { ok: true; build: ClipBatchBuild } | { ok: false; error: string } {
  const { engine, nodes, plan } = args
  if (plan.steps.length === 0) return { ok: false, error: 'The clip batch has no steps.' }
  if (plan.steps.length > 20) {
    return { ok: false, error: 'Clip batches hold at most 20 steps — split it and draft twice.' }
  }
  if (plan.collectionError) return { ok: false, error: plan.collectionError }
  if (!plan.collection) {
    return {
      ok: false,
      error:
        'The clip batch has no collection line — add `collection: <name> | source: <rig root node>` binding every step\u2019s Semantic Name.',
    }
  }

  const resolved: { step: ClipBatchStep; node: LiveNode }[] = []
  for (const step of plan.steps) {
    const node = resolveNodeId(nodes, step.node)
    if (!node) {
      return {
        ok: false,
        error: `Node “${step.node}” (clip “${step.name}”) is not in the live scene — answer with the node name.`,
      }
    }
    resolved.push({ step, node })
  }

  // Shared time base first: an explicit window wins, otherwise the orphans'
  // min/max across every step so the minted clips stay in sync.
  let from = plan.from
  let to = plan.to
  const perStep: { step: ClipBatchStep; node: LiveNode; orphans: ExtractableKeyframe[] }[] = []
  if (from === null || to === null) {
    let min = Infinity
    let max = -Infinity
    for (const { step, node } of resolved) {
      const orphans = collectOrphans(engine, node.id, -Infinity, Infinity)
      for (const kf of orphans) {
        if (kf.time < min) min = kf.time
        if (kf.time > max) max = kf.time
      }
      perStep.push({ step, node, orphans })
    }
    if (!Number.isFinite(min) || !(max - min > EPS)) {
      return {
        ok: false,
        error:
          'No orphan keyframes found on the listed nodes — animate the timeline first, then draft the batch.',
      }
    }
    from = min
    to = max
  } else {
    for (const { step, node } of resolved) {
      perStep.push({ step, node, orphans: collectOrphans(engine, node.id, from, to) })
    }
  }
  const span = (to as number) - (from as number)

  const operations: AnimationAssetOperation[] = []
  const steps: ClipBatchStepResult[] = []
  const modes: string[] = []
  for (const { step, node, orphans } of perStep) {
    let normalized: NormalizedKeyframe[]
    let mode: string
    if (step.keys.length > 0) {
      // Hand-authored specs win — the node needs no orphans for this step.
      if (plan.from === null || plan.to === null) {
        return {
          ok: false,
          error:
            `Clip “${step.name}” carries hand-authored keys but the block has no explicit ` +
            `window — add a "window: <from> - <to>" line so keyframe times have a base.`,
        }
      }
      const designed = designedExtractables({
        engine,
        nodeId: node.id,
        nodeName: node.name,
        stepName: step.name,
        tracks: step.keys,
        from: from as number,
        to: to as number,
      })
      if (!designed.ok) return designed
      normalized = designed.keyframes
      mode = 'designed'
    } else {
      const inRange = orphans.filter((kf) => inWindow(kf.time, from as number, to as number))
      if (inRange.length === 0) {
        return {
          ok: false,
          error:
            `Node “${node.name}” has no orphan keyframes in [${from}, ${to}] — animate it first, ` +
            `narrow the window, or author its motion with keys: lines in the block.`,
        }
      }
      normalized = inRange.map((kf) => ({
        target: kf.target,
        time: (kf.time - (from as number)) / span,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: { time: kf.tangentIn.time / span, value: kf.tangentIn.value },
        tangentOut: { time: kf.tangentOut.time / span, value: kf.tangentOut.value },
        originalId: kf.keyframeId,
      }))
      mode = 'extracted'
    }
    const semantic = step.semantic ?? nodeSemantic(engine, node.id, node.name)
    const assembled = assembleClip(
      engine,
      node.id,
      step.name,
      step.category ?? semantic,
      normalized,
    )
    if (assembled.keyframeCount === 0) {
      return {
        ok: false,
        error: `Node “${node.name}” produced no clip-storable keyframes — only material/table tracks, which batches do not extract.`,
      }
    }
    operations.push({
      kind: 'upsertClip',
      action: 'create',
      nodeId: node.id,
      clip: assembled.clip,
    })
    steps.push({
      operation: operations[operations.length - 1]!,
      clipId: assembled.clip.id,
      clipName: step.name,
      semantic,
      channels: assembled.channels,
      keyframeCount: assembled.keyframeCount,
    })
    modes.push(mode)
  }

  let collection: ClipBatchBuild['collection'] = null
  if (plan.collection) {
    const source = resolveNodeId(nodes, plan.collection.source)
    if (!source) {
      return {
        ok: false,
        error: `Collection source “${plan.collection.source}” is not in the live scene — answer with the rig root name.`,
      }
    }
    const bindings: Record<string, string> = {}
    for (const entry of steps) {
      if (bindings[entry.semantic] !== undefined) {
        const clash = steps.find(
          (other) => other !== entry && other.semantic === entry.semantic,
        )?.clipName
        return {
          ok: false,
          error:
            `Duplicate Semantic Name “${entry.semantic}” in steps “${clash}” and “${entry.clipName}” — ` +
            `a collection binds one clip per Semantic Name.`,
        }
      }
      bindings[entry.semantic] = entry.clipId
    }
    const collectionId = newId('collection')
    const operation: AnimationAssetOperation = {
      kind: 'upsertCollection',
      action: 'create',
      collection: {
        id: collectionId,
        name: plan.collection.name,
        sourceNodeId: source.id,
        bindings,
        ...(plan.collection.category ? { category: plan.collection.category } : {}),
      },
    }
    operations.push(operation)
    collection = { operation, id: collectionId, name: plan.collection.name, bindings }
  }

  const summary =
    steps
      .map(
        (entry, i) =>
          `${entry.clipName} (${modes[i]}, ${entry.keyframeCount} keys: ${entry.channels.join(', ')})`,
      )
      .join('; ') +
    (collection
      ? ` + Collection “${collection.name}” (${Object.keys(collection.bindings).length} bindings)`
      : '')
  return {
    ok: true,
    build: { operations, steps, collection, from: from as number, to: to as number, summary },
  }
}
