import { describe, expect, it } from 'vitest'
import { GridRenderer } from '../../pixi/renderer/gridRenderer'
import type { PixiContainer, RendererPixi } from '../../pixi/renderer/pixi'
import { createPixiFake, FakeContainer, FakeGraphics } from './pixiFake'

interface DrawnLine {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  color: number
}

function linesOf(graphics: FakeGraphics): DrawnLine[] {
  const lines: DrawnLine[] = []
  let current: Partial<DrawnLine> | null = null
  for (const call of graphics.calls) {
    if (call.method === 'moveTo') {
      current = { x1: call.args[0] as number, y1: call.args[1] as number }
    } else if (call.method === 'lineTo' && current) {
      current.x2 = call.args[0] as number
      current.y2 = call.args[1] as number
    } else if (call.method === 'stroke' && current) {
      const options = call.args[0] as { width?: number; color?: number }
      current.width = options?.width ?? 0
      current.color = options?.color ?? 0
      lines.push(current as DrawnLine)
      current = null
    }
  }
  return lines
}

function verticalLines(lines: DrawnLine[]): DrawnLine[] {
  return lines.filter((line) => line.x1 === line.x2)
}

function horizontalLines(lines: DrawnLine[]): DrawnLine[] {
  return lines.filter((line) => line.y1 === line.y2)
}

function setup() {
  const parent = new FakeContainer()
  const grid = new GridRenderer(
    createPixiFake() as unknown as RendererPixi,
    parent as unknown as PixiContainer,
  )
  return { grid, graphics: parent.children[0] as FakeGraphics, parent }
}

describe('GridRenderer', () => {
  it('joins the world container as its first child, beneath scene objects', () => {
    const { parent } = setup()
    expect(parent.children[0].label).toBe('grid')
  })

  it('draws vertical and horizontal lines covering the visible world rect at zoom 1', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 1,
      zoomY: 1,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })

    const verticals = verticalLines(linesOf(graphics))
    const horizontals = horizontalLines(linesOf(graphics))

    expect(verticals).toHaveLength(33)
    for (const line of verticals) {
      expect(line.x1 % 25).toBe(0)
      expect(line.x1).toBeGreaterThanOrEqual(0)
      expect(line.x1).toBeLessThanOrEqual(800)
      expect(line.y1).toBe(0)
      expect(line.y2).toBe(600)
    }

    expect(horizontals).toHaveLength(25)
    for (const line of horizontals) {
      expect(line.y1 % 25).toBe(0)
      expect(line.y1).toBeGreaterThanOrEqual(0)
      expect(line.y1).toBeLessThanOrEqual(600)
      expect(line.x1).toBe(0)
      expect(line.x2).toBe(800)
    }
  })

  it('adapts the world spacing so screen spacing stays between 25 and 50 px at any zoom', () => {
    const { grid, graphics } = setup()
    const zooms = [0.25, 0.3, 0.5, 1, 1.5, 2, 3, 4, 8]
    const expectedSteps: Record<number, number> = {
      0.25: 100,
      0.5: 50,
      1: 25,
      2: 12.5,
      4: 6.25,
    }

    for (const zoom of zooms) {
      graphics.calls.length = 0
      grid.update({
        cameraX: 0,
        cameraY: 0,
        zoomX: zoom,
        zoomY: zoom,
        viewWidth: 800,
        viewHeight: 600,
        minorColor: 0xe8e8e8,
        majorColor: 0xc4c4c4,
      })

      const xs = verticalLines(linesOf(graphics))
        .map((line) => line.x1)
        .sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i += 1) {
        const worldStep = xs[i] - xs[i - 1]
        const screenSpacing = worldStep * zoom
        expect(screenSpacing).toBeGreaterThanOrEqual(25)
        expect(screenSpacing).toBeLessThan(50)
        if (expectedSteps[zoom] !== undefined) {
          expect(worldStep).toBe(expectedSteps[zoom])
        }
      }
    }
  })

  it('keeps every line exactly 1px (minors) or 3px (majors) wide on screen at any zoom', () => {
    const { grid, graphics } = setup()

    for (const zoom of [0.5, 1, 2, 4]) {
      graphics.calls.length = 0
      grid.update({
        cameraX: 0,
        cameraY: 0,
        zoomX: zoom,
        zoomY: zoom,
        viewWidth: 800,
        viewHeight: 600,
        minorColor: 0xe8e8e8,
        majorColor: 0xc4c4c4,
      })

      const lines = linesOf(graphics)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        const screenWidth = line.width * zoom
        if (line.color === 0xe8e8e8) {
          expect(screenWidth).toBe(1)
        } else {
          expect(screenWidth).toBe(3)
        }
      }
    }
  })

  it('keeps both axes in the 25–50 px band when the camera scales non-uniformly', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 2,
      zoomY: 0.5,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })

    const verticals = verticalLines(linesOf(graphics)).sort((a, b) => a.x1 - b.x1)
    const horizontals = horizontalLines(linesOf(graphics)).sort((a, b) => a.y1 - b.y1)

    for (let i = 1; i < verticals.length; i += 1) {
      expect((verticals[i].x1 - verticals[i - 1].x1) * 2).toBeGreaterThanOrEqual(25)
      expect((verticals[i].x1 - verticals[i - 1].x1) * 2).toBeLessThan(50)
    }
    for (let i = 1; i < horizontals.length; i += 1) {
      expect((horizontals[i].y1 - horizontals[i - 1].y1) * 0.5).toBeGreaterThanOrEqual(25)
      expect((horizontals[i].y1 - horizontals[i - 1].y1) * 0.5).toBeLessThan(50)
    }
    for (const line of verticals) {
      const screenWidth = line.width * 2
      expect([1, 3]).toContain(screenWidth)
    }
    for (const line of horizontals) {
      const screenWidth = line.width * 0.5
      expect([1, 3]).toContain(screenWidth)
    }
  })

  it('marks every 5th line as major with a darker color and draws majors after minors', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 1,
      zoomY: 1,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })

    const lines = verticalLines(linesOf(graphics))
    const strokeCalls = graphics.calls
      .map((call, index) => ({ call, index }))
      .filter((entry) => entry.call.method === 'stroke')
    const majorStrokes = strokeCalls.filter(
      (entry) => (entry.call.args[0] as { color: number }).color === 0xc4c4c4,
    )
    const minorStrokes = strokeCalls.filter(
      (entry) => (entry.call.args[0] as { color: number }).color === 0xe8e8e8,
    )

    for (const line of lines) {
      if (Math.abs(line.x1) % 125 === 0) {
        expect(line.color).toBe(0xc4c4c4)
        expect(line.width).toBe(3)
      } else {
        expect(line.color).toBe(0xe8e8e8)
        expect(line.width).toBe(1)
      }
    }
    expect(minorStrokes.length).toBeGreaterThan(0)
    expect(majorStrokes.length).toBeGreaterThan(0)
    expect(Math.min(...majorStrokes.map((entry) => entry.index))).toBeGreaterThan(
      Math.max(...minorStrokes.map((entry) => entry.index)),
    )
  })

  it('uses the colors supplied by the caller', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 1,
      zoomY: 1,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0x3f444e,
      majorColor: 0x585f6b,
    })

    const colors = new Set(linesOf(graphics).map((line) => line.color))
    expect(colors).toEqual(new Set([0x3f444e, 0x585f6b]))
  })

  it('snaps line positions to device pixels so lines stay crisp while panning', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 12.3,
      cameraY: -7.1,
      zoomX: 1,
      zoomY: 1,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })

    for (const line of verticalLines(linesOf(graphics))) {
      expect(line.x1 - 12.3).toBe(Math.round(line.x1 - 12.3))
    }
    for (const line of horizontalLines(linesOf(graphics))) {
      expect(line.y1 + 7.1).toBe(Math.round(line.y1 + 7.1))
    }
  })

  it('snaps to device pixels at fractional pixel ratios so lines stay thin on retina', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 3.7,
      cameraY: 1.3,
      zoomX: 1,
      zoomY: 1,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
      pixelRatio: 2,
    })

    for (const line of verticalLines(linesOf(graphics))) {
      const deviceX = (line.x1 - 3.7) * 2
      expect(Math.abs(deviceX - Math.round(deviceX))).toBeLessThan(1e-9)
    }
    for (const line of horizontalLines(linesOf(graphics))) {
      const deviceY = (line.y1 - 1.3) * 2
      expect(Math.abs(deviceY - Math.round(deviceY))).toBeLessThan(1e-9)
    }
  })

  it('keeps the visible world rect aligned with the camera at fractional zoom', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 4.2,
      cameraY: 1.7,
      zoomX: 1.7,
      zoomY: 1.7,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })

    for (const line of verticalLines(linesOf(graphics))) {
      const screenX = (line.x1 - 4.2) * 1.7
      expect(Math.abs(screenX - Math.round(screenX))).toBeLessThan(1e-9)
    }
  })

  it('draws nothing and clears when zoom is zero, negative, or not finite', () => {
    const { grid, graphics } = setup()
    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 1,
      zoomY: 1,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })
    expect(graphics.calls.filter((call) => call.method === 'stroke')).toHaveLength(58)

    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 0,
      zoomY: 0,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })
    expect(graphics.calls).toEqual([{ method: 'clear', args: [] }])

    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: -2,
      zoomY: -2,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })
    expect(graphics.calls).toEqual([{ method: 'clear', args: [] }])

    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: Number.NaN,
      zoomY: Number.NaN,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })
    expect(graphics.calls).toEqual([{ method: 'clear', args: [] }])

    grid.update({
      cameraX: 0,
      cameraY: 0,
      zoomX: 2,
      zoomY: 2,
      viewWidth: 800,
      viewHeight: 600,
      minorColor: 0xe8e8e8,
      majorColor: 0xc4c4c4,
    })
    expect(graphics.calls.filter((call) => call.method === 'stroke').length).toBeGreaterThan(0)
  })
})
