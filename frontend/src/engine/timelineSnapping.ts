/** The 0.5 s grid step used for timeline grid snapping (Spec 07 R7). */
export const FRAME_STEP = 0.5

/**
 * Snap a time value to the nearest 1/60 s frame boundary.
 * Returns the original time when `enabled` is false.
 */
export function snapToFrameGrid(time: number, enabled: boolean): number {
  if (!enabled) {
    return time
  }
  return Math.round(time / FRAME_STEP) * FRAME_STEP
}

/**
 * Convert a pixel threshold to a time threshold given pixels-per-second.
 */
export function pixelThresholdToTime(pixels: number, pps: number): number {
  return pixels / pps
}

/**
 * Find the nearest candidate time within the given time threshold.
 * Returns `null` when no candidate is close enough.
 */
export function nearestKeyframeTime(
  time: number,
  candidateTimes: readonly number[],
  threshold: number,
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const candidate of candidateTimes) {
    const dist = Math.abs(candidate - time)
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist
      best = candidate
    }
  }
  return best
}

export interface SnapOptions {
  readonly gridEnabled: boolean
  readonly keyframesEnabled: boolean
  readonly candidateTimes: readonly number[]
  readonly pps: number
}

const KEYFRAME_SNAP_THRESHOLD_PX = 5

/**
 * Unified timeline snap: apply keyframe snap first (if enabled), then grid
 * snap. Keyframe snap wins when a keyframe is within the pixel threshold.
 *
 * The order of precedence is:
 *  1. If keyframe snapping is enabled and a keyframe is within the
 *     pixel threshold, snap to that keyframe.
 *  2. Otherwise, if grid snapping is enabled, snap to the 1/60 s grid.
 *  3. Otherwise, return the time unchanged.
 */
export function snapKeyframeTime(time: number, options: SnapOptions): number {
  const { gridEnabled, keyframesEnabled, candidateTimes, pps } = options

  if (keyframesEnabled && candidateTimes.length > 0) {
    const threshold = pixelThresholdToTime(KEYFRAME_SNAP_THRESHOLD_PX, pps)
    const kfSnap = nearestKeyframeTime(time, candidateTimes, threshold)
    if (kfSnap !== null) {
      return kfSnap
    }
  }

  if (gridEnabled) {
    return snapToFrameGrid(time, true)
  }

  return time
}

export interface AudioSnapOptions {
  readonly gridEnabled: boolean
  readonly pps: number
  readonly gridStep: number
  readonly prompterBoundaries: readonly number[]
}

const PROMPTER_SNAP_THRESHOLD_PX = 8

export function snapAudioTime(time: number, options: AudioSnapOptions): number {
  const { gridEnabled, pps, gridStep, prompterBoundaries } = options

  if (prompterBoundaries.length > 0) {
    const threshold = pixelThresholdToTime(PROMPTER_SNAP_THRESHOLD_PX, pps)
    const snapped = nearestKeyframeTime(time, [...prompterBoundaries], threshold)
    if (snapped !== null) {
      return snapped
    }
  }

  if (gridEnabled) {
    const decimals = gridStep >= 1 ? 0 : gridStep >= 0.1 ? 1 : 2
    return Number((Math.round(time / gridStep) * gridStep).toFixed(decimals))
  }

  return time
}
