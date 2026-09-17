import type { AnimationProperty, CircleAnimationProperty } from './animationProperties'
import { ANIMATABLE_PROPERTIES, CIRCLE_ANIMATABLE_PROPERTIES } from './animationProperties'
import type { Keyframe, KeyframeTangent, InterpolationType, KeyframeValue } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId, ZERO_TANGENT } from './keyframe'
import type { KeyframeTarget } from './keyframeTarget'
import { requireSymmetryKeyframeValue } from './symmetry'
import { SHADOW_PROPERTIES } from './shadowEffect'
import type { ShadowProperty } from './shadowEffect'
import type { SceneNode } from './sceneNode'

export interface ExtractableKeyframe {
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
  readonly keyframeId: string
}

export interface NormalizedKeyframe {
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
  readonly originalId: string
}

export interface ExtractionBounds {
  readonly selStart: number
  readonly selEnd: number
  readonly selDuration: number
  readonly clipDuration: number
}

export function computeExtractionBounds(
  keyframes: readonly ExtractableKeyframe[],
): ExtractionBounds {
  if (keyframes.length === 0) {
    throw new Error('At least one keyframe is required for extraction')
  }
  let selStart = Infinity
  let selEnd = -Infinity
  for (const kf of keyframes) {
    if (kf.time < selStart) selStart = kf.time
    if (kf.time > selEnd) selEnd = kf.time
  }
  const selDuration = selEnd - selStart
  const clipDuration = selDuration > 1e-9 ? selDuration : 1
  return { selStart, selEnd, selDuration, clipDuration }
}

export function normalizeExtractable(
  kf: ExtractableKeyframe,
  bounds: ExtractionBounds,
): NormalizedKeyframe {
  const { selStart, selDuration } = bounds
  const normalizedTime = selDuration > 1e-9 ? (kf.time - selStart) / selDuration : 0

  // Tangent time offsets are normalized by the same duration factor (time units)
  const tangentIn: KeyframeTangent = {
    time: selDuration > 1e-9 ? kf.tangentIn.time / selDuration : kf.tangentIn.time,
    value: kf.tangentIn.value,
  }
  const tangentOut: KeyframeTangent = {
    time: selDuration > 1e-9 ? kf.tangentOut.time / selDuration : kf.tangentOut.time,
    value: kf.tangentOut.value,
  }

  // Value normalization: where applicable, map to [0,1]. For now, values are copied
  // verbatim — opacity already lives in [0,1], visible is boolean, circle angles
  // and scales are absolute. Validation below ensures opacity stays in [0,1].
  const normalizedValue = kf.value

  // Validate normalized time [0,1]
  if (normalizedTime < -1e-9 || normalizedTime > 1 + 1e-9) {
    throw new Error(`Normalized time ${normalizedTime} out of [0,1] for keyframe ${kf.keyframeId}`)
  }
  const clampedTime = Math.min(Math.max(normalizedTime, 0), 1)

  // Validate value where applicable (opacity, morph, shadow)
  if (isOpacityTarget(kf.target)) {
    const v = normalizedValue as number
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9) {
      throw new Error(`Clip keyframe value for opacity must be within [0,1], got ${String(v)}`)
    }
  }
  if (isZIndexTarget(kf.target)) {
    const v = normalizedValue as number
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Clip keyframe value for zIndex must be a finite number, got ${String(v)}`)
    }
  }
  if (isMorphTarget(kf.target)) {
    const v = normalizedValue as unknown
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9) {
        throw new Error(
          `Clip keyframe value for morphCoefficient must be within [0,1], got ${String(v)}`,
        )
      }
    } else if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>
      const coeff = r.coefficient
      if (
        typeof coeff !== 'number' ||
        !Number.isFinite(coeff) ||
        coeff < -1e-9 ||
        coeff > 1 + 1e-9
      ) {
        throw new Error(
          `Clip morph keyframe coefficient must be within [0,1], got ${String(coeff)}`,
        )
      }
      if (
        r.fromShapeId !== undefined &&
        r.fromShapeId !== null &&
        typeof r.fromShapeId !== 'string'
      ) {
        throw new Error(`Morph clip keyframe fromShapeId must be string or null`)
      }
      if (r.toShapeId !== undefined && r.toShapeId !== null && typeof r.toShapeId !== 'string') {
        throw new Error(`Morph clip keyframe toShapeId must be string or null`)
      }
      if (
        r.fromShapeName !== undefined &&
        r.fromShapeName !== null &&
        typeof r.fromShapeName !== 'string'
      ) {
        throw new Error(`Morph clip keyframe fromShapeName must be string or null`)
      }
      if (
        r.toShapeName !== undefined &&
        r.toShapeName !== null &&
        typeof r.toShapeName !== 'string'
      ) {
        throw new Error(`Morph clip keyframe toShapeName must be string or null`)
      }
      for (const field of ['fromCategoryPath', 'toCategoryPath'] as const) {
        const p = r[field]
        if (p !== undefined && p !== null) {
          if (!Array.isArray(p) || p.some((s) => typeof s !== 'string' || s.length === 0)) {
            throw new Error(`Morph clip keyframe ${field} must be string[] or null`)
          }
        }
      }
    } else {
      throw new Error(`Morph keyframe value must be number or object`)
    }
  }
  if (kf.target.kind === 'symmetry') {
    requireSymmetryKeyframeValue(kf.value, 'Clip symmetry keyframe value')
  }
  if (isShadowTarget(kf.target)) {
    const prop = (kf.target as { property: string }).property
    const v = normalizedValue
    if (prop === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) {
        throw new Error(`Clip shadow keyframe color must be hex #rrggbb, got ${String(v)}`)
      }
    } else if (prop === 'opacity') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9) {
        throw new Error(`Clip shadow keyframe opacity must be within [0,1], got ${String(v)}`)
      }
    } else if (prop === 'blur') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1e-9) {
        throw new Error(
          `Clip shadow keyframe blur must be a non-negative finite number, got ${String(v)}`,
        )
      }
    } else if (prop === 'lightAzimuth') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(
          `Clip shadow keyframe lightAzimuth must be a finite number, got ${String(v)}`,
        )
      }
    } else if (prop === 'lightElevation') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1e-9 || v > 90 + 1e-9) {
        throw new Error(
          `Clip shadow keyframe lightElevation must be within [0,90], got ${String(v)}`,
        )
      }
    } else if (prop === 'lightDistance') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1e-9 || v > 400 + 1e-9) {
        throw new Error(
          `Clip shadow keyframe lightDistance must be within [0,400], got ${String(v)}`,
        )
      }
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Clip shadow keyframe ${prop} must be a finite number, got ${String(v)}`)
      }
    }
  }

  return {
    target: kf.target,
    time: clampedTime,
    value: normalizedValue,
    interpolation: kf.interpolation,
    tangentIn,
    tangentOut,
    originalId: kf.keyframeId,
  }
}

function isOpacityTarget(target: KeyframeTarget): boolean {
  return target.kind === 'node' && 'property' in target && target.property === 'opacity'
}

function isMorphTarget(target: KeyframeTarget): boolean {
  return target.kind === 'morph'
}

function isShadowTarget(target: KeyframeTarget): boolean {
  return target.kind === 'shadow'
}

function isZIndexTarget(target: KeyframeTarget): boolean {
  return target.kind === 'zIndex'
}

export type NormalizedChannelKey =
  | { kind: 'property'; property: AnimationProperty }
  | { kind: 'visible'; nodeId: string } // visible is per-node but clip's visible is global; we merge all visible into one clip visible track
  | { kind: 'zIndex' } // zIndex is per-node but clip's zIndex is global; merged like visible
  | { kind: 'circle'; property: CircleAnimationProperty }
  | { kind: 'parameter'; parameter: string; nodeId: string }
  | { kind: 'dataLabel'; label: string }
  | { kind: 'table'; property: import('./animationProperties').TableAnimationProperty }
  | { kind: 'morph' }
  | { kind: 'symmetry' }
  | { kind: 'shadow'; property: import('./shadowEffect').ShadowProperty }

export function channelKeyOf(target: KeyframeTarget): string {
  if (target.kind === 'shadow') {
    return `shadow:${target.property}`
  }
  if (target.kind === 'node') {
    if ('property' in target) {
      return `property:${target.property}`
    }
    if ('parameter' in target) {
      return `parameter:${target.parameter}`
    }
  }
  if (target.kind === 'visible') {
    return `visible`
  }
  if (target.kind === 'zIndex') {
    return `zIndex`
  }
  if (target.kind === 'morph') {
    return `morph`
  }
  if (target.kind === 'symmetry') {
    return `symmetry`
  }
  if (target.kind === 'circle') {
    return `circle:${target.property}`
  }
  if (target.kind === 'dataLabel') {
    return `dataLabel:${target.label}`
  }
  if (target.kind === 'table') {
    return `table:${target.property}`
  }
  if (target.kind === 'clip') {
    return `clip:${target.channel}`
  }
  return `unknown:${JSON.stringify(target)}`
}

export function groupNormalizedByChannel(
  normalized: readonly NormalizedKeyframe[],
): Map<string, NormalizedKeyframe[]> {
  const groups = new Map<string, NormalizedKeyframe[]>()
  for (const nk of normalized) {
    const key = channelKeyOf(nk.target)
    const arr = groups.get(key)
    if (arr) {
      arr.push(nk)
    } else {
      groups.set(key, [nk])
    }
  }
  // Sort each group by time
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.time - b.time)
  }
  return groups
}

export interface ExistingCollision {
  readonly key: string
  readonly time: number
}

const roundTime = (t: number): number => Math.round(t * 1e9) / 1e9

/**
 * Structural clip surface needed to read existing keyframe times per channel.
 * Compatible with ClipDefinition.
 */
export interface ClipTimeSource {
  getChannelKeyframes(property: AnimationProperty): readonly { time: number }[]
  getShadowChannelKeyframes(property: ShadowProperty): readonly { time: number }[]
  getVisibleKeyframes(): readonly { time: number }[]
  getZIndexKeyframes(): readonly { time: number }[]
  getMorphKeyframes(): readonly { time: number }[]
  getSymmetryKeyframes(): readonly { time: number }[]
  getCircleKeyframes(property: CircleAnimationProperty): readonly { time: number }[]
  getMaterialChannelKeyframes(parameter: string): readonly { time: number }[]
}

/**
 * Collect existing clip keyframe times per normalized channel key present in
 * `groups`. Keys with no existing keyframes are omitted.
 */
export function collectExistingTimesForGroups(
  clip: ClipTimeSource,
  groups: Map<string, NormalizedKeyframe[]>,
): Map<string, readonly number[]> {
  const existingTimesByKey = new Map<string, readonly number[]>()
  for (const [key, arr] of groups) {
    const nkTarget = arr[0].target
    let existing: readonly number[] | undefined
    if (nkTarget.kind === 'shadow') {
      existing = clip.getShadowChannelKeyframes(nkTarget.property).map((k) => k.time)
    } else if (nkTarget.kind === 'node' && 'property' in nkTarget) {
      existing = clip.getChannelKeyframes(nkTarget.property).map((k) => k.time)
    } else if (nkTarget.kind === 'visible') {
      existing = clip.getVisibleKeyframes().map((k) => k.time)
    } else if (nkTarget.kind === 'zIndex') {
      existing = clip.getZIndexKeyframes().map((k) => k.time)
    } else if (nkTarget.kind === 'morph') {
      existing = clip.getMorphKeyframes().map((k) => k.time)
    } else if (nkTarget.kind === 'symmetry') {
      existing = clip.getSymmetryKeyframes().map((k) => k.time)
    } else if (nkTarget.kind === 'circle') {
      existing = clip.getCircleKeyframes(nkTarget.property).map((k) => k.time)
    } else if (nkTarget.kind === 'node' && 'parameter' in nkTarget) {
      existing = clip.getMaterialChannelKeyframes(nkTarget.parameter).map((k) => k.time)
    } else if (nkTarget.kind === 'table') {
      // table not stored in clips — no existing check
    }
    if (existing && existing.length > 0) {
      existingTimesByKey.set(key, existing)
    }
  }
  return existingTimesByKey
}

/**
 * List every incoming keyframe that lands on an existing clip keyframe time
 * (same channel, 1e-9 rounded equality). Used for the Replace/Keep dialog and
 * by validateNoDuplicateTimes.
 */
export function findExistingCollisions(
  groups: Map<string, NormalizedKeyframe[]>,
  existingTimesByKey: Map<string, readonly number[]>,
): ExistingCollision[] {
  const out: ExistingCollision[] = []
  for (const [key, keyframes] of groups) {
    const existing = existingTimesByKey.get(key)
    if (!existing) continue
    const roundedExisting = new Set(existing.map(roundTime))
    for (const kf of keyframes) {
      if (roundedExisting.has(roundTime(kf.time))) {
        out.push({ key, time: kf.time })
      }
    }
  }
  return out
}

export function validateNoDuplicateTimes(
  groups: Map<string, NormalizedKeyframe[]>,
  // Existing times per channel for append validation
  existingTimesByKey?: Map<string, readonly number[]>,
): void {
  for (const [key, keyframes] of groups) {
    const seen = new Set<number>()
    for (const kf of keyframes) {
      // Check duplicate within the extraction group itself
      const rounded = roundTime(kf.time)
      if (seen.has(rounded)) {
        throw new Error(`Duplicate normalized time ${kf.time} in channel ${key}`)
      }
      seen.add(rounded)
    }
  }
  if (existingTimesByKey) {
    const collisions = findExistingCollisions(groups, existingTimesByKey)
    if (collisions.length > 0) {
      const first = collisions[0]
      throw new Error(`Clip already has a keyframe at time ${first.time} on channel ${first.key}`)
    }
  }
}

export function createNormalizedClipKeyframes(keyframes: readonly ExtractableKeyframe[]): {
  bounds: ExtractionBounds
  normalized: NormalizedKeyframe[]
  groups: Map<string, NormalizedKeyframe[]>
} {
  const bounds = computeExtractionBounds(keyframes)
  const normalized = keyframes.map((kf) => normalizeExtractable(kf, bounds))
  const groups = groupNormalizedByChannel(normalized)
  validateNoDuplicateTimes(groups)
  return { bounds, normalized, groups }
}

/**
 * Build KeyframeModel instances for insertion into a ClipDefinition,
 * generating new ids and preserving normalized data.
 */
export function toClipKeyframes(normalized: readonly NormalizedKeyframe[]): Keyframe[] {
  return normalized.map(
    (nk) =>
      new KeyframeModel(
        newKeyframeId(),
        nk.time,
        nk.value,
        nk.interpolation,
        { time: nk.tangentIn.time, value: nk.tangentIn.value },
        { time: nk.tangentOut.time, value: nk.tangentOut.value },
      ),
  )
}

// ── Bake starting / ending pose ──────────────────────────────────────────

/** Which segment endpoint a baking pass pins: 'start' (t=0) or 'end' (t=1). */
export type BakingAnchor = 'start' | 'end'

export const BAKING_SHADOW_EXCLUDED: readonly ShadowProperty[] = ['color'] as const

/**
 * Numeric channels eligible for baking.
 * Uniform-six are all numeric; circle/table/shadow numeric filtered.
 * Morph excluded per spec, visible/zIndex/discrete excluded.
 */
export function isBakableChannelKey(key: string): boolean {
  // Allow all numeric-derived keys; morph/visible/zIndex are not bakable
  if (key === 'morph' || key === 'visible' || key === 'zIndex') return false
  if (key.startsWith('dataLabel:')) return false
  return true
}

export interface BakingEvaluator {
  getNode(nodeId: string): SceneNode
  evaluateNode(
    nodeId: string,
    time: number,
  ): {
    transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
    opacity: number
  }
  evaluateCircle(
    nodeId: string,
    time: number,
  ): { radius: number; startAngle: number; endAngle: number; segments: number } | null
  evaluateTable(nodeId: string, time: number): { borderRadius: number; padding: number } | null
  evaluateShadow(nodeId: string, time: number): import('./shadowEffect').ShadowEffect | null
  evaluateSymmetry(nodeId: string, time: number): import('./symmetry').SymmetryKeyframeValue | null
}

/**
 * Collect synthetic keyframes for "Bake starting pose" / "Bake ending pose".
 * For every numeric channel not already present in `selected`, inject a keyframe at
 * bounds.selStart ('start') or bounds.selEnd ('end') with the value evaluated at
 * that time for a representative source node.
 * Returns extrastack to be merged with selected before normalization.
 */
export function collectBakingKeyframes(
  bounds: ExtractionBounds,
  selected: readonly ExtractableKeyframe[],
  evaluator: BakingEvaluator,
  at: BakingAnchor = 'start',
): ExtractableKeyframe[] {
  if (selected.length === 0) return []
  const existingKeys = new Set<string>()
  for (const kf of selected) {
    existingKeys.add(channelKeyOf(kf.target))
  }

  // Source node ids in selection order
  const sourceNodeIds: string[] = []
  const seenNode = new Set<string>()
  for (const kf of selected) {
    const nid = (kf.target as unknown as { nodeId?: string }).nodeId
    if (typeof nid === 'string' && !seenNode.has(nid)) {
      seenNode.add(nid)
      sourceNodeIds.push(nid)
    }
  }
  if (sourceNodeIds.length === 0) return []
  const primaryId = sourceNodeIds[0]!
  let primaryNode: SceneNode | null = null
  try {
    primaryNode = evaluator.getNode(primaryId)
  } catch {
    return []
  }
  if (!primaryNode) return []

  return collectNodeBaking(bounds, primaryId, primaryNode, evaluator, existingKeys, at)
}

/**
 * Bake every bakable numeric channel of one node (no selection needed).
 * Used for keyframe-less descendants in the segment → collection flow: the
 * resulting synthetics become the whole clip so the object's pose holds for
 * the collection duration. Shares channel coverage with collectBakingKeyframes
 * (uniform-six minus bone/camera exclusions, circle when present, shadow
 * numerics on shadowed groups; material/table skipped as in MVP baking).
 */
export function collectBakingKeyframesForNode(
  bounds: ExtractionBounds,
  nodeId: string,
  evaluator: BakingEvaluator,
  at: BakingAnchor = 'start',
): ExtractableKeyframe[] {
  let node: SceneNode | null = null
  try {
    node = evaluator.getNode(nodeId)
  } catch {
    return []
  }
  if (!node) return []
  return collectNodeBaking(bounds, nodeId, node, evaluator, new Set<string>(), at)
}

function collectNodeBaking(
  bounds: ExtractionBounds,
  nodeId: string,
  node: SceneNode,
  evaluator: BakingEvaluator,
  existingKeys: Set<string>,
  at: BakingAnchor,
): ExtractableKeyframe[] {
  const anchor = at === 'end' ? bounds.selEnd : bounds.selStart
  const idPrefix = at === 'end' ? 'bake-end' : 'bake'
  const result: ExtractableKeyframe[] = []
  const makeSynthetic = (target: KeyframeTarget, value: KeyframeValue): ExtractableKeyframe => ({
    target,
    time: anchor,
    value,
    interpolation: 'linear' as InterpolationType,
    tangentIn: { ...ZERO_TANGENT },
    tangentOut: { ...ZERO_TANGENT },
    keyframeId: `${idPrefix}:${channelKeyOf(target)}@${nodeId}`,
  })

  const tryPush = (key: string, target: KeyframeTarget, value: KeyframeValue | undefined): void => {
    if (existingKeys.has(key)) return
    if (value === undefined || value === null) return
    // Validate numeric finite for numeric channels
    if (typeof value === 'number' && !Number.isFinite(value)) return
    // Do not bake if duplicate within synthetic set already
    if (result.some((r) => channelKeyOf(r.target) === key)) return
    result.push(makeSynthetic(target, value as KeyframeValue))
    existingKeys.add(key)
  }

  // Uniform-six via evaluateNode
  let evaluatedNode: ReturnType<BakingEvaluator['evaluateNode']> | null = null
  try {
    evaluatedNode = evaluator.evaluateNode(nodeId, anchor)
  } catch {
    evaluatedNode = null
  }
  if (evaluatedNode) {
    const map: Record<AnimationProperty, number> = {
      positionX: evaluatedNode.transform.x,
      positionY: evaluatedNode.transform.y,
      rotation: evaluatedNode.transform.rotation,
      scaleX: evaluatedNode.transform.scaleX,
      scaleY: evaluatedNode.transform.scaleY,
      opacity: evaluatedNode.opacity,
    }
    for (const prop of ANIMATABLE_PROPERTIES) {
      // Skip if node cannot animate this prop (camera/bone) — try to validate via node check
      // For now, allow all; requireAnimatable check deferred to command via node type
      // Bones cannot have opacity, camera cannot have rotation — skip those
      if (node.components.bone && prop === 'opacity') continue
      if (node.components.camera && prop === 'rotation') continue
      const key = `property:${prop}`
      const val = map[prop]
      tryPush(key, { kind: 'node', nodeId, property: prop } as KeyframeTarget, val)
    }
  }

  // Circle — only if primary has circle
  if (node.components.circle) {
    let circleState: ReturnType<BakingEvaluator['evaluateCircle']> | null = null
    try {
      circleState = evaluator.evaluateCircle(nodeId, anchor)
    } catch {
      circleState = null
    }
    const fallback = node.components.circle
    const circleVals: Record<CircleAnimationProperty, number> = {
      radius: circleState?.radius ?? fallback.radius,
      startAngle: circleState?.startAngle ?? fallback.startAngle,
      endAngle: circleState?.endAngle ?? fallback.endAngle,
      segments: circleState?.segments ?? fallback.segments ?? 32,
    }
    for (const prop of CIRCLE_ANIMATABLE_PROPERTIES) {
      const key = `circle:${prop}`
      tryPush(
        key,
        { kind: 'circle', nodeId, property: prop } as unknown as KeyframeTarget,
        circleVals[prop],
      )
    }
  }

  // Table not bakable in clips yet — skip (ClipDefinition has no table channels)

  // Shadow numeric — only if group with shadowEffect (clip supports shadow)
  {
    const isGroup =
      node.children.length > 0 && Object.values(node.components).every((v) => v === undefined)
    const hasShadow = !!node.shadowEffect
    if (isGroup && hasShadow) {
      let shadowEff: import('./shadowEffect').ShadowEffect | null = null
      try {
        shadowEff = evaluator.evaluateShadow(nodeId, anchor)
      } catch {
        shadowEff = null
      }
      const eff = shadowEff ?? node.shadowEffect!
      for (const prop of SHADOW_PROPERTIES) {
        if ((BAKING_SHADOW_EXCLUDED as readonly string[]).includes(prop)) continue
        const key = `shadow:${prop}`
        const val = (eff as unknown as Record<string, unknown>)[prop]
        if (typeof val === 'number') {
          tryPush(
            key,
            {
              kind: 'shadow',
              nodeId,
              property: prop as ShadowProperty,
            } as unknown as KeyframeTarget,
            val,
          )
        }
      }
    }
  }

  // Symmetry — bake evaluated { axis, factor } so mesh symmetrize holds over the clip
  {
    const key = `symmetry`
    if (!existingKeys.has(key)) {
      try {
        const sym = evaluator.evaluateSymmetry(nodeId, anchor)
        if (sym && typeof sym.factor === 'number' && Number.isFinite(sym.factor)) {
          const axis = sym.axis === 'y' ? 'y' : 'x'
          const factor = Math.min(Math.max(sym.factor, 0), 1)
          tryPush(
            key,
            { kind: 'symmetry', nodeId } as unknown as KeyframeTarget,
            {
              axis,
              factor,
            } as unknown as KeyframeValue,
          )
        }
      } catch {
        // ignore baking failure for symmetry
      }
    }
  }

  // Material numeric not handled in MVP — skip to keep scope as requested

  return result
}

/**
 * Preview count helper for UI without mutating.
 */
export function previewBakingCount(
  bounds: ExtractionBounds | null,
  selected: readonly ExtractableKeyframe[],
  evaluator: BakingEvaluator | null,
  at: BakingAnchor = 'start',
): number {
  if (!bounds || !evaluator || selected.length === 0) return 0
  try {
    return collectBakingKeyframes(bounds, selected, evaluator, at).length
  } catch {
    return 0
  }
}

/**
 * Preview count for a keyframe-less node (bake-only clip candidate).
 */
export function previewBakingCountForNode(
  bounds: ExtractionBounds | null,
  nodeId: string,
  evaluator: BakingEvaluator | null,
  at: BakingAnchor = 'start',
): number {
  if (!bounds || !evaluator) return 0
  try {
    return collectBakingKeyframesForNode(bounds, nodeId, evaluator, at).length
  } catch {
    return 0
  }
}
