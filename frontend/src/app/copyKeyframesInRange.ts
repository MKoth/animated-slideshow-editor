import type { Keyframe, KeyframeTarget } from '../engine'
import type { KeyframeTangent } from '../engine/keyframe'
import { PasteKeyframesCommand } from '../engine/commands'
import { inSegment } from '../engine/timeSegmentExtraction'
import type { RangeNodeSnapshot, RangeTrackSnapshot } from './rangeKeyframes'
import { remapRangeTime } from './moveKeyframesInRange'

export interface RangeCopyItem {
  readonly sourceId: string
  readonly newTime: number
  readonly value: Keyframe['value']
  readonly interpolation: Keyframe['interpolation']
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
  readonly blend: readonly number[]
  readonly wrap: boolean
}

export interface RangeCopyPlanEntry {
  readonly target: KeyframeTarget
  readonly copies: readonly RangeCopyItem[]
}

export interface RangeCopyPlan {
  readonly entries: readonly RangeCopyPlanEntry[]
  /** Copies that will create new keyframes. */
  readonly copied: number
  /** Source keyframes skipped because their destination time is already occupied. */
  readonly skipped: number
}

/** Read-only view over a track's keyframes, satisfied by the engine. */
export type RangeCopyTrackReader = (
  target: KeyframeTarget,
) => readonly Pick<
  Keyframe,
  'id' | 'time' | 'value' | 'interpolation' | 'tangentIn' | 'tangentOut' | 'blend' | 'wrap'
>[]

/**
 * Remap a source time from `[from, to]` onto `[targetFrom, targetTo]`
 * (scale-to-fit, like the range move). With `reverse`, the mapped time is
 * mirrored inside the destination window so the section's end lands on the
 * destination start and vice versa. Float dust (e.g. `1 - 0.8`) is snapped
 * back to clean times, like `snapHoldTime` in clipReverse.
 */
export function remapCopyTime(
  time: number,
  from: number,
  to: number,
  targetFrom: number,
  targetTo: number,
  reverse: boolean,
): number {
  const mapped = remapRangeTime(time, from, to, targetFrom, targetTo)
  const out = reverse ? targetFrom + targetTo - mapped : mapped
  return Math.round(out * 1e9) / 1e9
}

export interface MappedCopyTangents {
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

/**
 * Tangent mapping for the copy. Without `reverse` tangents travel verbatim.
 * With `reverse`, bezier tangents swap sides and negate both components
 * (the clipReverse rule); every other interpolation zeroes tangents. Hold
 * values travel with their keys (naive flip, like proportionalCopy) — exact
 * for linear/bezier, approximate for hold segments that extend past the
 * window edge.
 */
export function mapCopyTangents(
  tangentIn: KeyframeTangent,
  tangentOut: KeyframeTangent,
  interpolation: Keyframe['interpolation'],
  reverse: boolean,
): MappedCopyTangents {
  if (!reverse) {
    return {
      tangentIn: { time: tangentIn.time, value: tangentIn.value },
      tangentOut: { time: tangentOut.time, value: tangentOut.value },
    }
  }
  if (interpolation === 'bezier') {
    return {
      tangentIn: { time: -tangentOut.time, value: -tangentOut.value },
      tangentOut: { time: -tangentIn.time, value: -tangentIn.value },
    }
  }
  return {
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
  }
}

/**
 * Build one plan entry per checked track with at least one keyframe in the
 * source section `[from, to]`. The copy is purely additive: destination
 * keyframes are never deleted. A copy is skipped (counted, not planned) when
 * its destination time is already occupied on that track — the engine rejects
 * duplicate times — or when two source keys would land on the same
 * destination time. Copying a section onto itself therefore plans nothing and
 * reports every key as skipped; the same span with `reverse` is a valid
 * in-place reverse.
 */
export function planRangeCopy(
  snapshots: readonly RangeNodeSnapshot[],
  getTrackKeyframes: RangeCopyTrackReader,
  from: number,
  to: number,
  targetFrom: number,
  targetTo: number,
  slideDuration: number,
  isChecked: (nodeId: string, track: RangeTrackSnapshot) => boolean = () => true,
  reverse = false,
): RangeCopyPlan {
  const entries: RangeCopyPlanEntry[] = []
  let copied = 0
  let skipped = 0
  for (const snapshot of snapshots) {
    for (const track of snapshot.tracks) {
      if (!isChecked(snapshot.nodeId, track)) {
        continue
      }
      const sourceIds: { id: string; time: number }[] = []
      for (const time of track.times) {
        if (inSegment(time.time, from, to)) {
          sourceIds.push(time)
        }
      }
      if (sourceIds.length === 0) {
        continue
      }
      let full: ReturnType<RangeCopyTrackReader>
      try {
        full = getTrackKeyframes(track.target)
      } catch {
        continue
      }
      const byId = new Map(full.map((keyframe) => [keyframe.id, keyframe]))
      // Every keyframe on the track occupies its time, including the sources
      // themselves (an identity copy lands on occupied times).
      const occupied = new Set(track.times.map((time) => time.time))
      const plannedTimes = new Set<number>()
      const copies: RangeCopyItem[] = []
      for (const source of sourceIds) {
        const keyframe = byId.get(source.id)
        if (!keyframe) {
          continue
        }
        // `validateSegmentRange` tolerates a tiny overshoot past the slide
        // duration; clamp so the engine's strict bound still accepts it.
        const newTime = Math.min(
          Math.max(remapCopyTime(source.time, from, to, targetFrom, targetTo, reverse), 0),
          slideDuration,
        )
        if (occupied.has(newTime) || plannedTimes.has(newTime)) {
          skipped += 1
          continue
        }
        const { tangentIn, tangentOut } = mapCopyTangents(
          keyframe.tangentIn,
          keyframe.tangentOut,
          keyframe.interpolation,
          reverse,
        )
        plannedTimes.add(newTime)
        copies.push({
          sourceId: source.id,
          newTime,
          value: keyframe.value,
          interpolation: keyframe.interpolation,
          tangentIn,
          tangentOut,
          blend: [...keyframe.blend],
          wrap: keyframe.wrap,
        })
      }
      if (copies.length > 0) {
        copies.sort((a, b) => a.newTime - b.newTime)
        entries.push({ target: track.target, copies })
        copied += copies.length
      }
    }
  }
  return { entries, copied, skipped }
}

/**
 * Map a range-copy plan to one `PasteKeyframesCommand` per track. Paste is
 * the established copy primitive: values, interpolation, tangents, blend and
 * wrap travel; the disabled flag does not (copies paste enabled, like the
 * timeline Paste). `atTime: 0` makes the absolute destination times land
 * verbatim (`time = atTime + relative`).
 */
export function buildRangeCopyCommands(
  entries: readonly RangeCopyPlanEntry[],
): PasteKeyframesCommand[] {
  return entries.map(
    (entry) =>
      new PasteKeyframesCommand({
        target: entry.target,
        payload: {
          keyframes: entry.copies.map((copy) => ({
            time: copy.newTime,
            value: copy.value as unknown,
            interpolation: copy.interpolation,
            tangentIn: { ...copy.tangentIn },
            tangentOut: { ...copy.tangentOut },
            blend: [...copy.blend],
            wrap: copy.wrap,
          })),
        },
        atTime: 0,
      }),
  )
}

/** Total copied keyframe count across a plan (for confirm-button labels). */
export function countPlannedCopies(plan: RangeCopyPlan): number {
  return plan.copied
}
