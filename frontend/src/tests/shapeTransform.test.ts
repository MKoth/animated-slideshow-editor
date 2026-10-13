import { describe, expect, it } from 'vitest'
import { applyShapeTransform, describeShapeTransform, shapeCentroid } from '../ai/shapeTransform'

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('shapeTransform', () => {
  it('computes the centroid', () => {
    expect(shapeCentroid(SQUARE)).toEqual({ cx: 5, cy: 5 })
  })

  it('rotates 90 degrees around the pivot', () => {
    const result = applyShapeTransform([{ x: 10, y: 0 }], {
      type: 'rotate',
      degrees: 90,
      cx: 0,
      cy: 0,
    })
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.vertices[0]!.x).toBeCloseTo(0, 9)
    expect(result.vertices[0]!.y).toBeCloseTo(10, 9)
  })

  it('rotating 360 degrees returns the input', () => {
    const result = applyShapeTransform(SQUARE, {
      type: 'rotate',
      degrees: 360,
      cx: 5,
      cy: 5,
    })
    expect('error' in result).toBe(false)
    if ('error' in result) return
    for (const [index, vertex] of result.vertices.entries()) {
      expect(vertex.x).toBeCloseTo(SQUARE[index]!.x, 9)
      expect(vertex.y).toBeCloseTo(SQUARE[index]!.y, 9)
    }
  })

  it('scales about the pivot and translates', () => {
    const scaled = applyShapeTransform([{ x: 10, y: 10 }], {
      type: 'scale',
      sx: 2,
      sy: 0.5,
      cx: 0,
      cy: 0,
    })
    expect(scaled).toEqual({ vertices: [{ x: 20, y: 5 }] })
    const moved = applyShapeTransform([{ x: 1, y: 2 }], {
      type: 'translate',
      dx: 10,
      dy: -5,
    })
    expect(moved).toEqual({ vertices: [{ x: 11, y: -3 }] })
  })

  it('mirrors across the centroid axis', () => {
    const mirrored = applyShapeTransform([{ x: 0, y: 7 }], {
      type: 'mirror',
      axis: 'x',
      cx: 5,
      cy: 5,
    })
    expect(mirrored).toEqual({ vertices: [{ x: 10, y: 7 }] })
  })

  it('blends toward the donor by factor t', () => {
    const donor = [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ]
    const half = applyShapeTransform(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { type: 'blend', t: 0.5 },
      donor,
    )
    expect(half).toEqual({
      vertices: [
        { x: 50, y: 50 },
        { x: 55, y: 55 },
      ],
    })
    const full = applyShapeTransform([{ x: 0, y: 0 }], { type: 'blend', t: 1 }, [{ x: 3, y: 4 }])
    expect(full).toEqual({ vertices: [{ x: 3, y: 4 }] })
  })

  it('rejects blend count mismatches and empty inputs', () => {
    expect(
      applyShapeTransform([{ x: 0, y: 0 }], { type: 'blend', t: 0.5 }, [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toMatchObject({ error: expect.stringContaining('different vertex counts') })
    expect(applyShapeTransform([], { type: 'translate', dx: 1, dy: 1 })).toMatchObject({
      error: expect.stringContaining('no vertices'),
    })
  })

  it('preserves the vertex count for every transform', () => {
    const transforms = [
      { type: 'rotate', degrees: -80, cx: 5, cy: 5 },
      { type: 'scale', sx: 1.2, sy: 0.9, cx: 5, cy: 5 },
      { type: 'translate', dx: 3, dy: -7 },
      { type: 'mirror', axis: 'y', cx: 5, cy: 5 },
      { type: 'blend', t: 0.25 },
    ] as const
    for (const transform of transforms) {
      const donor = SQUARE.map(({ x, y }) => ({ x: x + 1, y: y - 1 }))
      const result = applyShapeTransform(SQUARE, transform, donor)
      expect('error' in result).toBe(false)
      if ('error' in result) continue
      expect(result.vertices).toHaveLength(SQUARE.length)
    }
  })

  it('summarizes transforms for titles', () => {
    expect(describeShapeTransform({ type: 'rotate', degrees: -80, cx: 0, cy: 0 })).toBe(
      'rotate -80°',
    )
    expect(describeShapeTransform({ type: 'blend', t: 0.5 })).toBe('blend 50%')
  })
})
