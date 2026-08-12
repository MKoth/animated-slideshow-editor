import { describe, expect, it } from 'vitest'
import { DEFAULT_GRID_STEP, snapDelta, snapPoint, snapToGrid } from '../../pixi/renderer/gridSnap'

describe('grid snap', () => {
  it('rounds a value to the nearest grid step', () => {
    expect(snapToGrid(12, 25)).toBe(0)
    expect(snapToGrid(38, 25)).toBe(50)
    expect(snapToGrid(150, 25)).toBe(150)
  })

  it('defaults the step to 25 world units', () => {
    expect(DEFAULT_GRID_STEP).toBe(25)
    expect(snapToGrid(27)).toBe(25)
  })

  it('snaps a point on both axes', () => {
    expect(snapPoint({ x: 38, y: -38 }, 25)).toEqual({ x: 50, y: -50 })
  })

  it('returns the input unchanged for a non-finite value or non-positive step', () => {
    expect(snapToGrid(Number.NaN, 25)).toBe(Number.NaN)
    expect(snapToGrid(12, 0)).toBe(12)
    expect(snapToGrid(12, -5)).toBe(12)
  })

  it('computes a delta that snaps the origin to the nearest grid crossing', () => {
    expect(snapDelta(12, 12, 0, 0, 25)).toEqual({ x: 0, y: 0 })
    expect(snapDelta(38, 12, 0, 0, 25)).toEqual({ x: 50, y: 0 })
  })
})
