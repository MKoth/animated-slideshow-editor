import type { KeyframeMove, KeyframeTarget } from '../engine'
import { MoveKeyframesCommand } from '../engine/commands'
import { SEGMENT_EPS, inSegment } from '../engine/timeSegmentExtraction'
import type { RangeNodeSnapshot, RangeTrackSnapshot } from './rangeKeyframes'

export interface RangeMovePlanEntry {
  readonly target: KeyframeTarget
  readonly moves: readonly KeyframeMove[]
}

/**
 * Proportional remap of a keyframe time from `[from, to]` onto
 * `[targetFrom, targetTo]`: the source section's content is scaled to fill
 * the target section exactly.
 */
export function remapRangeTime(
  time: number,
  from: number,
  to: number,
  targetFrom: number,
  targetTo: number,
): number {
  const span = to - from
  if (!(span > SEGMENT_EPS)) {
    return time
  }
  return targetFrom + ((time - from) * (targetTo - targetFrom)) / span
}

/**
 * Build one plan entry per checked track with at least one keyframe in the
 * source section `[from, to]`. Keyframes whose remapped time equals their
 * current time are dropped, so an identity mapping produces an empty plan
 * and no no-op commands are dispatched.
 */
export function planRangeMove(
  snapshots: readonly RangeNodeSnapshot[],
  from: number,
  to: number,
  targetFrom: number,
  targetTo: number,
  slideDuration: number,
  isChecked: (nodeId: string, track: RangeTrackSnapshot) => boolean = () => true,
): RangeMovePlanEntry[] {
  const plan: RangeMovePlanEntry[] = []
  for (const snapshot of snapshots) {
    for (const track of snapshot.tracks) {
      if (!isChecked(snapshot.nodeId, track)) {
        continue
      }
      const moves: KeyframeMove[] = []
      for (const time of track.times) {
        if (!inSegment(time.time, from, to)) {
          continue
        }
        // `validateSegmentRange` tolerates a tiny overshoot past the slide
        // duration; clamp so the engine's strict bound still accepts it.
        const newTime = Math.min(
          Math.max(remapRangeTime(time.time, from, to, targetFrom, targetTo), 0),
          slideDuration,
        )
        if (Math.abs(newTime - time.time) <= SEGMENT_EPS) {
          continue
        }
        moves.push({ keyframeId: time.id, newTime })
      }
      if (moves.length > 0) {
        plan.push({ target: track.target, moves })
      }
    }
  }
  return plan
}

/** Map a range-move plan to one `MoveKeyframesCommand` per track. */
export function buildRangeMoveCommands(
  plan: readonly RangeMovePlanEntry[],
): MoveKeyframesCommand[] {
  return plan.map(
    (entry) =>
      new MoveKeyframesCommand({
        target: entry.target,
        moves: entry.moves,
      }),
  )
}

/** Total keyframe count across a plan (for confirm-button labels). */
export function countPlannedMoves(plan: readonly RangeMovePlanEntry[]): number {
  let total = 0
  for (const entry of plan) {
    total += entry.moves.length
  }
  return total
}
