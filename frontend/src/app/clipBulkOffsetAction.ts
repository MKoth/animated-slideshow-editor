import type { EnginePublic } from '../engine'
import type { AnimationProperty } from '../engine'
import { ANIMATABLE_PROPERTIES } from '../engine/animationProperties'
import type { DispatchCommand } from '../engine/commands'
import { SetClipKeyframeValueCommand } from '../engine/commands'
import { dispatchKeyframeCommands } from '../engine/keyframeEdit'

export type BulkOffsetMap = Partial<Record<AnimationProperty, number>>

export interface BulkOffsetSelection {
  readonly clipIds: readonly string[]
  readonly offsets: BulkOffsetMap
}

export interface BulkOffsetPreview {
  readonly clipCount: number
  readonly keyframeCount: number
  readonly skippedLinked: number
  readonly skippedMissing: number
}

export type BulkOffsetResult =
  | {
      readonly ok: true
      readonly message: string
      readonly clipCount: number
      readonly keyframeCount: number
      readonly skippedLinked: number
      readonly skippedMissing: number
      readonly clampedCount: number
    }
  | { readonly ok: false; readonly error: string }

function activeOffsets(offsets: BulkOffsetMap): [AnimationProperty, number][] {
  const entries: [AnimationProperty, number][] = []
  for (const property of ANIMATABLE_PROPERTIES) {
    const delta = offsets[property]
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) continue
    entries.push([property, delta])
  }
  return entries
}

interface BulkOffsetCandidate {
  readonly clipId: string
  readonly channel: AnimationProperty
  readonly keyframeId: string
  readonly newValue: number
}

interface BulkOffsetCollection {
  readonly candidates: BulkOffsetCandidate[]
  readonly touchedClips: string[]
  readonly skippedLinked: number
  readonly skippedMissing: number
  readonly clampedCount: number
}

/** Shared walk for preview and execute so their counts always agree. */
function collectBulkOffsetCandidates(
  engine: EnginePublic,
  clipIds: readonly string[],
  entries: readonly (readonly [AnimationProperty, number])[],
): BulkOffsetCollection {
  const candidates: BulkOffsetCandidate[] = []
  const touched = new Set<string>()
  let skippedLinked = 0
  let skippedMissing = 0
  let clampedCount = 0
  for (const clipId of new Set(clipIds)) {
    let clip: ReturnType<EnginePublic['getClip']>
    try {
      clip = engine.getClip(clipId)
    } catch {
      skippedMissing += 1
      continue
    }
    for (const [property, delta] of entries) {
      const channelDef = clip.getChannel(property)
      if (!channelDef) continue
      if (channelDef.paramKey) {
        skippedLinked += 1
        continue
      }
      let keyframes: readonly { id: string; value: unknown }[]
      try {
        keyframes = engine.getClipChannelKeyframes(clipId, property)
      } catch {
        continue
      }
      for (const kf of keyframes) {
        if (typeof kf.value !== 'number' || !Number.isFinite(kf.value)) continue
        let next = kf.value + delta
        if (!Number.isFinite(next)) continue
        if (property === 'opacity') {
          const clamped = Math.min(1, Math.max(0, next))
          if (clamped !== next) clampedCount += 1
          next = clamped
        }
        if (next === kf.value) continue
        candidates.push({ clipId, channel: property, keyframeId: kf.id, newValue: next })
        touched.add(clipId)
      }
    }
  }
  return {
    candidates,
    touchedClips: [...touched],
    skippedLinked,
    skippedMissing,
    clampedCount,
  }
}

/**
 * Additive bulk offset of stored clip keyframe values.
 *
 * Scope is intentionally the caller's explicit clip list (resolved from
 * collections + semantic filter by `resolveClipIdsForBulkOffset` or from
 * direct clip lanes). Shared clips are edited in place — every node and
 * slide using them sees the change.
 *
 * Param-linked channels are skipped: their stored value is scaled by the
 * instance param (`offset: base + param*kf`), so a verbatim `+dx` would not
 * equal a world `+dx`. Tangents are never touched (they are deltas).
 * Opacity results are clamped to [0,1].
 *
 * All writes go out as `SetClipKeyframeValueCommand` leaves in one undo step.
 */
export function executeBulkClipOffset(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  selection: BulkOffsetSelection,
): BulkOffsetResult {
  const fail = (error: string): BulkOffsetResult => ({ ok: false, error })
  const entries = activeOffsets(selection.offsets)
  if (entries.length === 0) {
    return fail('No offset to apply — enter a non-zero finite delta for at least one channel')
  }
  const clipIds = [...new Set(selection.clipIds)]
  if (clipIds.length === 0) {
    return fail('No clips selected — check at least one collection binding')
  }

  const collected = collectBulkOffsetCandidates(engine, clipIds, entries)
  const { skippedLinked, skippedMissing, clampedCount } = collected
  const touchedClips = collected.touchedClips
  const keyframeCount = collected.candidates.length

  if (collected.candidates.length === 0) {
    if (skippedLinked > 0 && touchedClips.length === 0) {
      return fail(
        `Nothing to offset — ${skippedLinked} channel(s) are param-linked and were skipped`,
      )
    }
    return fail('Nothing to offset — selected clips have no keyframes on the chosen channels')
  }

  const commands = collected.candidates.map(
    (candidate) =>
      new SetClipKeyframeValueCommand({
        target: { kind: 'clip', clipId: candidate.clipId, channel: candidate.channel },
        keyframeId: candidate.keyframeId,
        newValue: candidate.newValue,
      }),
  )

  const result = dispatchKeyframeCommands(dispatch, commands)
  if (result && !result.ok) {
    return fail(result.error.message)
  }
  const bits = [`Offset ${keyframeCount} keyframe(s) in ${touchedClips.length} clip(s)`]
  if (skippedLinked > 0) bits.push(`${skippedLinked} param-linked channel(s) skipped`)
  if (skippedMissing > 0) bits.push(`${skippedMissing} missing clip(s) skipped`)
  if (clampedCount > 0) bits.push(`${clampedCount} opacity value(s) clamped to [0,1]`)
  return {
    ok: true,
    message: bits.join(' · '),
    clipCount: touchedClips.length,
    keyframeCount,
    skippedLinked,
    skippedMissing,
    clampedCount,
  }
}

/** Dry-run counts for the modal preview line. Mirrors the execute walk. */
export function previewBulkClipOffset(
  engine: EnginePublic,
  selection: BulkOffsetSelection,
): BulkOffsetPreview {
  const entries = activeOffsets(selection.offsets)
  const collected = collectBulkOffsetCandidates(engine, selection.clipIds, entries)
  return {
    clipCount: collected.touchedClips.length,
    keyframeCount: collected.candidates.length,
    skippedLinked: collected.skippedLinked,
    skippedMissing: collected.skippedMissing,
  }
}
