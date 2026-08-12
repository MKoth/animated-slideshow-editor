import { describe, expect, it } from 'vitest'
import { EMPTY_ALIGNMENT, findAlignment } from '../../pixi/renderer/alignment'
import type { WorldRect } from '../../pixi/renderer/worldGeometry'

const CENTER = { x: 400, y: 300 }

describe('findAlignment', () => {
  it('returns empty when nothing is close enough', () => {
    const moving: WorldRect = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    const result = findAlignment(
      moving,
      [{ minX: 500, minY: 400, maxX: 600, maxY: 500 }],
      CENTER,
      8,
    )

    expect(result.verticalLines).toEqual([])
    expect(result.horizontalLines).toEqual([])
  })

  it('finds a vertical alignment when an edge lines up with another object', () => {
    const moving: WorldRect = { minX: 380, minY: 200, maxX: 460, maxY: 300 }
    const other: WorldRect = { minX: 460, minY: 500, maxX: 560, maxY: 600 }

    const result = findAlignment(moving, [other], CENTER, 8)

    expect(result.verticalLines).toContain(460)
  })

  it('finds a horizontal alignment against the canvas center', () => {
    const moving: WorldRect = { minX: 100, minY: 300, maxX: 200, maxY: 400 }

    const result = findAlignment(moving, [], CENTER, 8)

    expect(result.horizontalLines).toContain(300)
  })

  it('finds alignments on both axes at once', () => {
    const moving: WorldRect = { minX: 105, minY: 295, maxX: 205, maxY: 305 }
    const other: WorldRect = { minX: 150, minY: 395, maxX: 250, maxY: 405 }

    const result = findAlignment(moving, [other], CENTER, 8)

    expect(result.verticalLines).toContain(150)
    expect(result.verticalLines).toContain(200)
    expect(result.horizontalLines).toContain(300)
  })

  it('deduplicates overlapping guide lines', () => {
    const moving: WorldRect = { minX: 100, minY: 100, maxX: 200, maxY: 200 }
    const otherA: WorldRect = { minX: 200, minY: 300, maxX: 300, maxY: 400 }
    const otherB: WorldRect = { minX: 200, minY: 500, maxX: 300, maxY: 600 }

    const result = findAlignment(moving, [otherA, otherB], CENTER, 8)

    expect(result.verticalLines.filter((line) => Math.abs(line - 200) < 1e-6)).toHaveLength(1)
  })

  it('returns empty for a negative threshold', () => {
    const moving: WorldRect = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    expect(findAlignment(moving, [], CENTER, -1)).toEqual(EMPTY_ALIGNMENT)
  })
})
