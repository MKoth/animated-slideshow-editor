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

  it('bounce: starts at from-value, ends at to-value, bounces in between', () => {
    const from = keyframe(0, 0, 'bounce')
    const to = keyframe(2, 10, 'bounce')

    expect(evaluateSegment(from, to, 0)).toBeCloseTo(0)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(10)

    const atQuarter = evaluateSegment(from, to, 0.5)
    expect(atQuarter).toBeGreaterThan(0)
    expect(atQuarter).toBeLessThan(10)

    const atHalf = evaluateSegment(from, to, 1)
    expect(atHalf).toBeGreaterThan(5)
    expect(atHalf).toBeLessThan(10)
  })

  it('bounce: is deterministic across repeated evaluations', () => {
    const from = keyframe(0, 0, 'bounce')
    const to = keyframe(2, 10, 'bounce')

    const first = evaluateSegment(from, to, 0.75)
    const second = evaluateSegment(from, to, 0.75)
    expect(first).toBeCloseTo(second)
  })

  it('bounce: scales correctly with non-zero from-value', () => {
    const from = keyframe(0, 5, 'bounce')
    const to = keyframe(2, 15, 'bounce')

    expect(evaluateSegment(from, to, 0)).toBeCloseTo(5)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(15)
  })

  it('elastic: starts at from-value, ends at to-value, oscillates in between', () => {
    const from = keyframe(0, 0, 'elastic')
    const to = keyframe(2, 10, 'elastic')

    expect(evaluateSegment(from, to, 0)).toBeCloseTo(0)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(10)

    const atMid = evaluateSegment(from, to, 1)
    expect(atMid).toBeGreaterThan(10)

    const atThreeQuarters = evaluateSegment(from, to, 1.5)
    expect(atThreeQuarters).toBeGreaterThan(9)
    expect(atThreeQuarters).toBeLessThan(11)
  })

  it('elastic: is deterministic across repeated evaluations', () => {
    const from = keyframe(0, 0, 'elastic')
    const to = keyframe(2, 10, 'elastic')

    const first = evaluateSegment(from, to, 0.5)
    const second = evaluateSegment(from, to, 0.5)
    expect(first).toBeCloseTo(second)
  })

  it('elastic: scales correctly with non-zero from-value', () => {
    const from = keyframe(0, 5, 'elastic')
    const to = keyframe(2, 15, 'elastic')

    expect(evaluateSegment(from, to, 0)).toBeCloseTo(5)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(15)
  })

  it('spring: starts at from-value, ends at to-value, overshoots in between', () => {
    const from = keyframe(0, 0, 'spring')
    const to = keyframe(2, 10, 'spring')

    expect(evaluateSegment(from, to, 0)).toBeCloseTo(0)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(10)

    const atMid = evaluateSegment(from, to, 0.5)
    expect(atMid).toBeGreaterThan(10)
  })

  it('spring: is deterministic across repeated evaluations', () => {
    const from = keyframe(0, 0, 'spring')
    const to = keyframe(2, 10, 'spring')

    const first = evaluateSegment(from, to, 0.75)
    const second = evaluateSegment(from, to, 0.75)
    expect(first).toBeCloseTo(second)
  })

  it('spring: scales correctly with non-zero from-value', () => {
    const from = keyframe(0, 5, 'spring')
    const to = keyframe(2, 15, 'spring')

    expect(evaluateSegment(from, to, 0)).toBeCloseTo(5)
    expect(evaluateSegment(from, to, 2)).toBeCloseTo(15)
  })
})

describe('interpolator registry', () => {
  it('dispatches segments through the registry — new interpolators register without touching evaluation logic', () => {
    const unregister = registerSegmentInterpolator('customWave', () => 42)
    try {
      const from = keyframe(0, 0, 'customWave' as InterpolationType)
      const to = keyframe(1, 10, 'customWave' as InterpolationType)

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

  it('built-in parametric interpolators are registered by default', () => {
    const bounceFrom = keyframe(0, 0, 'bounce')
    const bounceTo = keyframe(2, 10, 'bounce')
    expect(evaluateSegment(bounceFrom, bounceTo, 0)).toBeCloseTo(0)
    expect(evaluateSegment(bounceFrom, bounceTo, 2)).toBeCloseTo(10)

    const elasticFrom = keyframe(0, 0, 'elastic')
    const elasticTo = keyframe(2, 10, 'elastic')
    expect(evaluateSegment(elasticFrom, elasticTo, 0)).toBeCloseTo(0)
    expect(evaluateSegment(elasticFrom, elasticTo, 2)).toBeCloseTo(10)

    const springFrom = keyframe(0, 0, 'spring')
    const springTo = keyframe(2, 10, 'spring')
    expect(evaluateSegment(springFrom, springTo, 0)).toBeCloseTo(0)
    expect(evaluateSegment(springFrom, springTo, 2)).toBeCloseTo(10)
  })
})
