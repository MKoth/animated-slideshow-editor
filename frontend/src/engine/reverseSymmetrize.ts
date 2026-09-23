import type { EnginePublic } from './engine'
import type { SceneNode } from './sceneNode'
import { walkPreOrder } from './sceneNode'
import type { InterpolationType, Keyframe, KeyframeTangent, KeyframeValue } from './keyframe'
import { ZERO_TANGENT } from './keyframe'
import type { Command } from './commands/command'
import { PasteKeyframesCommand } from './commands/pasteKeyframesCommand'
import { SetKeyframeInterpolationCommand } from './commands/setKeyframeInterpolationCommand'
import { SetKeyframeTangentsCommand } from './commands/setKeyframeTangentsCommand'
import { SetKeyframeValueCommand } from './commands/setKeyframeValueCommand'
import { keyframeAtTime } from './keyframeEdit'
import { swapLateralSemanticName } from './clipMirror'
import type { SymmetryAxis } from './symmetry'
import { mirroredVertex } from './symmetry'
import type { MeshVertex } from './mesh'
import type { Shape } from './shape'
import type { KeyframeTarget } from './keyframeTarget'

/**
 * Transform parameters mirrored as center-pose deltas: the mirrored value is
 * `targetPose(Center) ± (sourceValue(t) − sourcePose(Center))`, with the axis
 * component and rotation negated.
 */
export const REVERSE_SYMMETRIZE_DELTA_PROPERTIES = [
  'positionX',
  'positionY',
  'rotation',
  'scaleX',
  'scaleY',
] as const

export type ReverseSymmetrizeProperty = (typeof REVERSE_SYMMETRIZE_DELTA_PROPERTIES)[number]

/**
 * Channels copied verbatim in time (`value(t') = value(t)`): opacity and
 * zIndex are plain values, morph remaps its shape pair through the row's
 * shape mappings. Tangents are mirrored temporally (swap in/out, negate both).
 */
export const REVERSE_SYMMETRIZE_VERBATIM_CHANNELS = ['opacity', 'zIndex', 'morph'] as const

export type ReverseSymmetrizeVerbatimChannel = (typeof REVERSE_SYMMETRIZE_VERBATIM_CHANNELS)[number]

export const REVERSE_SYMMETRIZE_CHANNELS = [
  ...REVERSE_SYMMETRIZE_DELTA_PROPERTIES,
  ...REVERSE_SYMMETRIZE_VERBATIM_CHANNELS,
] as const

export type ReverseSymmetrizeChannel = (typeof REVERSE_SYMMETRIZE_CHANNELS)[number]

const TRANSFORM_KEY: Record<
  ReverseSymmetrizeProperty,
  'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'
> = {
  positionX: 'x',
  positionY: 'y',
  rotation: 'rotation',
  scaleX: 'scaleX',
  scaleY: 'scaleY',
}

const EPSILON = 1e-9
const GEOMETRY_EPSILON = 1e-6

/** Reflection negates the position component on the mirror axis and always negates rotation. */
export function mirrorFlipsProperty(
  property: ReverseSymmetrizeProperty,
  axis: SymmetryAxis,
): boolean {
  if (property === 'rotation') return true
  if (axis === 'x') return property === 'positionX'
  return property === 'positionY'
}

function isDeltaProperty(channel: ReverseSymmetrizeChannel): channel is ReverseSymmetrizeProperty {
  return channel !== 'opacity' && channel !== 'zIndex' && channel !== 'morph'
}

/** Keyframes of one mirrored channel for a node. */
export function reverseSymmetrizeKeyframes(
  engine: EnginePublic,
  nodeId: string,
  channel: ReverseSymmetrizeChannel,
): readonly Keyframe[] {
  if (channel === 'zIndex') return engine.getZIndexKeyframes(nodeId)
  if (channel === 'morph') return engine.getMorphKeyframes(nodeId)
  return engine.getKeyframes(nodeId, channel)
}

function channelTarget(nodeId: string, channel: ReverseSymmetrizeChannel): KeyframeTarget {
  if (channel === 'zIndex') return { kind: 'zIndex', nodeId }
  if (channel === 'morph') return { kind: 'morph', nodeId }
  return { kind: 'node', nodeId, property: channel }
}

function nodeHasMirrorableKeyframes(engine: EnginePublic, nodeId: string): boolean {
  for (const channel of REVERSE_SYMMETRIZE_CHANNELS) {
    if (reverseSymmetrizeKeyframes(engine, nodeId, channel).length > 0) return true
  }
  return false
}

/**
 * True when the subtree carries any keyframe on a mirrored channel, or when a
 * guessed sibling of one of its nodes does — pairs exchange keys in both
 * directions, so a static node with an animated sibling is still mirrorable.
 */
export function hasMirrorableKeyframes(engine: EnginePublic, rootNodeId: string): boolean {
  try {
    const root = engine.getNode(rootNodeId)
    const slide = engine.getActiveSlide()
    if (!slide || !slide.scene.getNode(root.id)) return false
    for (const node of walkPreOrder(root)) {
      if (nodeHasMirrorableKeyframes(engine, node.id)) return true
      const sibling = guessSymmetrySibling(engine, node.id)
      if (sibling && nodeHasMirrorableKeyframes(engine, sibling.id)) return true
    }
    return false
  } catch {
    return false
  }
}

function lateralKeys(node: SceneNode): string[] {
  const keys: string[] = []
  if (node.semanticName) keys.push(node.semanticName.trim().toLowerCase())
  keys.push(node.name.trim().toLowerCase())
  return keys.filter((key) => key !== '')
}

/**
 * Guess a node's symmetrical sibling by name/semantic name, using the lateral
 * `left`↔`right` swap. Same-parent matches win over scene-wide ones.
 */
export function guessSymmetrySibling(engine: EnginePublic, nodeId: string): SceneNode | null {
  let node: SceneNode
  try {
    node = engine.getNode(nodeId)
  } catch {
    return null
  }
  const slide = engine.getActiveSlide()
  if (!slide) return null
  const swapped = new Set<string>()
  for (const key of lateralKeys(node)) {
    const mirror = swapLateralSemanticName(key)
    if (mirror !== key) swapped.add(mirror)
  }
  if (swapped.size === 0) return null
  let fallback: SceneNode | null = null
  for (const candidate of walkPreOrder(slide.scene.root)) {
    if (candidate.id === node.id || candidate.components.camera) continue
    if (!lateralKeys(candidate).some((key) => swapped.has(key))) continue
    if (candidate.parent?.id === node.parent?.id) return candidate
    if (!fallback) fallback = candidate
  }
  return fallback
}

// --- Morph shape guessing -------------------------------------------------

const VERTICAL_TOKEN_SWAPS: Readonly<Record<string, string>> = {
  up: 'down',
  down: 'up',
  top: 'bottom',
  bottom: 'top',
}

function swapVerticalToken(token: string): string {
  const target = VERTICAL_TOKEN_SWAPS[token.toLowerCase()]
  if (target === undefined) return token
  if (token === token.toUpperCase()) return target.toUpperCase()
  if (
    token.length > 0 &&
    token[0] === token[0]!.toUpperCase() &&
    token.slice(1) === token.slice(1).toLowerCase()
  ) {
    return target[0]!.toUpperCase() + target.slice(1)
  }
  return target
}

function escapeRegExpLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Swap delimiter-prefixed vertical markers (`_U`/`_D`, `_T`/`_B`, `.U`/`.D`,
 * `.T`/`.B`) only when not followed by a letter, so `_Torso` stays intact.
 */
function swapVerticalDelimitedMarker(source: string, delimiter: '_' | '.'): string {
  const d = escapeRegExpLiteral(delimiter)
  const pattern = new RegExp(`${d}([UDTB])(?![A-Za-z])`, 'g')
  return source.replace(pattern, (_match, letter: string) => {
    const swaps: Readonly<Record<string, string>> = { U: 'D', D: 'U', T: 'B', B: 'T' }
    return `${delimiter}${swaps[letter] ?? letter}`
  })
}

/**
 * Vertical counterpart of {@link swapLateralSemanticName}: swaps the
 * `up`/`down` and `top`/`bottom` words (lower/Capitalized/UPPER, camelCase
 * aware) plus the delimited `_U`/`_D`, `_T`/`_B`, `.U`/`.D`, `.T`/`.B`
 * markers, leaving anything else untouched.
 */
export function swapVerticalSemanticName(name: string): string {
  let result = swapVerticalDelimitedMarker(name, '_')
  result = swapVerticalDelimitedMarker(result, '.')
  return result
    .split(/([_.\-\s]+)/g)
    .map((part) => {
      if (part === '' || /^[_.\-\s]+$/.test(part)) return part
      return part
        .split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
        .map(swapVerticalToken)
        .join('')
    })
    .join('')
}

/** Axis-aware semantic name swap: lateral on X, vertical on Y. */
export function swapSymmetrySemanticName(name: string, axis: SymmetryAxis): string {
  return axis === 'x' ? swapLateralSemanticName(name) : swapVerticalSemanticName(name)
}

function readShapes(engine: EnginePublic, nodeId: string): readonly Shape[] {
  try {
    return engine.getShapes(nodeId)
  } catch {
    return []
  }
}

function verticesMatch(a: readonly MeshVertex[], b: readonly MeshVertex[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i]!
    const vb = b[i]!
    if (Math.abs(va.x - vb.x) > GEOMETRY_EPSILON || Math.abs(va.y - vb.y) > GEOMETRY_EPSILON) {
      return false
    }
  }
  return true
}

/** Whether `candidate` is the spatial mirror of `source` across the axis. */
function isMirroredCopyOf(source: Shape, candidate: Shape, axis: SymmetryAxis): boolean {
  if (source.vertices.length !== candidate.vertices.length) return false
  for (let i = 0; i < source.vertices.length; i += 1) {
    const mirrored = mirroredVertex(source.vertices[i]!, axis)
    const candidateVertex = candidate.vertices[i]!
    if (
      Math.abs(mirrored.x - candidateVertex.x) > GEOMETRY_EPSILON ||
      Math.abs(mirrored.y - candidateVertex.y) > GEOMETRY_EPSILON
    ) {
      return false
    }
  }
  return true
}

/** Same-category matches win over cross-category ones when several candidates qualify. */
function pickCandidate(
  source: Shape,
  candidates: readonly Shape[],
  predicate: (candidate: Shape) => boolean,
): Shape | null {
  const matches = candidates.filter(predicate)
  if (matches.length === 0) return null
  return (
    matches.find((candidate) => (candidate.categoryId ?? null) === (source.categoryId ?? null)) ??
    matches[0] ??
    null
  )
}

/**
 * Guess the symmetrical counterpart of a shape on the target node. Mirrored
 * geometry (a symmetrically duplicated shape) is preferred; the name swap
 * (`left`↔`right` on X, `up`↔`down`/`top`↔`bottom` on Y) is the fallback;
 * absolute copies (same geometry, then same name) are tried last. In self mode
 * the source shape itself is never a candidate.
 */
export function guessSymmetricalShape(
  source: Shape,
  targetShapes: readonly Shape[],
  axis: SymmetryAxis,
  self: boolean,
): Shape | null {
  const candidates = self ? targetShapes.filter((shape) => shape.id !== source.id) : targetShapes
  const mirrored = pickCandidate(source, candidates, (candidate) =>
    isMirroredCopyOf(source, candidate, axis),
  )
  if (mirrored) return mirrored
  const swappedName = swapSymmetrySemanticName(source.name, axis)
  if (swappedName !== source.name) {
    const bySwappedName = pickCandidate(
      source,
      candidates,
      (candidate) => candidate.name === swappedName,
    )
    if (bySwappedName) return bySwappedName
  }
  const exactGeometry = pickCandidate(source, candidates, (candidate) =>
    verticesMatch(source.vertices, candidate.vertices),
  )
  if (exactGeometry) return exactGeometry
  return pickCandidate(source, candidates, (candidate) => candidate.name === source.name)
}

function distinctMorphShapeIds(keyframes: readonly Keyframe[]): readonly string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id: unknown): void => {
    if (typeof id !== 'string' || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const keyframe of keyframes) {
    const value = keyframe.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const record = value as unknown as Record<string, unknown>
    if (!('fromShapeId' in record || 'toShapeId' in record)) continue
    add(record.fromShapeId)
    add(record.toShapeId)
  }
  return ids
}

export interface MorphShapeMappingGuess {
  readonly sourceShapeId: string
  readonly sourceShapeName: string | null
  readonly targetShapeId: string | null
}

/**
 * Guess a target shape for every shape referenced by the source node's morph
 * keyframes. `targetNodeId` is the sibling, or the source itself for self
 * mirroring.
 */
export function guessMorphShapeMappings(
  engine: EnginePublic,
  sourceNodeId: string,
  targetNodeId: string,
  axis: SymmetryAxis,
): readonly MorphShapeMappingGuess[] {
  const sourceShapes = readShapes(engine, sourceNodeId)
  const targetShapes = readShapes(engine, targetNodeId)
  const self = sourceNodeId === targetNodeId
  return distinctMorphShapeIds(engine.getMorphKeyframes(sourceNodeId)).map((shapeId) => {
    const sourceShape = sourceShapes.find((shape) => shape.id === shapeId)
    if (!sourceShape) {
      return { sourceShapeId: shapeId, sourceShapeName: null, targetShapeId: null }
    }
    const guess = guessSymmetricalShape(sourceShape, targetShapes, axis, self)
    return {
      sourceShapeId: shapeId,
      sourceShapeName: sourceShape.name,
      targetShapeId: guess ? guess.id : null,
    }
  })
}

// --- Planning -------------------------------------------------------------

export interface ReverseSymmetrizeShapeMapping {
  readonly sourceShapeId: string
  readonly targetShapeId: string
}

export interface ReverseSymmetrizeRow {
  readonly sourceNodeId: string
  /** `null` mirrors the source onto itself (no symmetrical sibling). */
  readonly targetNodeId: string | null
  /**
   * Explicit morph shape remaps. When omitted, morph shape ids are copied
   * as-is (self mirroring); when present, sibling rows require a mapping for
   * every referenced shape.
   */
  readonly shapeMappings?: readonly ReverseSymmetrizeShapeMapping[]
}

export interface ReverseSymmetrizeRequest {
  readonly rootNodeId: string
  readonly centerTime: number
  readonly axis: SymmetryAxis
  readonly from: number
  readonly to: number
  readonly rows: readonly ReverseSymmetrizeRow[]
}

export interface ReverseSymmetrizeRowSummary {
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly sourceName: string
  readonly targetName: string
  readonly self: boolean
  readonly keyframesInRange: number
  readonly droppedOutOfRange: number
}

export interface ReverseSymmetrizeSummary {
  readonly rows: readonly ReverseSymmetrizeRowSummary[]
  readonly added: number
  readonly updated: number
  readonly unchanged: number
  readonly droppedOutOfRange: number
}

export interface ReverseSymmetrizePlan {
  readonly commands: readonly Command<unknown>[]
  readonly summary: ReverseSymmetrizeSummary
  readonly warnings: readonly string[]
}

interface PlannedKeyframe {
  readonly targetNodeId: string
  readonly channel: ReverseSymmetrizeChannel
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
  readonly existingKeyframeId: string | null
  readonly existingValue: KeyframeValue | null
  readonly existingInterpolation: InterpolationType | null
  readonly existingTangentIn: KeyframeTangent | null
  readonly existingTangentOut: KeyframeTangent | null
}

function requireFiniteTime(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * Temporal reflection (`t' = 2c − t`) swaps and negates both tangent
 * components; the spatial reflection then negates the value component only
 * when the property flips. Verbatim channels pass `flip = false`, which
 * negates the value component purely temporally (same as clip reversal).
 */
function mirrorTangents(
  keyframe: Keyframe,
  flip: boolean,
): { tangentIn: KeyframeTangent; tangentOut: KeyframeTangent } {
  const map = (tangent: KeyframeTangent): KeyframeTangent => ({
    time: normalizeZero(-tangent.time),
    value: normalizeZero(flip ? tangent.value : -tangent.value),
  })
  return { tangentIn: map(keyframe.tangentOut), tangentOut: map(keyframe.tangentIn) }
}

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}

function tangentsEqual(a: KeyframeTangent, b: KeyframeTangent): boolean {
  return numbersEqual(a.time, b.time) && numbersEqual(a.value, b.value)
}

interface MorphValueParts {
  readonly fromShapeId: string | null
  readonly toShapeId: string | null
  readonly coefficient: number
}

function morphValueParts(value: KeyframeValue): MorphValueParts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as unknown as Record<string, unknown>
  if (typeof record.coefficient !== 'number') return null
  if (!('fromShapeId' in record || 'toShapeId' in record)) return null
  return {
    fromShapeId: typeof record.fromShapeId === 'string' ? record.fromShapeId : null,
    toShapeId: typeof record.toShapeId === 'string' ? record.toShapeId : null,
    coefficient: record.coefficient,
  }
}

function keyframeValuesEqual(a: KeyframeValue, b: KeyframeValue): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    return typeof a === 'number' && typeof b === 'number' && numbersEqual(a, b)
  }
  const partsA = morphValueParts(a)
  const partsB = morphValueParts(b)
  if (partsA && partsB) {
    return (
      partsA.fromShapeId === partsB.fromShapeId &&
      partsA.toShapeId === partsB.toShapeId &&
      numbersEqual(partsA.coefficient, partsB.coefficient)
    )
  }
  return a === b
}

interface MorphRemap {
  readonly value: KeyframeValue
  readonly missing: readonly string[]
}

/**
 * Remap a morph keyframe value's shape ids through the row mappings. Null ids
 * (legacy scalar bindings) and non-morph values pass through; `missing`
 * collects every non-null id without a mapping.
 */
function remapMorphValue(value: KeyframeValue, mappings: ReadonlyMap<string, string>): MorphRemap {
  const parts = morphValueParts(value)
  if (!parts) return { value, missing: [] }
  const missing: string[] = []
  const remapId = (id: string | null): string | null => {
    if (id === null) return null
    const mapped = mappings.get(id)
    if (mapped === undefined) {
      missing.push(id)
      return id
    }
    return mapped
  }
  const fromShapeId = remapId(parts.fromShapeId)
  const toShapeId = remapId(parts.toShapeId)
  return {
    value: { fromShapeId, toShapeId, coefficient: parts.coefficient },
    missing,
  }
}

function morphValueReferencesShapes(value: KeyframeValue): boolean {
  const parts = morphValueParts(value)
  return parts !== null && (parts.fromShapeId !== null || parts.toShapeId !== null)
}

/**
 * Build one undoable transaction that mirrors every selected source keyframe
 * about the center time onto its target (a sibling or the source itself).
 *
 * Transform channels reflect the delta against the pose both nodes hold at
 * the center time; opacity, zIndex, and morph are copied verbatim in time
 * (morph with its shape pair remapped through the row's `shapeMappings`).
 *
 * New keyframes are inserted with {@link PasteKeyframesCommand} so their
 * interpolation and tangents survive; existing keyframes at mirrored times are
 * overwritten in place.
 */
export function buildReverseSymmetrizeCommands(
  engine: EnginePublic,
  request: ReverseSymmetrizeRequest,
): ReverseSymmetrizePlan {
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('No active slide to reverse symmetrize on')
  const { centerTime, from, to, axis } = request
  requireFiniteTime(centerTime, 'Center time')
  requireFiniteTime(from, 'From time')
  requireFiniteTime(to, 'To time')
  if (from > to) throw new Error('From time must be less than or equal to To time')
  if (centerTime < 0 || centerTime > slide.duration) {
    throw new Error(`Center time must be within [0, ${slide.duration}]`)
  }
  const root = engine.getNode(request.rootNodeId)
  if (!slide.scene.getNode(root.id)) {
    throw new Error(`"${root.name}" is not on the active slide`)
  }

  const planned = new Map<string, PlannedKeyframe>()
  const rowSummaries: ReverseSymmetrizeRowSummary[] = []
  const warnings: string[] = []
  let droppedOutOfRange = 0

  for (const row of request.rows) {
    const source = engine.getNode(row.sourceNodeId)
    if (!slide.scene.getNode(source.id)) {
      throw new Error(`"${source.name}" is not on the active slide`)
    }
    const self = row.targetNodeId === null || row.targetNodeId === source.id
    const target = self ? source : engine.getNode(row.targetNodeId as string)
    if (!slide.scene.getNode(target.id)) {
      throw new Error(`"${target.name}" is not on the active slide`)
    }
    if (target.components.camera) {
      throw new Error(`Camera "${target.name}" cannot be reverse symmetrized`)
    }

    const sourceCenter = engine.evaluateNode(source.id, centerTime).transform
    const targetCenter = self ? sourceCenter : engine.evaluateNode(target.id, centerTime).transform
    const mappings = new Map(
      (row.shapeMappings ?? []).map((mapping) => [mapping.sourceShapeId, mapping.targetShapeId]),
    )
    const sourceShapeNames = new Map(
      readShapes(engine, source.id).map((shape) => [shape.id, shape.name]),
    )
    const shapeLabel = (shapeId: string): string => sourceShapeNames.get(shapeId) ?? shapeId

    let keyframesInRange = 0
    let rowDropped = 0

    for (const channel of REVERSE_SYMMETRIZE_CHANNELS) {
      const keyframes = reverseSymmetrizeKeyframes(engine, source.id, channel)
      if (keyframes.length === 0) continue
      const active = keyframes.filter(
        (keyframe) => !keyframe.disabled && keyframe.time >= from && keyframe.time <= to,
      )
      keyframesInRange += active.length
      if (active.length === 0) continue
      const deltaProperty = isDeltaProperty(channel) ? channel : null
      const flip = deltaProperty ? mirrorFlipsProperty(deltaProperty, axis) : false
      // Mirroring a node onto itself leaves non-flipped transform channels untouched.
      if (self && deltaProperty && !flip) continue
      if (channel === 'opacity' && target.components.bone) {
        throw new Error(`Bone "${target.name}" cannot animate opacity`)
      }
      const targetKeyframes = reverseSymmetrizeKeyframes(engine, target.id, channel)

      for (const keyframe of active) {
        const mirroredTime = 2 * centerTime - keyframe.time
        if (mirroredTime < 0 || mirroredTime > slide.duration) {
          rowDropped += 1
          droppedOutOfRange += 1
          continue
        }

        let value: KeyframeValue
        if (deltaProperty) {
          if (typeof keyframe.value !== 'number') continue
          const sourceCenterValue = sourceCenter[TRANSFORM_KEY[deltaProperty]]
          const targetCenterValue = targetCenter[TRANSFORM_KEY[deltaProperty]]
          const delta = keyframe.value - sourceCenterValue
          value = targetCenterValue + (flip ? -delta : delta)
        } else if (channel === 'morph') {
          if (row.shapeMappings === undefined) {
            if (!self && morphValueReferencesShapes(keyframe.value)) {
              throw new Error(
                `Shape mappings are required to mirror morph keyframes from "${source.name}" onto "${target.name}"`,
              )
            }
            value = keyframe.value
          } else {
            const remapped = remapMorphValue(keyframe.value, mappings)
            if (remapped.missing.length > 0) {
              if (!self) {
                throw new Error(
                  `Shape "${shapeLabel(remapped.missing[0]!)}" has no symmetrical counterpart on "${target.name}"`,
                )
              }
              warnings.push(
                `Shape "${shapeLabel(remapped.missing[0]!)}" has no symmetrical counterpart on "${source.name}" — morph keyframes referencing it were copied as-is`,
              )
              value = keyframe.value
            } else {
              value = remapped.value
            }
          }
        } else {
          value = keyframe.value
        }

        const interpolation = channel === 'zIndex' ? 'hold' : keyframe.interpolation
        const tangents =
          channel === 'zIndex'
            ? { tangentIn: ZERO_TANGENT, tangentOut: ZERO_TANGENT }
            : mirrorTangents(keyframe, flip)
        const existing = keyframeAtTime(targetKeyframes, mirroredTime)
        planned.set(`${target.id}|${channel}|${mirroredTime}`, {
          targetNodeId: target.id,
          channel,
          time: mirroredTime,
          value,
          interpolation,
          tangentIn: tangents.tangentIn,
          tangentOut: tangents.tangentOut,
          existingKeyframeId: existing ? existing.id : null,
          existingValue: existing ? existing.value : null,
          existingInterpolation: existing ? existing.interpolation : null,
          existingTangentIn: existing ? existing.tangentIn : null,
          existingTangentOut: existing ? existing.tangentOut : null,
        })
      }
    }

    rowSummaries.push({
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceName: source.name,
      targetName: target.name,
      self,
      keyframesInRange,
      droppedOutOfRange: rowDropped,
    })
    if (keyframesInRange === 0) {
      warnings.push(`"${source.name}" has no keyframes in [${from}, ${to}]`)
    }
  }

  const groups = new Map<string, PlannedKeyframe[]>()
  for (const entry of planned.values()) {
    const key = `${entry.targetNodeId}|${entry.channel}`
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }

  const commands: Command<unknown>[] = []
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const key of [...groups.keys()].sort()) {
    const entries = groups.get(key)!.sort((a, b) => a.time - b.time)
    const first = entries[0]!
    const target = channelTarget(first.targetNodeId, first.channel)

    const fresh = entries.filter((entry) => entry.existingKeyframeId === null)
    if (fresh.length > 0) {
      commands.push(
        new PasteKeyframesCommand({
          target,
          payload: {
            keyframes: fresh.map((entry) => ({
              time: entry.time,
              value: entry.value,
              interpolation: entry.interpolation,
              tangentIn: entry.tangentIn,
              tangentOut: entry.tangentOut,
            })),
          },
          atTime: 0,
        }),
      )
      added += fresh.length
    }

    for (const entry of entries) {
      if (entry.existingKeyframeId === null) continue
      const valueDiffers =
        entry.existingValue === null || !keyframeValuesEqual(entry.existingValue, entry.value)
      const interpolationDiffers = entry.existingInterpolation !== entry.interpolation
      const tangentIn = entry.existingTangentIn
      const tangentOut = entry.existingTangentOut
      const tangentsDiffer =
        entry.interpolation === 'bezier' &&
        (!tangentIn ||
          !tangentOut ||
          !tangentsEqual(tangentIn, entry.tangentIn) ||
          !tangentsEqual(tangentOut, entry.tangentOut))
      if (valueDiffers) {
        commands.push(
          new SetKeyframeValueCommand({
            target,
            keyframeId: entry.existingKeyframeId,
            newValue: entry.value,
          }),
        )
      }
      if (interpolationDiffers) {
        commands.push(
          new SetKeyframeInterpolationCommand({
            target,
            keyframeId: entry.existingKeyframeId,
            interpolation: entry.interpolation,
          }),
        )
      }
      if (tangentsDiffer) {
        commands.push(
          new SetKeyframeTangentsCommand({
            target,
            keyframeId: entry.existingKeyframeId,
            tangentIn: entry.tangentIn,
            tangentOut: entry.tangentOut,
          }),
        )
      }
      if (valueDiffers || interpolationDiffers || tangentsDiffer) updated += 1
      else unchanged += 1
    }
  }

  if (droppedOutOfRange > 0) {
    warnings.push(
      `${droppedOutOfRange} mirrored keyframe(s) fall outside [0, ${slide.duration}] and were skipped`,
    )
  }

  return {
    commands,
    summary: {
      rows: rowSummaries,
      added,
      updated,
      unchanged,
      droppedOutOfRange,
    },
    warnings: [...new Set(warnings)],
  }
}
