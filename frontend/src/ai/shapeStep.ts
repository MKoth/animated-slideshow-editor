/**
 * Extracts the first appliable Shape step block from an assistant message.
 * The template contract asks the Shapes advisor to put the single source of
 * truth for Apply inside one fenced block with `key: value` lines:
 *
 * ```shape-step
 * action: create
 * node: node-abc123
 * source: sitting_facing_profile
 * name: lying_left_side
 * ```
 *
 * Update steps use `target:` (+ `source:` for the vertex donor, `name:` to
 * rename); delete steps use `shape:`. Values may be stable ids or exact
 * names — resolution against live inventory happens in the builder.
 *
 * Pure and read-only: parses text, never touches engine state.
 */

import type { AnimationAssetOperation } from './animationAssetOperations'
import {
  applyShapeTransform,
  describeShapeTransform,
  shapeCentroid,
  type ShapeTransform,
  type ShapeVertex,
} from './shapeTransform'

export type ShapeStepAction = 'create' | 'update' | 'delete'

export type ShapeTransformName = 'rotate' | 'scale' | 'translate' | 'mirror' | 'blend'

export interface ShapeStep {
  readonly action: ShapeStepAction
  /** Target Scene Node id (or exact name). Always required. */
  readonly node: string
  /** Source Shape id (or exact name). Required for create/update. */
  readonly source: string | null
  /** New Shape name. Required for create, optional rename for update. */
  readonly name: string | null
  /** Target Shape id (or exact name) for update. */
  readonly target: string | null
  /** Shape id (or exact name) for delete. */
  readonly shape: string | null
  /** Procedural transform applied to the donor vertices (create/update). */
  readonly transform: ShapeTransformName | null
  /** Raw transform params: degrees, pivot, scale, shift, axis, blend. */
  readonly params: Record<string, string>
}

const FENCE_RE = /```(\w[\w-]*)\s*\n([\s\S]*?)```/g

function clean(value: string | undefined): string | null {
  if (value === undefined) return null
  const stripped = value
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .trim()
  return stripped ? stripped : null
}

function parseBlock(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*([A-Za-z]+)\s*[:=]\s*(.+?)\s*$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue
    fields[match[1].toLowerCase()] = match[2]
      .trim()
      .replace(/^["'](.*)["']$/, '$1')
      .trim()
  }
  return fields
}

/** The block must carry a known action plus the fields that action needs. */
export function extractShapeStepBlock(content: string): ShapeStep | null {
  if (!content) return null
  FENCE_RE.lastIndex = 0
  for (const match of content.matchAll(FENCE_RE)) {
    const lang = (match[1] ?? '').toLowerCase()
    if (lang !== 'shape-step' && lang !== 'shapestep') continue
    const fields = parseBlock(match[2] ?? '')
    const action = (fields.action ?? '').toLowerCase()
    if (action !== 'create' && action !== 'update' && action !== 'delete') continue
    const node = clean(fields.node)
    if (!node) continue
    const transform = parseTransformName(fields.transform)
    if (transform === undefined) continue
    const params: Record<string, string> = {}
    for (const key of ['degrees', 'pivot', 'scale', 'shift', 'axis', 'blend']) {
      const value = fields[key]
      if (typeof value === 'string' && value.trim()) params[key] = value.trim()
    }
    if (action === 'create') {
      const source = clean(fields.source)
      const name = clean(fields.name)
      if (!source || !name) continue
      return {
        action,
        node,
        source,
        name,
        target: clean(fields.target),
        shape: null,
        transform,
        params,
      }
    }
    if (action === 'update') {
      const target = clean(fields.target)
      const source = clean(fields.source)
      if (!target || !source) continue
      return {
        action,
        node,
        source,
        name: clean(fields.name),
        target,
        shape: null,
        transform,
        params,
      }
    }
    const shape = clean(fields.shape)
    if (!shape) continue
    if (transform !== null) continue
    return {
      action,
      node,
      source: null,
      name: null,
      target: null,
      shape,
      transform: null,
      params: {},
    }
  }
  return null
}

function parseTransformName(raw: string | undefined): ShapeTransformName | null | undefined {
  if (raw === undefined) return null
  const name = raw.toLowerCase()
  if (
    name === 'rotate' ||
    name === 'scale' ||
    name === 'translate' ||
    name === 'mirror' ||
    name === 'blend'
  ) {
    return name
  }
  return undefined
}

export function hasAppliableShapeStep(content: string): boolean {
  return extractShapeStepBlock(content) !== null
}

export interface ShapeStepLiveShape {
  readonly id: string
  readonly name: string
  readonly vertices: readonly { readonly x: number; readonly y: number }[]
}

export interface ShapeStepOperationInput {
  readonly step: ShapeStep
  readonly nodeId: string
  readonly liveShapes: readonly ShapeStepLiveShape[]
}

export type ShapeStepOperationResult =
  | {
      readonly operation: AnimationAssetOperation
      /** Human summary of the applied transform (null for verbatim duplicates). */
      readonly summary: string | null
    }
  | { readonly error: string }

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : null
}

function parsePair(raw: string | undefined): [number, number] | null {
  if (raw === undefined) return null
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (parts.length === 1 && Number.isFinite(parts[0]))
    return [parts[0] as number, parts[0] as number]
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return [parts[0] as number, parts[1] as number]
  }
  return null
}

function findShape(
  liveShapes: readonly ShapeStepLiveShape[],
  ref: string,
): ShapeStepLiveShape | null {
  const exact = liveShapes.find((shape) => shape.id === ref)
  if (exact) return exact
  return liveShapes.find((shape) => shape.name === ref) ?? null
}

interface ResolvedTransform {
  readonly transform: ShapeTransform
  readonly donorVertices?: readonly ShapeVertex[]
}

/**
 * Validates the block's transform lines against live inventory. Numbers are
 * checked here so the model gets a precise correction; the vertex math
 * itself runs in applyShapeTransform.
 */
function resolveTransform(
  step: ShapeStep,
  sourceVertices: readonly ShapeVertex[],
  liveShapes: readonly ShapeStepLiveShape[],
): ResolvedTransform | { readonly error: string } {
  const name = step.transform
  if (name === null) return { error: 'No transform was requested.' }
  const centroid = shapeCentroid(sourceVertices)
  const pivot = (): { cx: number; cy: number } | { error: string } => {
    const raw = step.params.pivot
    if (raw === undefined) return centroid
    const pair = parsePair(raw)
    if (!pair) return { error: 'Pivot must be “x, y” numbers — answer with an explicit pivot.' }
    return { cx: pair[0], cy: pair[1] }
  }
  if (name === 'rotate') {
    const degrees = parseFiniteNumber(step.params.degrees)
    if (degrees === null) {
      return { error: 'Rotate needs degrees: <number> — answer with explicit degrees.' }
    }
    const center = pivot()
    if ('error' in center) return center
    return { transform: { type: 'rotate', degrees, cx: center.cx, cy: center.cy } }
  }
  if (name === 'scale') {
    const factors = parsePair(step.params.scale)
    if (!factors || factors[0] === 0 || factors[1] === 0) {
      return { error: 'Scale needs scale: <factor> or scale: <sx>, <sy> with non-zero factors.' }
    }
    const center = pivot()
    if ('error' in center) return center
    return {
      transform: { type: 'scale', sx: factors[0], sy: factors[1], cx: center.cx, cy: center.cy },
    }
  }
  if (name === 'translate') {
    const shift = parsePair(step.params.shift)
    if (!shift) return { error: 'Translate needs shift: <dx>, <dy> numbers.' }
    return { transform: { type: 'translate', dx: shift[0], dy: shift[1] } }
  }
  if (name === 'mirror') {
    const axis = (step.params.axis ?? 'x').toLowerCase()
    if (axis !== 'x' && axis !== 'y') {
      return { error: 'Mirror needs axis: x (left-right) or axis: y (top-bottom).' }
    }
    return { transform: { type: 'mirror', axis, cx: centroid.cx, cy: centroid.cy } }
  }
  const blendRaw = step.params.blend
  if (blendRaw === undefined) {
    return { error: 'Blend needs blend: <second donor shape>, <0–1 factor>.' }
  }
  const segments = blendRaw.split(',')
  const factor = parseFiniteNumber(segments[segments.length - 1])
  const donorRef = segments
    .slice(0, -1)
    .join(',')
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .trim()
  if (!donorRef || factor === null || factor < 0 || factor > 1) {
    return { error: 'Blend needs blend: <second donor shape>, <0–1 factor>.' }
  }
  const donor = findShape(liveShapes, donorRef)
  if (!donor) {
    return {
      error: `Blend donor “${donorRef}” was not found on the target mesh — answer with an existing Shape id or name.`,
    }
  }
  return {
    transform: { type: 'blend', t: factor },
    donorVertices: donor.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  }
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'shape'
}

/** Mint a shape id that does not collide with live ids on the target mesh. */
export function mintShapeId(name: string, liveShapes: readonly ShapeStepLiveShape[]): string {
  const base = slugify(name)
  const taken = new Set(liveShapes.map((shape) => shape.id))
  if (!taken.has(base)) return base
  let counter = 2
  while (taken.has(`${base}-${counter}`)) counter += 1
  return `${base}-${counter}`
}

/**
 * Builds the reviewable AiAnimationAssetBatch operation for a parsed step.
 * Vertices are duplicated verbatim from the live source Shape, so the mesh
 * vertex count is preserved by construction — the model never authors
 * coordinates. Returns an error string instead of guessing when the node,
 * source, or target cannot be resolved live.
 */
export function buildShapeStepOperation(input: ShapeStepOperationInput): ShapeStepOperationResult {
  const { step, nodeId, liveShapes } = input
  if (step.action === 'delete') {
    const target = step.shape ? findShape(liveShapes, step.shape) : null
    if (!target) {
      return {
        error: `Shape “${step.shape ?? ''}” was not found on the target mesh — answer with an existing Shape id or name.`,
      }
    }
    return { operation: { kind: 'deleteShape', nodeId, shapeId: target.id }, summary: null }
  }
  const source = step.source ? findShape(liveShapes, step.source) : null
  if (!source) {
    return {
      error: `Source Shape “${step.source ?? ''}” was not found on the target mesh — answer with an existing Shape id or name from context.`,
    }
  }
  let vertices = source.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }))
  let summary: string | null = null
  if (step.transform !== null) {
    const resolved = resolveTransform(step, source.vertices, liveShapes)
    if ('error' in resolved) return resolved
    const applied = applyShapeTransform(source.vertices, resolved.transform, resolved.donorVertices)
    if ('error' in applied) return applied
    vertices = applied.vertices
    summary = describeShapeTransform(resolved.transform)
  }
  if (step.action === 'update') {
    const target = step.target ? findShape(liveShapes, step.target) : null
    if (!target) {
      return {
        error: `Target Shape “${step.target ?? ''}” was not found on the target mesh — answer with an existing Shape id.`,
      }
    }
    const name = step.name ?? target.name
    const conflict = liveShapes.find((shape) => shape.id !== target.id && shape.name === name)
    if (conflict) {
      return { error: `Shape name already exists: ${name} — ask for a different name.` }
    }
    return {
      operation: {
        kind: 'upsertShape',
        action: 'update',
        targetId: target.id,
        sourceShapeId: source.id,
        nodeId,
        shape: { id: target.id, name, vertices },
      },
      summary,
    }
  }
  const name = step.name ?? ''
  const conflict = liveShapes.find((shape) => shape.name === name)
  if (conflict) {
    return { error: `Shape name already exists: ${name} — ask for a different name.` }
  }
  return {
    operation: {
      kind: 'upsertShape',
      action: 'create',
      sourceShapeId: source.id,
      nodeId,
      shape: { id: mintShapeId(name, liveShapes), name, vertices },
    },
    summary,
  }
}
