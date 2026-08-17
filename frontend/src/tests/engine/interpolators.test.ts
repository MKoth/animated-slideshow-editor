import { describe, expect, it } from 'vitest'
import type { InterpolationType, KeyframeTangent } from '../../engine/keyframe'
import { Keyframe, ZERO_TANGENT } from '../../engine/keyframe'
import { evaluateSegment, registerSegmentInterpolator } from '../../engine/interpolators'

function keyframe(
  time: number,
  value: number,
  interpolation: InterpolationType = 'linear',
  tangentIn: KeyframeTangent = ZERO_TANGENT,
  tangentOut: KeyframeTangent = ZERO_TANGENT,
): Keyframe {
  return new Keyframe(`kf-${time}-${value}`, time, value, interpolation, tangentIn, tangentOut)
}

describe('segment interpolators', () => {
  it('linear: blends between the segment keyframes at the beginning, middle, and end', () => {
    const from = keyframe(1, 10)
    const to = keyframe(3, 30)

    expect(evaluateSegment(from, to, 1)).toBe(10)
    expect(evaluateSegment(from, to, 1.5)).toBe(15)
    expect(evaluateSegment(from, to, 2)).toBe(20)
    expect(evaluateSegment(from, to, 3)).toBe(30)
  })

  it('hold: stays constant at the from-keyframe value until the next keyframe', () => {
    const from = keyframe(1, 10, 'hold')
    const to = keyframe(3, 30, 'hold')

    expect(evaluateSegment(from, to, 1)).toBe(10)
    expect(evaluateSegment(from, to, 2)).toBe(10)
    expect(evaluateSegment(from, to, 2.999)).toBe(10)
  })

  it('bezier with zero-length tangents equals linear', () => {
    const from = keyframe(0, 0, 'bezier')
    const to = keyframe(2, 10, 'bezier')

    expect(evaluateSegment(from, to, 0.5)).toBeCloseTo(2.5)
    expect(evaluateSegment(from, to, 1)).toBeCloseTo(5)
    expect(evaluateSegment(from, to, 1.5)).toBeCloseTo(7.5)
  })

  it('bezier with symmetric value tangents keeps the S-curve midpoint', () => {
    const from = keyframe(0, 0, 'bezier', ZERO_TANGENT, { time: 0, value: 0.5 })
    const to = keyframe(2, 1, 'bezier', { time: 0, value: -0.5 }, ZERO_TANGENT)

    expect(evaluateSegment(from, to, 1)).toBeCloseTo(0.5)
    expect(evaluateSegment(from, to, 0)).toBeCloseTo(0)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(1)
  })

  it('bezier can overshoot the segment values through its tangents', () => {
    const from = keyframe(0, 0, 'bezier', ZERO_TANGENT, { time: 0, value: 2 })
    const to = keyframe(2, 1, 'bezier', { time: 0, value: 2 }, ZERO_TANGENT)

    const atMid = evaluateSegment(from, to, 1)
    expect(atMid).toBeCloseTo(2)
    expect(atMid).toBeGreaterThan(1)
  })

  it('bezier respects the tangent time offsets when solving for the curve time', () => {
    const from = keyframe(0, 0, 'bezier', ZERO_TANGENT, { time: 1, value: 0 })
    const to = keyframe(2, 2, 'bezier', { time: 0, value: -1 }, ZERO_TANGENT)

    expect(evaluateSegment(from, to, 1.375)).toBeCloseTo(0.625)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(2)
  })

  it('bezier is deterministic across repeated evaluations of different segments', () => {
    const first = keyframe(0, 0, 'bezier', ZERO_TANGENT, { time: 1, value: 0 })
    const firstTo = keyframe(2, 2, 'bezier', { time: 0, value: -1 }, ZERO_TANGENT)
    const second = keyframe(0, 5, 'bezier', ZERO_TANGENT, { time: 0, value: 2 })
    const secondTo = keyframe(2, 10, 'bezier', { time: 0, value: 2 }, ZERO_TANGENT)

    expect(evaluateSegment(first, firstTo, 1.375)).toBeCloseTo(0.625)
    expect(evaluateSegment(second, secondTo, 1)).toBeCloseTo(9)
    expect(evaluateSegment(first, firstTo, 1.375)).toBeCloseTo(0.625)
  })
})

describe('interpolator registry', () => {
  it('dispatches segments through the registry — new interpolators register without touching evaluation logic', () => {
    const unregister = registerSegmentInterpolator('bounce', () => 42)
    try {
      const from = keyframe(0, 0, 'bounce' as InterpolationType)
      const to = keyframe(1, 10, 'bounce' as InterpolationType)

      expect(evaluateSegment(from, to, 0.25)).toBe(42)
      expect(evaluateSegment(from, to, 0.9)).toBe(42)
    } finally {
      unregister()
    }
  })

  it('falls back to linear for an unregistered interpolation name', () => {
    const from = keyframe(0, 0, 'future' as InterpolationType)
    const to = keyframe(2, 10)

    expect(evaluateSegment(from, to, 0.5)).toBe(2.5)
  })

  it('unregistering restores the previous behavior', () => {
    const unregister = registerSegmentInterpolator('spike', () => -1)
    unregister()

    const from = keyframe(0, 0, 'spike' as InterpolationType)
    const to = keyframe(2, 10)

    expect(evaluateSegment(from, to, 0.5)).toBe(2.5)
  })
})
