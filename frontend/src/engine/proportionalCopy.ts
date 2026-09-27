import type { AnimationProperty } from './animationProperties'
import { mirrorNegatesChannel } from './clipMirror'
import type { MirrorAxis } from './clipMirror'
import type { Keyframe, KeyframeTangent } from './keyframe'

/**
 * Proportional copy of clip-collection properties (granular cross-collection copy).
 *
 * Clips store normalized keyframes (`time ∈ [0,1]`), so "proportional" means a
 * normalized position-preserving copy: source keyframes inside the shared
 * normalized window `[fromNorm, toNorm]` are inserted into the destination clip
 * bound to the same semantic name at the same normalized time. Seconds land
 * proportionally for free (`t_sec = t_norm * duration`), and bezier tangent
 * time-components (also normalized) are preserved verbatim.
 *
 * Existing destination keyframes inside the mapped window are replaced;
 * everything outside the window is untouched. With `reverse`, times mirror
 * inside the window (end becomes start) following the clipReverse tangent
 * rules, composable with the spatial mirror modes.
 */

export type ProportionalCopyMode = 'exact' | 'mirrorX' | 'mirrorY'

export function requireProportionalCopyMode(value: unknown): ProportionalCopyMode {
  if (value === 'exact' || value === 'mirrorX' || value === 'mirrorY') return value
  throw new Error(
    `Unknown proportional-copy mode: ${String(value)} (expected 'exact', 'mirrorX' or 'mirrorY')`,
  )
}

export function proportionalCopyMirrorAxis(mode: ProportionalCopyMode): MirrorAxis | null {
  if (mode === 'mirrorX') return 'X'
  if (mode === 'mirrorY') return 'Y'
  return null
}

export interface ProportionalCopyBinding {
  readonly semanticName: string
  readonly channels: readonly AnimationProperty[]
}

export interface ProportionalCopySelection {
  readonly sourceCollectionId: string
  readonly fromNorm: number
  readonly toNorm: number
  readonly bindings: readonly ProportionalCopyBinding[]
  readonly destCollectionIds: readonly string[]
  readonly mode: ProportionalCopyMode
  /** Time-reverse the copied span: last becomes first within the window. */
  readonly reverse: boolean
}

/** Structural view over the engine — satisfied by both Engine and EnginePublic. */
export interface ProportionalCopyClipView {
  getChannel(property: AnimationProperty): { readonly paramKey?: string } | undefined
  getChannelKeyframes(property: AnimationProperty): readonly Keyframe[]
}

export interface ProportionalCopyCollectionView {
  getBindingsObject(): Record<string, string>
}

export interface ProportionalCopyEngineView {
  getClipCollection(collectionId: string): ProportionalCopyCollectionView
  getClip(clipId: string): ProportionalCopyClipView
}

export interface ProportionalCopyPreview {
  readonly keyframeCount: number
  readonly destClipCount: number
  readonly replacedCount: number
  readonly skippedLinked: number
  readonly skippedMissingSemantic: number
  readonly skippedMissingClip: number
  readonly skippedSelf: number
}

export interface ProportionalCopyOp {
  readonly semanticName: string
  readonly channel: AnimationProperty
  readonly sourceClipId: string
  readonly destClipId: string
  /** Source keyframes inside the window, in time order. */
  readonly sourceKeyframes: readonly Keyframe[]
  /** Destination keyframe ids inside the window (replaced by the copy). */
  readonly destReplaceIds: readonly string[]
  readonly negate: boolean
  readonly reverse: boolean
}

export interface ProportionalCopyPlan {
  readonly ops: readonly ProportionalCopyOp[]
  readonly preview: ProportionalCopyPreview
}

/** Window membership with the same 1e-9 tolerance used by clip extraction. */
export function isNormInWindow(time: number, fromNorm: number, toNorm: number): boolean {
  return time + 1e-9 >= fromNorm && time - 1e-9 <= toNorm
}

export function isValidNormWindow(fromNorm: number, toNorm: number): boolean {
  return (
    Number.isFinite(fromNorm) &&
    Number.isFinite(toNorm) &&
    fromNorm >= 0 &&
    toNorm <= 1 &&
    fromNorm < toNorm
  )
}

export function mapProportionalCopyValue(
  value: Keyframe['value'],
  negate: boolean,
): Keyframe['value'] {
  if (!negate) return value
  if (typeof value === 'number') return -value || 0
  return value
}

export function mapProportionalCopyTangent(
  tangent: KeyframeTangent,
  negate: boolean,
): KeyframeTangent {
  if (!negate) return { time: tangent.time, value: tangent.value }
  return { time: tangent.time, value: -tangent.value || 0 }
}

/**
 * Time-reverse a normalized time inside the copied window: the window's end
 * lands on its start and vice versa. Snaps float dust (e.g. `1 - 0.8`)
 * back to clean clip times, like `snapHoldTime` in clipReverse.
 */
export function mapProportionalCopyTime(
  time: number,
  fromNorm: number,
  toNorm: number,
  reverse: boolean,
): number {
  if (!reverse) return time
  return Math.round((fromNorm + toNorm - time) * 1e9) / 1e9
}

export interface MappedTangentPair {
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

/**
 * Tangent mapping for the copy, composing the two established transforms in
 * order — time-reverse first, spatial mirror second:
 *
 * - reverse follows clipReverse: bezier tangents swap sides and negate both
 *   components; hold/linear/parametric tangents zero out (hold segments are
 *   time-flipped naively — positions reverse, values stay with their keys;
 *   exact for linear/bezier, approximate for hold).
 * - mirror follows clipMirror: tangent value-components negate exactly when
 *   the channel value is negated.
 *
 * Reverse + mirror therefore preserves tangent values (negated twice) while
 * swapping sides and negating time — the slope survives both flips.
 */
export function mapProportionalCopyTangents(
  tangentIn: KeyframeTangent,
  tangentOut: KeyframeTangent,
  interpolation: Keyframe['interpolation'],
  negate: boolean,
  reverse: boolean,
): MappedTangentPair {
  let mappedIn = { time: tangentIn.time, value: tangentIn.value }
  let mappedOut = { time: tangentOut.time, value: tangentOut.value }
  if (reverse) {
    if (interpolation === 'bezier') {
      mappedIn = { time: -tangentOut.time, value: -tangentOut.value }
      mappedOut = { time: -tangentIn.time, value: -tangentIn.value }
    } else {
      mappedIn = { time: 0, value: 0 }
      mappedOut = { time: 0, value: 0 }
    }
  }
  if (negate) {
    mappedIn = { time: mappedIn.time, value: -mappedIn.value || 0 }
    mappedOut = { time: mappedOut.time, value: -mappedOut.value || 0 }
  }
  return { tangentIn: mappedIn, tangentOut: mappedOut }
}

/**
 * Structural validation of a selection. Returns an error message or null when
 * valid. Missing clips/bindings are not errors here — they are counted as
 * skips by the plan so preview and execute agree.
 */
export function validateProportionalCopySelection(
  engine: ProportionalCopyEngineView,
  selection: ProportionalCopySelection,
): string | null {
  try {
    requireProportionalCopyMode(selection.mode)
  } catch {
    return 'Unknown copy mode — choose Exact, Mirror X or Mirror Y'
  }
  if (!isValidNormWindow(selection.fromNorm, selection.toNorm)) {
    return 'Invalid source range — pick a from/to window inside [0, 1] with from < to'
  }
  const activeBindings = selection.bindings.filter((b) => b.channels.length > 0)
  if (activeBindings.length === 0) {
    return 'Nothing selected — check at least one semantic name with at least one property'
  }
  if ([...new Set(selection.destCollectionIds)].length === 0) {
    return 'No destination collections selected — check at least one collection to copy to'
  }
  try {
    engine.getClipCollection(selection.sourceCollectionId)
  } catch {
    return 'Source collection not found — it may have been deleted'
  }
  for (const destId of new Set(selection.destCollectionIds)) {
    try {
      engine.getClipCollection(destId)
    } catch {
      return 'A destination collection was not found — it may have been deleted'
    }
  }
  return null
}

/**
 * Shared walk for preview and execute so their counts always agree.
 * One op per unique (destClip, channel) pair: when several destination
 * collections share the same clip, the first binding wins and the rest are
 * skipped silently (same-clip self copies are counted as skippedSelf).
 */
export function collectProportionalCopyPlan(
  engine: ProportionalCopyEngineView,
  selection: ProportionalCopySelection,
): ProportionalCopyPlan {
  const axis = proportionalCopyMirrorAxis(selection.mode)
  let sourceBindings: Record<string, string>
  try {
    sourceBindings = engine.getClipCollection(selection.sourceCollectionId).getBindingsObject()
  } catch {
    sourceBindings = {}
  }
  const ops: ProportionalCopyOp[] = []
  const seenPairs = new Set<string>()
  const touchedDestClips = new Set<string>()
  let replacedCount = 0
  let skippedLinked = 0
  let skippedMissingSemantic = 0
  let skippedMissingClip = 0
  let skippedSelf = 0

  for (const destId of new Set(selection.destCollectionIds)) {
    let destBindings: Record<string, string>
    try {
      destBindings = engine.getClipCollection(destId).getBindingsObject()
    } catch {
      skippedMissingClip += 1
      continue
    }
    for (const binding of selection.bindings) {
      if (binding.channels.length === 0) continue
      const sourceClipId = sourceBindings[binding.semanticName]
      if (!sourceClipId) continue
      const destClipId = destBindings[binding.semanticName]
      if (!destClipId) {
        skippedMissingSemantic += 1
        continue
      }
      if (destClipId === sourceClipId) {
        skippedSelf += binding.channels.length
        continue
      }
      let sourceClip: ProportionalCopyClipView
      let destClip: ProportionalCopyClipView
      try {
        sourceClip = engine.getClip(sourceClipId)
      } catch {
        skippedMissingClip += binding.channels.length
        continue
      }
      try {
        destClip = engine.getClip(destClipId)
      } catch {
        skippedMissingClip += binding.channels.length
        continue
      }
      for (const channel of binding.channels) {
        const pairKey = `${destClipId}::${channel}`
        if (seenPairs.has(pairKey)) continue
        const sourceDef = sourceClip.getChannel(channel)
        if (!sourceDef) continue
        if (sourceDef.paramKey) {
          skippedLinked += 1
          continue
        }
        const destDef = destClip.getChannel(channel)
        if (destDef?.paramKey) {
          skippedLinked += 1
          continue
        }
        const sourceKeyframes = sourceClip
          .getChannelKeyframes(channel)
          .filter((kf) => isNormInWindow(kf.time, selection.fromNorm, selection.toNorm))
        if (sourceKeyframes.length === 0) continue
        const destReplaceIds = destClip
          .getChannelKeyframes(channel)
          .filter((kf) => isNormInWindow(kf.time, selection.fromNorm, selection.toNorm))
          .map((kf) => kf.id)
        seenPairs.add(pairKey)
        touchedDestClips.add(destClipId)
        replacedCount += destReplaceIds.length
        ops.push({
          semanticName: binding.semanticName,
          channel,
          sourceClipId,
          destClipId,
          sourceKeyframes: [...sourceKeyframes].sort((a, b) => a.time - b.time),
          destReplaceIds,
          negate: axis !== null && mirrorNegatesChannel(channel, axis),
          reverse: selection.reverse,
        })
      }
    }
  }

  const keyframeCount = ops.reduce((sum, op) => sum + op.sourceKeyframes.length, 0)
  return {
    ops,
    preview: {
      keyframeCount,
      destClipCount: touchedDestClips.size,
      replacedCount,
      skippedLinked,
      skippedMissingSemantic,
      skippedMissingClip,
      skippedSelf,
    },
  }
}
