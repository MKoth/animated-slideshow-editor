import { describe, expect, it } from 'vitest'
import {
  FRAME_STEP,
  snapToFrameGrid,
  nearestKeyframeTime,
  pixelThresholdToTime,
  snapKeyframeTime,
} from '../../engine/timelineSnapping'

describe('FRAME_STEP', () => {
  it('is 0.5 s', () => {
    expect(FRAME_STEP).toBe(0.5)
  })
})

describe('snapToFrameGrid', () => {
  it('returns the original time when disabled', () => {
    expect(snapToFrameGrid(0.123, false)).toBe(0.123)
  })

  it('snaps to the nearest 0.5 s boundary', () => {
    expect(snapToFrameGrid(0, true)).toBe(0)
    expect(snapToFrameGrid(0.1, true)).toBe(0)
    expect(snapToFrameGrid(0.2, true)).toBe(0)
    expect(snapToFrameGrid(0.3, true)).toBe(0.5)
    expect(snapToFrameGrid(0.5, true)).toBe(0.5)
    expect(snapToFrameGrid(0.7, true)).toBe(0.5)
    expect(snapToFrameGrid(0.8, true)).toBe(1)
    expect(snapToFrameGrid(1, true)).toBe(1)
  })

  it('handles fractional boundaries correctly', () => {
    expect(snapToFrameGrid(0.24, true)).toBe(0)
    expect(snapToFrameGrid(0.26, true)).toBe(0.5)
    expect(snapToFrameGrid(0.75, true)).toBe(1)
  })
})

describe('pixelThresholdToTime', () => {
  it('converts pixels to seconds using pixels-per-second', () => {
    expect(pixelThresholdToTime(5, 100)).toBe(0.05)
    expect(pixelThresholdToTime(10, 200)).toBe(0.05)
    expect(pixelThresholdToTime(5, 50)).toBe(0.1)
  })
})

describe('nearestKeyframeTime', () => {
  it('returns null when no candidates exist', () => {
    expect(nearestKeyframeTime(0.5, [], 0.05)).toBeNull()
  })

  it('returns null when no candidate is within threshold', () => {
    expect(nearestKeyframeTime(0.5, [0, 1], 0.05)).toBeNull()
  })

  it('returns the nearest candidate within threshold', () => {
    expect(nearestKeyframeTime(0.5, [0.48, 0.52], 0.05)).toBe(0.48)
    expect(nearestKeyframeTime(0.5, [0, 0.49], 0.05)).toBe(0.49)
  })

  it('returns null when exactly at threshold boundary (exclusive)', () => {
    expect(nearestKeyframeTime(0.5, [0.55], 0.05)).toBeNull()
  })

  it('handles multiple candidates, returning the nearest', () => {
    expect(nearestKeyframeTime(0.5, [0.3, 0.48, 0.53], 0.05)).toBe(0.48)
  })
})

describe('snapKeyframeTime', () => {
  const pps = 100

  it('returns the original time when both snaps are disabled', () => {
    expect(
      snapKeyframeTime(0.123, {
        gridEnabled: false,
        keyframesEnabled: false,
        candidateTimes: [],
        pps,
      }),
    ).toBe(0.123)
  })

  it('snaps to grid when grid is enabled and no keyframes nearby', () => {
    const result = snapKeyframeTime(0.005, {
      gridEnabled: true,
      keyframesEnabled: false,
      candidateTimes: [],
      pps,
    })
    expect(result).toBe(0)
  })

  it('snaps to grid when grid is enabled but keyframe snap is off', () => {
    const result = snapKeyframeTime(0.005, {
      gridEnabled: true,
      keyframesEnabled: false,
      candidateTimes: [0.008],
      pps,
    })
    expect(result).toBe(0)
  })

  it('snaps to a nearby keyframe when keyframe snap is enabled', () => {
    const result = snapKeyframeTime(0.501, {
      gridEnabled: true,
      keyframesEnabled: true,
      candidateTimes: [0.5],
      pps,
    })
    expect(result).toBe(0.5)
  })

  it('falls back to grid when no keyframe is within threshold', () => {
    const result = snapKeyframeTime(0.005, {
      gridEnabled: true,
      keyframesEnabled: true,
      candidateTimes: [0.5],
      pps,
    })
    expect(result).toBe(0)
  })

  it('returns the original time when neither grid nor keyframe snap applies', () => {
    const result = snapKeyframeTime(0.123, {
      gridEnabled: false,
      keyframesEnabled: false,
      candidateTimes: [0.12],
      pps,
    })
    expect(result).toBe(0.123)
  })

  it('keyframe snap wins over grid snap when both are enabled', () => {
    const result = snapKeyframeTime(0.12, {
      gridEnabled: true,
      keyframesEnabled: true,
      candidateTimes: [0.125],
      pps,
    })
    expect(result).toBe(0.125)
  })

  it('uses a default 5 px threshold when not specified', () => {
    const result = snapKeyframeTime(0.501, {
      gridEnabled: true,
      keyframesEnabled: true,
      candidateTimes: [0.5],
      pps: 100,
    })
    expect(result).toBe(0.5)
  })
})
