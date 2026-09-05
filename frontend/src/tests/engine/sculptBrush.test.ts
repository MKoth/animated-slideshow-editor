import { describe, it, expect } from 'vitest'
import { sculptFalloff, computeSculptOffsets, isBrushOverMesh } from '../../engine/sculptBrush'

describe('sculptBrush', () => {
  it('falloff follows pow(1 - dist/radius, falloff) with default 1.0', () => {
    expect(sculptFalloff(0, 25, 1.0)).toBeCloseTo(1)
    expect(sculptFalloff(12.5, 25, 1.0)).toBeCloseTo(0.5)
    expect(sculptFalloff(25, 25, 1.0)).toBeCloseTo(0)
    expect(sculptFalloff(26, 25, 1.0)).toBe(0)
    // edge taper
    expect(sculptFalloff(24, 25, 1.0)).toBeCloseTo(0.04)
  })

  it('falloff with exponent 2 tapers more sharply', () => {
    expect(sculptFalloff(12.5, 25, 2)).toBeCloseTo(0.25) // pow(0.5,2)
    expect(sculptFalloff(6.25, 25, 2)).toBeCloseTo(0.5625) // pow(0.75,2)
  })

  it('falloff with exponent 0.5 is more gradual', () => {
    expect(sculptFalloff(12.5, 25, 0.5)).toBeCloseTo(Math.sqrt(0.5))
  })

  it('computeSculptOffsets respects radius and falloff', () => {
    const worldVerts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 100, y: 100 },
    ]
    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 10, y: 0 },
      invert: false,
    })
    // vertex 0 at center should have factor 1, offset 10,0
    expect(offsets.get(0)?.dx).toBeCloseTo(10)
    expect(offsets.get(0)?.dy).toBeCloseTo(0)
    // vertex 1 at 10px distance: distScreen 10, factor 0.6, offset 6
    expect(offsets.get(1)?.factor).toBeCloseTo(0.6)
    expect(offsets.get(1)?.dx).toBeCloseTo(6)
    // vertex 2 far away should be not affected
    expect(offsets.has(2)).toBe(false)
  })

  it('Shift inverts subtractively', () => {
    const worldVerts = [{ x: 0, y: 0 }]
    const normal = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 5, y: 5 },
      invert: false,
    })
    const inverted = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 5, y: 5 },
      invert: true,
    })
    expect(normal.get(0)?.dx).toBeCloseTo(5)
    expect(inverted.get(0)?.dx).toBeCloseTo(-5)
    expect(inverted.get(0)?.dy).toBeCloseTo(-5)
  })

  it('drag-direction: push along drag delta', () => {
    const worldVerts = [{ x: 0, y: 0 }]
    const offsetsX = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 10, y: 0 },
      invert: false,
    })
    const offsetsY = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 0, y: 10 },
      invert: false,
    })
    expect(offsetsX.get(0)?.dx).toBeCloseTo(10)
    expect(offsetsX.get(0)?.dy).toBeCloseTo(0)
    expect(offsetsY.get(0)?.dx).toBeCloseTo(0)
    expect(offsetsY.get(0)?.dy).toBeCloseTo(10)
  })

  it('strength scales falloff', () => {
    const worldVerts = [{ x: 0, y: 0 }]
    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 0.5,
      dragDeltaWorld: { x: 10, y: 0 },
      invert: false,
    })
    expect(offsets.get(0)?.dx).toBeCloseTo(5)
  })

  it('isBrushOverMesh face guard', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]
    const faces = [{ v0: 0, v1: 1, v2: 2 }]
    expect(isBrushOverMesh(2, 2, verts, faces)).toBe(true)
    expect(isBrushOverMesh(20, 20, verts, faces)).toBe(false)
  })

  it('brute-force handles 5k vertices quickly', () => {
    const worldVerts = Array.from({ length: 5000 }, (_, i) => ({
      x: i % 100,
      y: Math.floor(i / 100),
    }))
    const start = performance.now()
    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 50, y: 25 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 5, y: 0 },
      invert: false,
    })
    const duration = performance.now() - start
    // Should be fast (<50ms for 5k)
    expect(duration).toBeLessThan(50)
    expect(offsets.size).toBeGreaterThan(0)
    expect(offsets.size).toBeLessThan(5000)
  })

  it('zero drag delta returns no offsets (no-op)', () => {
    const worldVerts = [{ x: 0, y: 0 }]
    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: 0, y: 0 },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: { x: 0, y: 0 },
      invert: false,
    })
    expect(offsets.size).toBe(0)
  })
})
