import type { Engine } from '../internal'
import type { EnginePublic } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireKeyframeTarget } from '../keyframeTarget'
import type { ClipChannelDef } from '../clipDefinition'
import type { ClipDefinition } from '../clipDefinition'
import type { ExtractableKeyframe, NormalizedKeyframe } from '../clipExtraction'
import {
  computeExtractionBounds,
  normalizeExtractable,
  channelKeyOf,
  validateNoDuplicateTimes,
  findExistingCollisions,
  collectExistingTimesForGroups,
  collectBakingKeyframes,
} from '../clipExtraction'
import type { BakingEvaluator, ExtractionBounds } from '../clipExtraction'
import { Keyframe as KeyframeModel, newKeyframeId } from '../keyframe'
import { categoryPathOfShape } from '../shape'

/** Collision policy when appending to an existing clip lands on an occupied time. */
export type ExtractDuplicatePolicy = 'replace' | 'skip'

export interface ExtractToExistingClipParams {
  readonly keyframes: readonly ExtractableKeyframe[]
  readonly clipId: string
  readonly bakeStartingPose?: boolean
  readonly bakeEndingPose?: boolean
  /**
   * How to resolve collisions with existing keyframes at the same
   * (channel, time). Absent = error (legacy behavior).
   * 'replace' overwrites the existing keyframe, 'skip' keeps it and drops
   * the incoming one. Non-colliding keyframes are always appended.
   */
  readonly onDuplicate?: ExtractDuplicatePolicy
}

export interface ExtractToNewClipParams {
  readonly keyframes: readonly ExtractableKeyframe[]
  readonly name: string
  readonly duration?: number
  readonly category?: string
  readonly bakeStartingPose?: boolean
  readonly bakeEndingPose?: boolean
  /**
   * Global time-segment override for batch extraction (time-segment → collection flow).
   * When both are present, keyframe times are normalized against [rangeStart, rangeEnd]
   * instead of the selection's own min/max, so clips extracted from different objects
   * over the same segment share one time base and stay in sync inside a collection.
   * Every keyframe time must lie within the range (1e-9 tolerance).
   */
  readonly rangeStart?: number
  readonly rangeEnd?: number
}

export type ExtractToClipParameters = ExtractToNewClipParams | ExtractToExistingClipParams

export interface ExtractToClipInverseExisting {
  readonly mode: 'existing'
  readonly clipId: string
  readonly snapshot: unknown // ClipJSON snapshot before extraction
  readonly afterSnapshot: unknown // ClipJSON after extraction (for redo)
}

export interface ExtractToClipInverseNew {
  readonly mode: 'new'
  readonly clipId: string
  readonly snapshot: unknown // ClipJSON snapshot of newly created clip
}

export type ExtractToClipInverse = ExtractToClipInverseExisting | ExtractToClipInverseNew

function isExistingParams(params: ExtractToClipParameters): params is ExtractToExistingClipParams {
  return 'clipId' in params
}

function getBakingEvaluator(engine: EnginePublic): BakingEvaluator {
  return {
    getNode: (nodeId: string) => engine.getNode(nodeId),
    evaluateNode: (nodeId: string, time: number) => engine.evaluateNode(nodeId, time),
    evaluateCircle: (nodeId: string, time: number) => engine.evaluateCircle(nodeId, time),
    evaluateTable: (nodeId: string, time: number) => engine.evaluateTable(nodeId, time),
    evaluateShadow: (nodeId: string, time: number) => engine.evaluateShadow(nodeId, time),
    evaluateSymmetry: (nodeId: string, time: number) => engine.evaluateSymmetry(nodeId, time),
  }
}

function roundTime(t: number): number {
  return Math.round(t * 1e9) / 1e9
}

/**
 * Remove the existing clip keyframe at (target channel, time), if any.
 * Used by the 'replace' duplicate policy. Returns whether one was removed.
 */
function removeExistingKeyframeAtTime(
  clip: ClipDefinition,
  target: KeyframeTarget,
  time: number,
): boolean {
  const idOf = (kfs: readonly { id: string; time: number }[]): string | undefined =>
    kfs.find((k) => roundTime(k.time) === roundTime(time))?.id
  if (target.kind === 'shadow') {
    const id = idOf(clip.getShadowChannelKeyframes(target.property))
    if (!id) return false
    clip.removeShadowChannelKeyframe(target.property, id)
    return true
  }
  if (target.kind === 'node' && 'property' in target) {
    const id = idOf(clip.getChannelKeyframes(target.property))
    if (!id) return false
    clip.removeChannelKeyframe(target.property, id)
    return true
  }
  if (target.kind === 'visible') {
    const id = idOf(clip.getVisibleKeyframes())
    if (!id) return false
    clip.removeVisibleKeyframe(id)
    return true
  }
  if (target.kind === 'zIndex') {
    const id = idOf(clip.getZIndexKeyframes())
    if (!id) return false
    clip.removeZIndexKeyframe(id)
    return true
  }
  if (target.kind === 'morph') {
    const id = idOf(clip.getMorphKeyframes())
    if (!id) return false
    clip.removeMorphKeyframe(id)
    return true
  }
  if (target.kind === 'symmetry') {
    const id = idOf(clip.getSymmetryKeyframes())
    if (!id) return false
    clip.removeSymmetryKeyframe(id)
    return true
  }
  if (target.kind === 'circle') {
    const id = idOf(clip.getCircleKeyframes(target.property))
    if (!id) return false
    clip.removeCircleKeyframe(target.property, id)
    return true
  }
  if (target.kind === 'node' && 'parameter' in target) {
    const id = idOf(clip.getMaterialChannelKeyframes(target.parameter))
    if (!id) return false
    clip.removeMaterialChannelKeyframe(target.parameter, id)
    return true
  }
  return false
}

/**
 * Merge baking synthetics into normalized set, filtering ones that would duplicate existing clip time 0.
 */
function mergeBakingNormalized(
  bounds: import('../clipExtraction').ExtractionBounds,
  normalized: readonly NormalizedKeyframe[],
  bakingExtractable: readonly ExtractableKeyframe[],
  existingTimesByKey?: Map<string, readonly number[]>,
): NormalizedKeyframe[] {
  if (bakingExtractable.length === 0) return [...normalized]
  const bakingNormalized = bakingExtractable.map((kf) => normalizeExtractable(kf, bounds))
  const existingKeys = new Set(normalized.map((nk) => channelKeyOf(nk.target)))
  const result: NormalizedKeyframe[] = [...normalized]
  for (const bk of bakingNormalized) {
    const key = channelKeyOf(bk.target)
    if (existingKeys.has(key)) continue
    // Skip if existing clip already has time 0 on that channel (would duplicate)
    if (existingTimesByKey) {
      const existing = existingTimesByKey.get(key)
      if (existing) {
        const roundedExisting = existing.map((t) => Math.round(t * 1e9) / 1e9)
        if (roundedExisting.includes(Math.round(bk.time * 1e9) / 1e9)) continue
      }
    }
    // Also avoid synthetic within synthetic duplicate (shouldn't happen)
    if (
      result.some(
        (r) =>
          channelKeyOf(r.target) === key &&
          Math.round(r.time * 1e9) / 1e9 === Math.round(bk.time * 1e9) / 1e9,
      )
    )
      continue
    result.push(bk)
  }
  return result
}

export class ExtractToClipCommand implements Command<ExtractToClipInverse> {
  readonly type = 'ExtractToClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #keyframes: readonly ExtractableKeyframe[]
  readonly #bakeStartingPose: boolean
  readonly #bakeEndingPose: boolean
  readonly #onDuplicate: ExtractDuplicatePolicy | undefined
  readonly #destination:
    | {
        mode: 'new'
        name: string
        duration?: number
        category?: string
        rangeStart?: number
        rangeEnd?: number
      }
    | { mode: 'existing'; clipId: string }

  constructor(input: ExtractToClipParameters) {
    const bakeStartingPose = (input as { bakeStartingPose?: unknown }).bakeStartingPose === true
    const bakeEndingPose = (input as { bakeEndingPose?: unknown }).bakeEndingPose === true
    this.#bakeStartingPose = bakeStartingPose
    this.#bakeEndingPose = bakeEndingPose
    if (isExistingParams(input)) {
      requireString(input.clipId, 'Extract clipId')
      const onDuplicate = (input as { onDuplicate?: unknown }).onDuplicate
      if (onDuplicate !== undefined && onDuplicate !== 'replace' && onDuplicate !== 'skip') {
        throw new Error(`Extract onDuplicate must be 'replace' or 'skip'`)
      }
      this.#onDuplicate = onDuplicate as ExtractDuplicatePolicy | undefined
      this.#keyframes = [...input.keyframes]
      this.#destination = { mode: 'existing', clipId: input.clipId }
      this.parameters = {
        mode: 'existing',
        clipId: input.clipId,
        ...(bakeStartingPose ? { bakeStartingPose: true } : {}),
        ...(bakeEndingPose ? { bakeEndingPose: true } : {}),
        ...(this.#onDuplicate ? { onDuplicate: this.#onDuplicate } : {}),
        keyframes: input.keyframes as unknown as Record<string, unknown>[],
      }
    } else {
      requireString(input.name, 'Extract clip name')
      this.#onDuplicate = undefined
      if (input.duration !== undefined) {
        requireFiniteNumber(input.duration, 'Extract clip duration')
        if (input.duration < 0) throw new Error('Clip duration must be non-negative')
      }
      let rangeStart: number | undefined
      let rangeEnd: number | undefined
      if (input.rangeStart !== undefined || input.rangeEnd !== undefined) {
        if (input.rangeStart === undefined || input.rangeEnd === undefined) {
          throw new Error('Extract rangeStart and rangeEnd must be provided together')
        }
        requireFiniteNumber(input.rangeStart, 'Extract rangeStart')
        requireFiniteNumber(input.rangeEnd, 'Extract rangeEnd')
        if (!(input.rangeEnd - input.rangeStart > 1e-9)) {
          throw new Error('Extract rangeEnd must be greater than rangeStart')
        }
        rangeStart = input.rangeStart
        rangeEnd = input.rangeEnd
      }
      this.#keyframes = [...input.keyframes]
      this.#destination = {
        mode: 'new',
        name: input.name,
        duration: input.duration,
        category: input.category ?? '',
        ...(rangeStart !== undefined ? { rangeStart, rangeEnd: rangeEnd! } : {}),
      }
      this.parameters = {
        mode: 'new',
        name: input.name,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(bakeStartingPose ? { bakeStartingPose: true } : {}),
        ...(bakeEndingPose ? { bakeEndingPose: true } : {}),
        ...(rangeStart !== undefined ? { rangeStart, rangeEnd } : {}),
        keyframes: input.keyframes as unknown as Record<string, unknown>[],
      }
    }
    if (this.#keyframes.length === 0) {
      throw new Error('At least one keyframe is required for extraction')
    }
    // Validate targets
    for (const kf of this.#keyframes) {
      requireKeyframeTarget(kf.target as unknown as Record<string, unknown>)
      requireFiniteNumber(kf.time, 'Keyframe time')
      if (kf.value === undefined) throw new Error('Keyframe value is required')
    }
  }

  /**
   * Resolve the normalization bounds: the explicit global [rangeStart, rangeEnd]
   * segment when provided (new-clip batch flow), otherwise the selection's own
   * min/max via computeExtractionBounds.
   */
  #resolveBounds(): ExtractionBounds {
    if (this.#destination.mode === 'new' && this.#destination.rangeStart !== undefined) {
      const selStart = this.#destination.rangeStart
      const selEnd = this.#destination.rangeEnd!
      const selDuration = selEnd - selStart
      for (const kf of this.#keyframes) {
        if (kf.time < selStart - 1e-9 || kf.time > selEnd + 1e-9) {
          throw new Error(
            `Keyframe at ${kf.time}s is outside the extraction range [${selStart}s, ${selEnd}s]`,
          )
        }
      }
      return { selStart, selEnd, selDuration, clipDuration: selDuration }
    }
    return computeExtractionBounds(this.#keyframes)
  }

  /**
   * Collect baking synthetics for the enabled anchors in one joint set, so a
   * channel missing from the selection gets both endpoints pinned (t=0 from the
   * start pose, t=1 from the end pose) instead of the end pass seeing the start
   * pass as "already present".
   */
  #collectBakingSynthetics(engine: EnginePublic, bounds: ExtractionBounds): ExtractableKeyframe[] {
    const out: ExtractableKeyframe[] = []
    const evaluator = getBakingEvaluator(engine)
    if (this.#bakeStartingPose) {
      out.push(...collectBakingKeyframes(bounds, this.#keyframes, evaluator, 'start'))
    }
    if (this.#bakeEndingPose) {
      out.push(...collectBakingKeyframes(bounds, this.#keyframes, evaluator, 'end'))
    }
    return out
  }

  /**
   * Pre-collect existing clip times for dup filtering (existing clip may already
   * have 0/1 on a channel). Only meaningful in existing-clip mode.
   */
  #existingTimesForBakeMap(engine: EnginePublic): Map<string, readonly number[]> | undefined {
    if (this.#destination.mode !== 'existing') return undefined
    const clip = engine.getClip(this.#destination.clipId)
    const map = new Map<string, readonly number[]>()
    // collect all existing times (not just groups) to filter baking duplicates
    for (const prop of [
      'positionX',
      'positionY',
      'rotation',
      'scaleX',
      'scaleY',
      'opacity',
    ] as const) {
      const kfs = clip.getChannelKeyframes(prop)
      if (kfs.length > 0)
        map.set(
          `property:${prop}`,
          kfs.map((k) => k.time),
        )
    }
    for (const prop of ['radius', 'startAngle', 'endAngle', 'segments'] as const) {
      const kfs = clip.getCircleKeyframes(
        prop as unknown as import('../animationProperties').CircleAnimationProperty,
      )
      if (kfs.length > 0)
        map.set(
          `circle:${prop}`,
          kfs.map((k) => k.time),
        )
    }
    for (const prop of [
      'offsetX',
      'offsetY',
      'scaleX',
      'scaleY',
      'skewX',
      'skewY',
      'rotation',
      'blur',
      'opacity',
      'lightAzimuth',
      'lightElevation',
      'lightDistance',
    ] as const) {
      const kfs = clip.getShadowChannelKeyframes(
        prop as unknown as import('../shadowEffect').ShadowProperty,
      )
      if (kfs.length > 0)
        map.set(
          `shadow:${prop}`,
          kfs.map((k) => k.time),
        )
    }
    {
      const kfs = clip.getSymmetryKeyframes()
      if (kfs.length > 0)
        map.set(
          `symmetry`,
          kfs.map((k) => k.time),
        )
    }
    return map
  }

  validate(engine: EnginePublic): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    if (this.#destination.mode === 'existing') {
      // Will throw if not found
      engine.getClip(this.#destination.clipId)
    }
    // Validate normalization and duplicate times without mutating
    const bounds = this.#resolveBounds()
    let normalized: NormalizedKeyframe[] = this.#keyframes.map((kf) =>
      normalizeExtractable(kf, bounds),
    )
    // Bake pose synthetics for validation (start and/or end anchors, joint merge)
    if (this.#bakeStartingPose || this.#bakeEndingPose) {
      try {
        const bakingExtractable = this.#collectBakingSynthetics(engine, bounds)
        normalized = mergeBakingNormalized(
          bounds,
          normalized,
          bakingExtractable,
          this.#existingTimesForBakeMap(engine),
        )
      } catch {
        // baking failed — fall back to no baking for validation
      }
    }
    const groups = new Map<string, NormalizedKeyframe[]>()
    for (const nk of normalized) {
      const key = channelKeyOf(nk.target)
      const arr = groups.get(key)
      if (arr) arr.push(nk)
      else groups.set(key, [nk])
    }
    // For existing, check against existing clip times (skipped when a
    // duplicate policy resolves collisions instead of erroring)
    if (this.#destination.mode === 'existing' && !this.#onDuplicate) {
      const clip = engine.getClip(this.#destination.clipId)
      validateNoDuplicateTimes(groups, collectExistingTimesForGroups(clip, groups))
    } else {
      validateNoDuplicateTimes(groups)
    }
  }

  execute(engine: Engine): ExtractToClipInverse {
    const bounds = this.#resolveBounds()
    const normalizedRaw = this.#keyframes.map((kf) => normalizeExtractable(kf, bounds))
    // Convert morph id-based values to name-based clip values
    let normalized: NormalizedKeyframe[] = normalizedRaw.map((nk) => {
      if (nk.target.kind === 'morph') {
        const raw = nk.value as unknown
        let morphVal: { fromShapeId: string | null; toShapeId: string | null; coefficient: number }
        if (typeof raw === 'number') {
          morphVal = { fromShapeId: null, toShapeId: null, coefficient: raw as number }
        } else if (
          typeof raw === 'object' &&
          raw !== null &&
          'coefficient' in (raw as Record<string, unknown>)
        ) {
          const r = raw as Record<string, unknown>
          // already name-based? keep as is
          if ('fromShapeName' in r || 'toShapeName' in r) {
            return nk
          }
          morphVal = {
            fromShapeId: (r.fromShapeId as string | null) ?? null,
            toShapeId: (r.toShapeId as string | null) ?? null,
            coefficient: r.coefficient as number,
          }
        } else {
          return nk
        }
        let fromName: string | null = null
        let toName: string | null = null
        let fromCategoryPath: readonly string[] | null | undefined
        let toCategoryPath: readonly string[] | null | undefined
        try {
          const nodeId = (nk.target as unknown as { nodeId: string }).nodeId
          const shapes = engine.getShapes(nodeId)
          let categories: readonly import('../shapeCategory').ShapeCategory[] = []
          try {
            categories = engine.getShapeCategories(nodeId)
          } catch {
            categories = []
          }
          if (morphVal.fromShapeId) {
            const s = shapes.find((sh) => sh.id === morphVal.fromShapeId)
            if (s) {
              fromName = s.name
              fromCategoryPath = categoryPathOfShape(s, categories)
            }
          }
          if (morphVal.toShapeId) {
            const s = shapes.find((sh) => sh.id === morphVal.toShapeId)
            if (s) {
              toName = s.name
              toCategoryPath = categoryPathOfShape(s, categories)
            }
          }
        } catch {
          // ignore, keep null
        }
        const clipVal = {
          fromShapeName: fromName,
          toShapeName: toName,
          coefficient: morphVal.coefficient,
          ...(fromCategoryPath !== undefined ? { fromCategoryPath } : {}),
          ...(toCategoryPath !== undefined ? { toCategoryPath } : {}),
        }
        return { ...nk, value: clipVal as unknown as import('../keyframe').KeyframeValue }
      }
      return nk
    })
    // Bake pose — inject synthetic numeric keyframes at t=0 (start) and/or t=1 (end)
    if (this.#bakeStartingPose || this.#bakeEndingPose) {
      try {
        const bakingExtractable = this.#collectBakingSynthetics(engine, bounds)
        normalized = mergeBakingNormalized(
          bounds,
          normalized,
          bakingExtractable,
          this.#existingTimesForBakeMap(engine),
        )
      } catch {
        // ignore baking failure
      }
    }

    if (this.#destination.mode === 'new') {
      const clipDuration = this.#destination.duration ?? bounds.clipDuration
      requireFiniteNumber(clipDuration, 'Clip duration')
      if (clipDuration < 0) throw new Error('Clip duration must be non-negative')

      // Group by channel
      const groups = new Map<string, typeof normalized>()
      for (const nk of normalized) {
        const key = channelKeyOf(nk.target)
        const arr = groups.get(key)
        if (arr) arr.push(nk)
        else groups.set(key, [nk])
      }

      // Build channels for uniform-six property groups
      const channels: ClipChannelDef[] = []
      for (const [, arr] of groups) {
        const sample = arr[0].target
        if (sample.kind === 'node' && 'property' in sample) {
          // Ensure not duplicate
          if (!channels.some((ch) => ch.property === sample.property)) {
            channels.push({ property: sample.property })
          }
        } else if (sample.kind === 'node' && 'parameter' in sample) {
          // Material parameter channel
          const param = sample.parameter
          if (!channels.some((ch) => ch.materialParameter === param)) {
            // For material params we need a dummy property; use first uniform prop
            channels.push({ property: 'opacity', materialParameter: param } as ClipChannelDef)
          }
        }
        // Visible and circle are implicit, no channelDef needed
      }

      const clip = engine.createClip(
        this.#destination.name,
        clipDuration,
        this.#destination.category ?? '',
        [],
        channels,
      )

      // Insert normalized keyframes
      for (const [, arr] of groups) {
        const sample = arr[0].target
        for (const nk of arr) {
          const kf = new KeyframeModel(
            newKeyframeId(),
            nk.time,
            nk.value,
            nk.interpolation,
            { time: nk.tangentIn.time, value: nk.tangentIn.value },
            { time: nk.tangentOut.time, value: nk.tangentOut.value },
          )
          // Visible and zIndex tracks in clips use hold interpolation only
          if (
            (sample.kind === 'visible' || sample.kind === 'zIndex') &&
            kf.interpolation !== 'hold'
          ) {
            kf.interpolation = 'hold'
          }
          if (
            sample.kind === 'shadow' &&
            (sample as { property: string }).property === 'color' &&
            kf.interpolation !== 'hold' &&
            kf.interpolation !== 'linear'
          ) {
            kf.interpolation = 'linear'
          }
          if (sample.kind === 'shadow') {
            clip.addShadowChannelKeyframe(
              (sample as { property: import('../shadowEffect').ShadowProperty }).property,
              kf,
            )
            engine.emitKeyframeAdded(
              {
                kind: 'shadow',
                nodeId: 'clip-' + clip.id,
                property: (sample as { property: import('../shadowEffect').ShadowProperty })
                  .property,
              } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'node' && 'property' in sample) {
            clip.addChannelKeyframe(sample.property, kf)
            engine.emitKeyframeAdded(
              { kind: 'clip', clipId: clip.id, channel: sample.property },
              kf.id,
            )
          } else if (sample.kind === 'visible') {
            clip.addVisibleKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'visible', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            // Also emit clip-specific event for UI refresh
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'zIndex') {
            clip.addZIndexKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'zIndex', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            // Also emit clip-specific event for UI refresh
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'morph') {
            clip.addMorphKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'morph', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'symmetry') {
            clip.addSymmetryKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'symmetry', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'circle') {
            clip.addCircleKeyframe(sample.property, kf)
            engine.emitKeyframeAdded(
              {
                kind: 'circle',
                nodeId: 'clip-' + clip.id,
                property: sample.property,
              } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'node' && 'parameter' in sample) {
            const param = (sample as { parameter: string }).parameter
            clip.addMaterialChannelKeyframe(param, kf)
            engine.emitKeyframeAdded(
              { kind: 'clip', clipId: clip.id, channel: param } as unknown as KeyframeTarget,
              kf.id,
            )
          } else if (sample.kind === 'dataLabel') {
            // Not supported in clips; skip
          } else if (sample.kind === 'table') {
            // Not supported; skip
          }
        }
      }

      const snapshot = clip.toJSON()
      return { mode: 'new', clipId: clip.id, snapshot }
    } else {
      const clip = engine.getClip(this.#destination.clipId)
      const snapshot = clip.toJSON()
      const groups = new Map<string, typeof normalized>()
      for (const nk of normalized) {
        const key = channelKeyOf(nk.target)
        const arr = groups.get(key)
        if (arr) arr.push(nk)
        else groups.set(key, [nk])
      }

      // Ensure channels exist for property groups
      for (const [, arr] of groups) {
        const sample = arr[0].target
        if (sample.kind === 'node' && 'property' in sample) {
          if (!clip.hasChannel(sample.property)) {
            engine.addClipChannel(clip.id, { property: sample.property })
          }
        } else if (sample.kind === 'node' && 'parameter' in sample) {
          const param = (sample as { parameter: string }).parameter
          if (!clip.hasMaterialChannel(param)) {
            engine.addClipChannel(clip.id, {
              property: 'opacity',
              materialParameter: param,
            } as ClipChannelDef)
          }
        }
      }

      // Resolve collisions per the duplicate policy (absent = validate already
      // rejected them, so this set is empty).
      let colliding = new Set<string>()
      if (this.#onDuplicate) {
        const existingTimes = collectExistingTimesForGroups(clip, groups)
        colliding = new Set(
          findExistingCollisions(groups, existingTimes).map((c) => `${c.key}@${roundTime(c.time)}`),
        )
      }

      // Insert keyframes
      for (const [, arr] of groups) {
        const sample = arr[0].target
        for (const nk of arr) {
          const collisionKey = `${channelKeyOf(nk.target)}@${roundTime(nk.time)}`
          if (colliding.has(collisionKey) && this.#onDuplicate === 'skip') continue
          if (colliding.has(collisionKey) && this.#onDuplicate === 'replace') {
            removeExistingKeyframeAtTime(clip, nk.target, nk.time)
          }
          const kf = new KeyframeModel(
            newKeyframeId(),
            nk.time,
            nk.value,
            nk.interpolation,
            { time: nk.tangentIn.time, value: nk.tangentIn.value },
            { time: nk.tangentOut.time, value: nk.tangentOut.value },
          )
          if (
            (sample.kind === 'visible' || sample.kind === 'zIndex') &&
            kf.interpolation !== 'hold'
          ) {
            kf.interpolation = 'hold'
          }
          if (
            sample.kind === 'shadow' &&
            (sample as { property: string }).property === 'color' &&
            kf.interpolation !== 'hold' &&
            kf.interpolation !== 'linear'
          ) {
            kf.interpolation = 'linear'
          }
          if (sample.kind === 'shadow') {
            clip.addShadowChannelKeyframe(
              (sample as { property: import('../shadowEffect').ShadowProperty }).property,
              kf,
            )
            engine.emitKeyframeAdded(
              {
                kind: 'shadow',
                nodeId: 'clip-' + clip.id,
                property: (sample as { property: import('../shadowEffect').ShadowProperty })
                  .property,
              } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'node' && 'property' in sample) {
            // Use direct clip insertion to preserve full data, but emit via manager
            clip.addChannelKeyframe(sample.property, kf)
            engine.emitKeyframeAdded(
              { kind: 'clip', clipId: clip.id, channel: sample.property },
              kf.id,
            )
          } else if (sample.kind === 'visible') {
            clip.addVisibleKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'visible', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'zIndex') {
            clip.addZIndexKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'zIndex', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'morph') {
            clip.addMorphKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'morph', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'symmetry') {
            clip.addSymmetryKeyframe(kf)
            engine.emitKeyframeAdded(
              { kind: 'symmetry', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'circle') {
            clip.addCircleKeyframe(sample.property, kf)
            engine.emitKeyframeAdded(
              {
                kind: 'circle',
                nodeId: 'clip-' + clip.id,
                property: sample.property,
              } as unknown as KeyframeTarget,
              kf.id,
            )
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'node' && 'parameter' in sample) {
            const param2 = (sample as { parameter: string }).parameter
            clip.addMaterialChannelKeyframe(param2, kf)
            engine.emitKeyframeAdded(
              { kind: 'clip', clipId: clip.id, channel: param2 } as unknown as KeyframeTarget,
              kf.id,
            )
          }
        }
      }

      const afterSnapshot = clip.toJSON()
      return { mode: 'existing', clipId: clip.id, snapshot, afterSnapshot }
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
