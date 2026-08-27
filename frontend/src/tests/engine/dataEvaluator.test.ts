import { describe, expect, it } from 'vitest'
import type { DataKeyframe, DataPoint } from '../../engine/components'
import { DataSourceDefinition } from '../../engine/dataSourceDefinition'
import { evaluateData } from '../../engine/dataEvaluator'

function ds(points: readonly DataPoint[], id = 'ds-1', name = 'Test Data'): DataSourceDefinition {
  return new DataSourceDefinition(id, name, points)
}

const pointsA: DataPoint[] = [
  { label: 'X', value: 10 },
  { label: 'Y', value: 20 },
]

const pointsB: DataPoint[] = [
  { label: 'X', value: 30 },
  { label: 'Y', value: 40 },
]

const pointsC: DataPoint[] = [
  { label: 'X', value: 50 },
  { label: 'Y', value: 60 },
]

function kf(time: number, dataPoints: readonly DataPoint[]): DataKeyframe {
  return { time, dataPoints }
}

describe('evaluateData', () => {
  describe('no keyframes', () => {
    it('returns data from DataSourceDefinition when no keyframes exist', () => {
      const definition = ds(pointsA)
      const result = evaluateData([], definition, 0)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })

    it('returns empty arrays when no keyframes and no definition', () => {
      const result = evaluateData([], undefined, 0)
      expect(result.from).toEqual([])
      expect(result.to).toEqual([])
      expect(result.t).toBe(0)
    })

    it('returns definition data regardless of time when no keyframes', () => {
      const definition = ds(pointsA)
      const result = evaluateData([], definition, 999)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })
  })

  describe('single keyframe', () => {
    it('returns the single keyframe snapshot at any time', () => {
      const keyframes = [kf(1, pointsA)]
      const result = evaluateData(keyframes, undefined, 0)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })

    it('returns the single keyframe snapshot at a later time', () => {
      const keyframes = [kf(5, pointsB)]
      const result = evaluateData(keyframes, undefined, 10)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0)
    })

    it('returns the single keyframe snapshot at an earlier time', () => {
      const keyframes = [kf(5, pointsB)]
      const result = evaluateData(keyframes, undefined, 0)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0)
    })
  })

  describe('exact keyframe match', () => {
    it('returns t=0 when time matches a keyframe exactly', () => {
      const keyframes = [kf(0, pointsA), kf(5, pointsB)]
      const result = evaluateData(keyframes, undefined, 5)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0)
    })

    it('returns t=0 when time matches the first keyframe exactly', () => {
      const keyframes = [kf(0, pointsA), kf(5, pointsB)]
      const result = evaluateData(keyframes, undefined, 0)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })
  })

  describe('time before first keyframe', () => {
    it('returns the first keyframe snapshot when time is before all keyframes', () => {
      const keyframes = [kf(2, pointsA), kf(5, pointsB)]
      const result = evaluateData(keyframes, undefined, 0)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })

    it('returns the first keyframe snapshot when time is negative', () => {
      const keyframes = [kf(3, pointsA), kf(6, pointsB)]
      const result = evaluateData(keyframes, undefined, -10)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })
  })

  describe('time after last keyframe', () => {
    it('returns the last keyframe snapshot when time is after all keyframes', () => {
      const keyframes = [kf(0, pointsA), kf(2, pointsB)]
      const result = evaluateData(keyframes, undefined, 10)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0)
    })
  })

  describe('between two keyframes', () => {
    it('returns two surrounding keyframes with correct interpolation factor', () => {
      const keyframes = [kf(0, pointsA), kf(10, pointsB)]
      const result = evaluateData(keyframes, undefined, 5)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0.5)
    })

    it('returns correct t at quarter point', () => {
      const keyframes = [kf(0, pointsA), kf(10, pointsB)]
      const result = evaluateData(keyframes, undefined, 2.5)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0.25)
    })

    it('returns correct t near the end of the segment', () => {
      const keyframes = [kf(0, pointsA), kf(10, pointsB)]
      const result = evaluateData(keyframes, undefined, 9)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0.9)
    })

    it('selects correct pair among multiple keyframes', () => {
      const keyframes = [kf(0, pointsA), kf(5, pointsB), kf(10, pointsC)]
      const result = evaluateData(keyframes, undefined, 7)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsC)
      expect(result.t).toBe(0.4)
    })

    it('returns t close to 0 near the start of a segment', () => {
      const keyframes = [kf(0, pointsA), kf(10, pointsB)]
      const result = evaluateData(keyframes, undefined, 0.1)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBeCloseTo(0.01)
    })
  })

  describe('keyframes not starting at time 0', () => {
    it('returns correct interpolation when keyframes start later', () => {
      const keyframes = [kf(100, pointsA), kf(200, pointsB)]
      const result = evaluateData(keyframes, undefined, 150)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0.5)
    })

    it('clamps to first keyframe when time is before it', () => {
      const keyframes = [kf(100, pointsA), kf(200, pointsB)]
      const result = evaluateData(keyframes, undefined, 0)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })

    it('clamps to last keyframe when time is after it', () => {
      const keyframes = [kf(100, pointsA), kf(200, pointsB)]
      const result = evaluateData(keyframes, undefined, 300)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0)
    })
  })

  describe('definition ignored when keyframes exist', () => {
    it('uses keyframe data instead of definition data', () => {
      const definition = ds(pointsC)
      const keyframes = [kf(0, pointsA)]
      const result = evaluateData(keyframes, definition, 0)
      expect(result.from).toEqual(pointsA)
      expect(result.to).toEqual(pointsA)
      expect(result.t).toBe(0)
    })
  })

  describe('edge: equal time keyframes', () => {
    it('returns the later keyframe when two keyframes share the same time', () => {
      const keyframes = [kf(5, pointsA), kf(5, pointsB)]
      const result = evaluateData(keyframes, undefined, 5)
      expect(result.from).toEqual(pointsB)
      expect(result.to).toEqual(pointsB)
      expect(result.t).toBe(0)
    })
  })

  describe('immutability', () => {
    it('returns a new array on each call', () => {
      const keyframes = [kf(0, pointsA), kf(10, pointsB)]
      const r1 = evaluateData(keyframes, undefined, 5)
      const r2 = evaluateData(keyframes, undefined, 5)
      expect(r1.from).toEqual(r2.from)
      expect(r1.from).not.toBe(r2.from)
      expect(r1.to).not.toBe(r2.to)
    })
  })
})
