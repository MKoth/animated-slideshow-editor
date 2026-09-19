import type { KeyframeTarget } from '../engine'
import { DeleteKeyframesCommand } from '../engine/commands'
import { inSegment } from '../engine/timeSegmentExtraction'
import type { RangeNodeSnapshot, RangeTrackSnapshot } from './rangeKeyframes'

/** DOM test id for a track checkbox. Property tracks keep their legacy test id. */
export function rangeTrackTestId(nodeId: string, track: RangeTrackSnapshot): string {
  if (track.target.kind === 'node' && 'property' in track.target) {
    return `delete-range-prop-${nodeId}-${track.target.property}`
  }
  return `delete-range-track-${nodeId}-${track.trackKey}`
}

export interface RangeDeletePlanEntry {
  readonly target: KeyframeTarget
  readonly keyframeIds: readonly string[]
}

/**
 * Build one plan entry per checked track that has at least one keyframe in
 * `[from, to]`. Unchecked tracks and empty tracks are skipped so no no-op
 * commands are dispatched.
 */
export function planRangeDelete(
  snapshots: readonly RangeNodeSnapshot[],
  from: number,
  to: number,
  isChecked: (nodeId: string, track: RangeTrackSnapshot) => boolean = () => true,
): RangeDeletePlanEntry[] {
  const plan: RangeDeletePlanEntry[] = []
  for (const snapshot of snapshots) {
    for (const track of snapshot.tracks) {
      if (!isChecked(snapshot.nodeId, track)) {
        continue
      }
      const keyframeIds: string[] = []
      for (const time of track.times) {
        if (inSegment(time.time, from, to)) {
          keyframeIds.push(time.id)
        }
      }
      if (keyframeIds.length > 0) {
        plan.push({ target: track.target, keyframeIds })
      }
    }
  }
  return plan
}

/** Map a range-delete plan to one `DeleteKeyframesCommand` per track. */
export function buildRangeDeleteCommands(
  plan: readonly RangeDeletePlanEntry[],
): DeleteKeyframesCommand[] {
  return plan.map(
    (entry) =>
      new DeleteKeyframesCommand({
        target: entry.target,
        keyframeIds: entry.keyframeIds,
      }),
  )
}

/** Total keyframe count across a plan (for confirm-button labels). */
export function countPlannedDeletes(plan: readonly RangeDeletePlanEntry[]): number {
  let total = 0
  for (const entry of plan) {
    total += entry.keyframeIds.length
  }
  return total
}
