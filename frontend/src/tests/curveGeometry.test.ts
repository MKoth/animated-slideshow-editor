import { describe, expect, it } from 'vitest'
import {
  worldToScreen,
  screenToWorld,
  computeCurvePoints,
  computeTangentHandlePositions,
  hitTestKeyframe,
  hitTestTangentHandle,
  isSegmentVisible,
  computeCurveBounds,
} from '../engine/curveGeometry'
import type { CurveData, CurveViewport } from '../engine/curveGeometry'
import { Keyframe } from '../engine/keyframe'

function makeViewport(overrides?: Partial<CurveViewport>): CurveViewport {
  return {
    scrollX: 0,
    scrollY: 0,
    zoomLevel: 100,
    canvasWidth: 800,
    canvasHeight: 400,
    trackHeaderWidth: 240,
    ...overrides,
  }
}

function makeKeyframe(
  time: number,
  value: number,
  interp: 'hold' | 'linear' | 'bezier' = 'linear',
  tangentInTime = 0,
  tangentInValue = 0,
  tangentOutTime = 0,
  tangentOutValue = 0,
): Keyframe {
  const kf = new Keyframe(`kf-${time}-${value}`, time, value, interp)
  if (tangentInTime !== 0 || tangentInValue !== 0) {
    kf.tangentIn = { time: tangentInTime, value: tangentInValue }
  }
  if (tangentOutTime !== 0 || tangentOutValue !== 0) {
    kf.tangentOut = { time: tangentOutTime, value: tangentOutValue }
  }
  return kf
}

function makeCurve(keyframes: Keyframe[], color = '#ff0000'): CurveData {
  return {
    nodeId: 'node-1',
    property: 'positionX',
    label: 'Position X',
    keyframes,
    color,
  }
}

describe('curveGeometry', () => {
  describe('worldToScreen / screenToWorld', () => {
    it('converts world coordinates to screen coordinates', () => {
      const viewport = makeViewport()
      const result = worldToScreen(1, 50, viewport)
      expect(result.x).toBeCloseTo(240 + 1 * 100)
      expect(result.y).toBeCloseTo(400 / 2 - 50 * 100)
    })

    it('converts screen coordinates to world coordinates', () => {
      const viewport = makeViewport()
      const result = screenToWorld(340, -4800, viewport)
      expect(result.time).toBeCloseTo(1)
      expect(result.value).toBeCloseTo(50)
    })

    it('round-trips world -> screen -> world', () => {
      const viewport = makeViewport({ zoomLevel: 200 })
      const time = 2.5
      const value = 42
      const screen = worldToScreen(time, value, viewport)
      const world = screenToWorld(screen.x, screen.y, viewport)
      expect(world.time).toBeCloseTo(time)
      expect(world.value).toBeCloseTo(value)
    })

    it('accounts for scroll offset', () => {
      const viewport = makeViewport({ scrollX: 100 })
      const screen = worldToScreen(2, 0, viewport)
      expect(screen.x).toBeCloseTo(240 + (2 - 100) * 100)
    })

    it('accounts for zoom level', () => {
      const viewport = makeViewport({ zoomLevel: 200 })
      const screen = worldToScreen(1, 0, viewport)
      expect(screen.x).toBeCloseTo(240 + 1 * 200)
    })
  })

  describe('computeCurvePoints', () => {
    it('returns empty array for empty keyframes', () => {
      const curve = makeCurve([])
      const viewport = makeViewport()
      const points = computeCurvePoints(curve, viewport)
      expect(points).toEqual([])
    })

    it('returns single point for single keyframe', () => {
      const curve = makeCurve([makeKeyframe(1, 50)])
      const viewport = makeViewport()
      const points = computeCurvePoints(curve, viewport)
      expect(points.length).toBe(1)
      expect(points[0].x).toBeCloseTo(240 + 1 * 100)
      expect(points[0].y).toBeCloseTo(400 / 2 - 50 * 100)
    })

    it('samples linear interpolation between two keyframes', () => {
      const curve = makeCurve([makeKeyframe(0, 0), makeKeyframe(2, 100)])
      const viewport = makeViewport()
      const points = computeCurvePoints(curve, viewport)
      expect(points.length).toBeGreaterThan(2)
      const first = points[0]
      const last = points[points.length - 1]
      expect(first.x).toBeCloseTo(240)
      expect(first.y).toBeCloseTo(400 / 2)
      expect(last.x).toBeCloseTo(240 + 200)
      expect(last.y).toBeCloseTo(400 / 2 - 100 * 100)
    })

    it('samples hold interpolation as step', () => {
      const curve = makeCurve([makeKeyframe(0, 0, 'hold'), makeKeyframe(2, 100, 'hold')])
      const viewport = makeViewport()
      const points = computeCurvePoints(curve, viewport)
      expect(points.length).toBeGreaterThan(2)
      const midIndex = Math.floor(points.length / 2)
      expect(points[midIndex].value).toBeCloseTo(0)
    })

    it('culls segments outside viewport', () => {
      const curve = makeCurve([makeKeyframe(100, 0), makeKeyframe(200, 0)])
      const viewport = makeViewport({ canvasWidth: 240 })
      const points = computeCurvePoints(curve, viewport)
      expect(points.length).toBe(0)
    })
  })

  describe('computeTangentHandlePositions', () => {
    it('returns null for non-bezier keyframe', () => {
      const kf = makeKeyframe(1, 50, 'linear')
      const viewport = makeViewport()
      const result = computeTangentHandlePositions(kf, viewport)
      expect(result).toBeNull()
    })

    it('returns handle positions for bezier keyframe', () => {
      const kf = makeKeyframe(1, 50, 'bezier', -0.5, -20, 0.5, 20)
      const viewport = makeViewport()
      const result = computeTangentHandlePositions(kf, viewport)
      expect(result).not.toBeNull()
      expect(result!.in).not.toBeNull()
      expect(result!.out).not.toBeNull()
    })

    it('computes correct in-handle position', () => {
      const kf = makeKeyframe(1, 50, 'bezier', -0.5, -20, 0, 0)
      const viewport = makeViewport()
      const result = computeTangentHandlePositions(kf, viewport)
      const inHandle = worldToScreen(1 + -0.5, 50 + -20, viewport)
      expect(result!.in!.x).toBeCloseTo(inHandle.x)
      expect(result!.in!.y).toBeCloseTo(inHandle.y)
    })

    it('computes correct out-handle position', () => {
      const kf = makeKeyframe(1, 50, 'bezier', 0, 0, 0.5, 20)
      const viewport = makeViewport()
      const result = computeTangentHandlePositions(kf, viewport)
      const outHandle = worldToScreen(1 + 0.5, 50 + 20, viewport)
      expect(result!.out!.x).toBeCloseTo(outHandle.x)
      expect(result!.out!.y).toBeCloseTo(outHandle.y)
    })

    it('returns null in/out when tangent is zero', () => {
      const kf = makeKeyframe(1, 50, 'bezier')
      const viewport = makeViewport()
      const result = computeTangentHandlePositions(kf, viewport)
      expect(result).not.toBeNull()
      expect(result!.in).toBeNull()
      expect(result!.out).toBeNull()
    })
  })

  describe('hitTestKeyframe', () => {
    it('returns null when no keyframes', () => {
      const viewport = makeViewport()
      const result = hitTestKeyframe(240, 200, [], viewport)
      expect(result).toBeNull()
    })

    it('hits a keyframe within radius', () => {
      const kf = makeKeyframe(1, 50)
      const viewport = makeViewport()
      const screen = worldToScreen(1, 50, viewport)
      const result = hitTestKeyframe(screen.x, screen.y, [kf], viewport)
      expect(result).toBe(kf.id)
    })

    it('misses a keyframe outside radius', () => {
      const kf = makeKeyframe(10, 50)
      const viewport = makeViewport()
      const result = hitTestKeyframe(240, 200, [kf], viewport)
      expect(result).toBeNull()
    })
  })

  describe('hitTestTangentHandle', () => {
    it('returns null for non-bezier keyframe', () => {
      const kf = makeKeyframe(1, 50, 'linear')
      const viewport = makeViewport()
      const result = hitTestTangentHandle(240, 200, kf, viewport)
      expect(result).toBeNull()
    })

    it('hits in-handle', () => {
      const kf = makeKeyframe(1, 50, 'bezier', -0.5, -20, 0.5, 20)
      const viewport = makeViewport()
      const inPos = worldToScreen(1 + -0.5, 50 + -20, viewport)
      const result = hitTestTangentHandle(inPos.x, inPos.y, kf, viewport)
      expect(result).toBe('in')
    })

    it('hits out-handle', () => {
      const kf = makeKeyframe(1, 50, 'bezier', -0.5, -20, 0.5, 20)
      const viewport = makeViewport()
      const outPos = worldToScreen(1 + 0.5, 50 + 20, viewport)
      const result = hitTestTangentHandle(outPos.x, outPos.y, kf, viewport)
      expect(result).toBe('out')
    })

    it('misses when far from handles', () => {
      const kf = makeKeyframe(1, 50, 'bezier', -0.5, -20, 0.5, 20)
      const viewport = makeViewport()
      const result = hitTestTangentHandle(500, 500, kf, viewport)
      expect(result).toBeNull()
    })
  })

  describe('isSegmentVisible', () => {
    it('returns true for segment in viewport', () => {
      const viewport = makeViewport()
      expect(isSegmentVisible(0, 2, viewport)).toBe(true)
    })

    it('returns false for segment entirely to the left', () => {
      const viewport = makeViewport({ canvasWidth: 400 })
      expect(isSegmentVisible(-10, -5, viewport)).toBe(false)
    })

    it('returns false for segment entirely to the right', () => {
      const viewport = makeViewport()
      expect(isSegmentVisible(1000, 2000, viewport)).toBe(false)
    })

    it('returns true for partially visible segment', () => {
      const viewport = makeViewport()
      expect(isSegmentVisible(-1, 1, viewport)).toBe(true)
    })
  })

  describe('computeCurveBounds', () => {
    it('returns null for empty curves', () => {
      expect(computeCurveBounds([])).toBeNull()
    })

    it('computes bounds for a single keyframe', () => {
      const curves = [makeCurve([makeKeyframe(1, 50)])]
      const bounds = computeCurveBounds(curves)
      expect(bounds).not.toBeNull()
      expect(bounds!.minTime).toBeCloseTo(1)
      expect(bounds!.maxTime).toBeCloseTo(1)
      expect(bounds!.minValue).toBeCloseTo(50)
      expect(bounds!.maxValue).toBeCloseTo(50)
    })

    it('computes bounds across multiple curves', () => {
      const curves = [
        makeCurve([makeKeyframe(0, 0), makeKeyframe(2, 100)]),
        makeCurve([makeKeyframe(1, -50), makeKeyframe(3, 50)], '#00ff00'),
      ]
      const bounds = computeCurveBounds(curves)
      expect(bounds).not.toBeNull()
      expect(bounds!.minTime).toBeCloseTo(0)
      expect(bounds!.maxTime).toBeCloseTo(3)
      expect(bounds!.minValue).toBeCloseTo(-50)
      expect(bounds!.maxValue).toBeCloseTo(100)
    })

    it('returns null for curves with no keyframes', () => {
      const curves = [makeCurve([])]
      expect(computeCurveBounds(curves)).toBeNull()
    })
  })
})
