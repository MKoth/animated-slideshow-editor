import { describe, expect, it } from 'vitest'
import type { EvaluatedData } from '../../engine/dataEvaluator'
import { interpolateDataPoints, evaluatedDataEqual } from '../../engine/dataEvaluator'

const pointsA = [
  { label: 'X', value: 10 },
  { label: 'Y', value: 20 },
]

const pointsB = [
  { label: 'X', value: 30 },
  { label: 'Y', value: 40 },
]

describe('interpolateDataPoints', () => {
  it('returns empty array when both inputs are empty', () => {
    const result = interpolateDataPoints({ from: [], to: [], t: 0.5 })
    expect(result).toEqual([])
  })

  it('returns from data when t is 0', () => {
    const result = interpolateDataPoints({ from: pointsA, to: pointsB, t: 0 })
    expect(result).toEqual(pointsA)
  })

  it('returns to data when t is 1', () => {
    const result = interpolateDataPoints({ from: pointsA, to: pointsB, t: 1 })
    expect(result).toEqual(pointsB)
  })

  it('interpolates values at midpoint', () => {
    const result = interpolateDataPoints({ from: pointsA, to: pointsB, t: 0.5 })
    expect(result[0]).toEqual({ label: 'X', value: 20 })
    expect(result[1]).toEqual({ label: 'Y', value: 30 })
  })

  it('interpolates values at quarter point', () => {
    const result = interpolateDataPoints({ from: pointsA, to: pointsB, t: 0.25 })
    expect(result[0]).toEqual({ label: 'X', value: 15 })
    expect(result[1]).toEqual({ label: 'Y', value: 25 })
  })

  it('handles labels only in from data', () => {
    const from = [
      { label: 'A', value: 10 },
      { label: 'B', value: 20 },
    ]
    const to = [{ label: 'A', value: 30 }]
    const result = interpolateDataPoints({ from, to, t: 0.5 })
    expect(result.length).toBe(2)
    expect(result.find((p) => p.label === 'A')?.value).toBe(20)
    expect(result.find((p) => p.label === 'B')?.value).toBe(20)
  })

  it('handles labels only in to data', () => {
    const from = [{ label: 'A', value: 10 }]
    const to = [
      { label: 'A', value: 30 },
      { label: 'B', value: 40 },
    ]
    const result = interpolateDataPoints({ from, to, t: 0.5 })
    expect(result.length).toBe(2)
    expect(result.find((p) => p.label === 'A')?.value).toBe(20)
    expect(result.find((p) => p.label === 'B')?.value).toBe(40)
  })

  it('preserves series, tooltip, and color from to data', () => {
    const from = [{ label: 'A', value: 10 }]
    const to = [{ label: 'A', value: 30, series: 'S1', tooltip: 'T1', color: '#FF0000' }]
    const result = interpolateDataPoints({ from, to, t: 0.5 })
    expect(result[0].series).toBe('S1')
    expect(result[0].tooltip).toBe('T1')
    expect(result[0].color).toBe('#FF0000')
  })

  it('falls back to from data properties when to data lacks them', () => {
    const from = [{ label: 'A', value: 10, series: 'S1', tooltip: 'T1', color: '#FF0000' }]
    const to = [{ label: 'A', value: 30 }]
    const result = interpolateDataPoints({ from, to, t: 0.5 })
    expect(result[0].series).toBe('S1')
    expect(result[0].tooltip).toBe('T1')
    expect(result[0].color).toBe('#FF0000')
  })

  it('preserves label order from to data', () => {
    const from = [
      { label: 'B', value: 20 },
      { label: 'A', value: 10 },
    ]
    const to = [
      { label: 'A', value: 30 },
      { label: 'B', value: 40 },
    ]
    const result = interpolateDataPoints({ from, to, t: 0.5 })
    expect(result[0].label).toBe('A')
    expect(result[1].label).toBe('B')
  })
})

describe('evaluatedDataEqual', () => {
  it('returns true for identical data', () => {
    const a: EvaluatedData = { from: pointsA, to: pointsB, t: 0.5 }
    const b: EvaluatedData = { from: pointsA, to: pointsB, t: 0.5 }
    expect(evaluatedDataEqual(a, b)).toBe(true)
  })

  it('returns false when t differs', () => {
    const a: EvaluatedData = { from: pointsA, to: pointsB, t: 0.5 }
    const b: EvaluatedData = { from: pointsA, to: pointsB, t: 0.6 }
    expect(evaluatedDataEqual(a, b)).toBe(false)
  })

  it('returns false when from differs', () => {
    const a: EvaluatedData = { from: pointsA, to: pointsB, t: 0.5 }
    const b: EvaluatedData = { from: pointsB, to: pointsB, t: 0.5 }
    expect(evaluatedDataEqual(a, b)).toBe(false)
  })

  it('returns false when to differs', () => {
    const a: EvaluatedData = { from: pointsA, to: pointsB, t: 0.5 }
    const b: EvaluatedData = { from: pointsA, to: pointsA, t: 0.5 }
    expect(evaluatedDataEqual(a, b)).toBe(false)
  })
})
