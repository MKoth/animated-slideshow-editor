import { beforeEach, describe, expect, it } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import { EvaluatedWorldTransformSource } from '../engine/worldTransform'
import type { PixiContainer, RendererPixi } from '../pixi/renderer/pixi'
import { SelectionOverlay } from '../pixi/renderer/selectionOverlay'
import type { NodeSizeSource } from '../pixi/renderer/hitTest'
import type { WorldPoint, WorldRect } from '../pixi/renderer/worldGeometry'
import { useSelectionStore } from '../stores/selectionStore'
import { FakeContainer, FakeGraphics } from './renderer/pixiFake'
import { FakeTimeSource } from './fakeTimeSource'

const PLACEHOLDER = { width: 160, height: 100 }

interface Harness {
  engine: Engine
  overlay: SelectionOverlay
  graphics: FakeGraphics
  nodeSizes: { add(nodeId: string): void }
}

function mount(): Harness {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const known = new Set<string>()
  const sizes: NodeSizeSource = (nodeId) => (known.has(nodeId) ? PLACEHOLDER : null)
  const world = new FakeContainer() as unknown as PixiContainer
  const overlay = new SelectionOverlay({
    pixi: { Graphics: FakeGraphics } as unknown as RendererPixi,
    world,
    engine,
    getScene: () => slide.scene,
    getNodeSize: (nodeId) => sizes(nodeId),
    store: useSelectionStore,
  })
  overlay.attach()
  const graphics = world.children.find(
    (child) => (child as { kind?: string }).kind === 'graphics',
  ) as unknown as FakeGraphics | undefined
  if (!graphics) {
    throw new Error('No overlay graphics found')
  }
  return {
    engine,
    overlay,
    graphics,
    nodeSizes: {
      add(nodeId: string): void {
        known.add(nodeId)
      },
    },
  }
}

function nodeAt(harness: Harness, name: string, x = 0, y = 0): string {
  const slide = harness.engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const created = harness.engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  harness.nodeSizes.add(created.id)
  return created.id
}

function rects(graphics: FakeGraphics): WorldRect[] {
  return graphics.calls
    .filter((call) => call.method === 'rect')
    .map((call) => {
      const [x, y, w, h] = call.args as [number, number, number, number]
      return { minX: x, minY: y, maxX: x + w, maxY: y + h }
    })
}

function polygonCorners(graphics: FakeGraphics): WorldPoint[] {
  const points: WorldPoint[] = []
  for (const call of graphics.calls) {
    if (call.method === 'moveTo' || call.method === 'lineTo') {
      const [x, y] = call.args as [number, number]
      // Only collect the first polygon (outline) — 4 points
      // The outline starts with moveTo then 3 lineTo, then closePath; after that pivot and rotation lines also use moveTo/lineTo.
      // We stop after we have 4 points and encounter closePath.
      if (points.length < 4) {
        points.push({ x, y })
      }
    }
    if (call.method === 'closePath' && points.length === 4) {
      break
    }
  }
  return points
}

function aabbFromPoints(points: WorldPoint[]): WorldRect | null {
  if (points.length === 0) return null
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

function outlinePolygon(graphics: FakeGraphics): WorldPoint[] {
  return polygonCorners(graphics)
}

interface EvaluatedHarness {
  engine: Engine
  overlay: SelectionOverlay
  graphics: FakeGraphics
  time: FakeTimeSource
  previews: Map<string, WorldPoint>
  nodeSizes: { add(nodeId: string): void }
}

function mountEvaluated(): EvaluatedHarness {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const known = new Set<string>()
  const sizes: NodeSizeSource = (nodeId) => (known.has(nodeId) ? PLACEHOLDER : null)
  const world = new FakeContainer() as unknown as PixiContainer
  const time = new FakeTimeSource()
  const previews = new Map<string, WorldPoint>()
  const source = new EvaluatedWorldTransformSource(engine, () => time.getTime(), previews)
  const overlay = new SelectionOverlay({
    pixi: { Graphics: FakeGraphics } as unknown as RendererPixi,
    world,
    engine,
    getScene: () => slide.scene,
    getNodeSize: (nodeId) => sizes(nodeId),
    getWorldTransform: (nodeId) => source.transformOf(nodeId),
    subscribeTime: (listener) => time.subscribe(listener),
    store: useSelectionStore,
  })
  overlay.attach()
  const graphics = world.children.find(
    (child) => (child as { kind?: string }).kind === 'graphics',
  ) as unknown as FakeGraphics | undefined
  if (!graphics) {
    throw new Error('No overlay graphics found')
  }
  return {
    engine,
    overlay,
    graphics,
    time,
    previews,
    nodeSizes: {
      add(nodeId: string): void {
        known.add(nodeId)
      },
    },
  }
}

function evaluatedNode(harness: EvaluatedHarness, name: string, x = 0, y = 0): string {
  const slide = harness.engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const created = harness.engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  harness.nodeSizes.add(created.id)
  return created.id
}

function outlineOf(harness: EvaluatedHarness): WorldRect | null {
  const poly = outlinePolygon(harness.graphics)
  if (poly.length === 4) return aabbFromPoints(poly)
  return rects(harness.graphics)[0] ?? null
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

describe('selection overlay', () => {
  it('renders nothing while the selection is empty', () => {
    const { graphics } = mount()

    expect(graphics.calls).toHaveLength(1)
    expect(graphics.calls[0].method).toBe('clear')
  })

  it('draws an outline and eight handles around the selected node', () => {
    const harness = mount()
    const selected = nodeAt(harness, 'Selected', 300, 200)

    useSelectionStore.getState().select(selected)

    // 8 handle rects (outline is polygon, not rect)
    expect(rects(harness.graphics)).toHaveLength(8)
    const poly = outlinePolygon(harness.graphics)
    expect(poly).toHaveLength(4)
    expect(aabbFromPoints(poly)).toEqual({ minX: 220, minY: 150, maxX: 380, maxY: 250 })
    // Handles are at oriented corners/edges (axis-aligned for 0 rotation)
    const handleCenters = rects(harness.graphics).map((r) => ({
      x: (r.minX + r.maxX) / 2,
      y: (r.minY + r.maxY) / 2,
    }))
    expect(handleCenters).toEqual(
      expect.arrayContaining([
        { x: 220, y: 150 },
        { x: 300, y: 150 },
        { x: 380, y: 150 },
        { x: 220, y: 200 },
        { x: 380, y: 200 },
        { x: 220, y: 250 },
        { x: 300, y: 250 },
        { x: 380, y: 250 },
      ]),
    )
  })

  it('draws one outline with handles per selected node', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', 100, 100)
    const b = nodeAt(harness, 'B', 400, 100)

    useSelectionStore.getState().selectMany([a, b])

    expect(rects(harness.graphics)).toHaveLength(16)
    // Two outlines (each 4-point polygon) => 8 polygon points total in first 8 moveTo/lineTo calls
    // But polygonCorners only returns first outline; count outlines via closePath
    const closeCount = harness.graphics.calls.filter((c) => c.method === 'closePath').length
    expect(closeCount).toBe(2)
  })

  it('draws the handles with a translucent fill', () => {
    const harness = mount()
    const selected = nodeAt(harness, 'Selected', 300, 200)

    useSelectionStore.getState().select(selected)

    const fills = harness.graphics.calls.filter((call) => call.method === 'fill')
    expect(fills).toHaveLength(8)
    for (const call of fills) {
      const options = call.args[0] as { color?: number; alpha?: number }
      expect(options.alpha).toBeLessThan(1)
    }
  })

  it('redraws at the new bounds when a selected node moves', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', 100, 100)
    useSelectionStore.getState().select(a)

    harness.engine.setTransform(a, { x: 200, y: 300, rotation: 0, scaleX: 1, scaleY: 1 })

    expect(rects(harness.graphics)).toHaveLength(8)
    expect(aabbFromPoints(outlinePolygon(harness.graphics))).toEqual({
      minX: 120,
      minY: 250,
      maxX: 280,
      maxY: 350,
    })
  })

  it('drops the outline of a node that is removed from the scene', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', 100, 100)
    useSelectionStore.getState().select(a)

    harness.engine.removeNode(a)

    expect(rects(harness.graphics)).toHaveLength(0)
  })

  it('clears the drawing when the selection is cleared', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', 100, 100)
    useSelectionStore.getState().select(a)
    expect(rects(harness.graphics)).toHaveLength(8)

    useSelectionStore.getState().clear()

    expect(rects(harness.graphics)).toHaveLength(0)
  })

  it('stops redrawing after detach', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', 100, 100)
    harness.overlay.detach()
    harness.graphics.clear()

    useSelectionStore.getState().select(a)
    harness.engine.setTransform(a, { x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1 })

    expect(harness.graphics.calls).toHaveLength(1)
    expect(harness.graphics.calls[0].method).toBe('clear')
  })
})

describe('selection overlay evaluated bounds', () => {
  it('follows the evaluated position when the playhead time changes', () => {
    const harness = mountEvaluated()
    const selected = evaluatedNode(harness, 'Animated', 0, 0)
    harness.engine.addKeyframe({ kind: 'node', nodeId: selected, property: 'positionX' }, 0, 0)
    harness.engine.addKeyframe({ kind: 'node', nodeId: selected, property: 'positionX' }, 10, 100)
    useSelectionStore.getState().select(selected)
    expect(outlineOf(harness)).toEqual({ minX: -80, minY: -50, maxX: 80, maxY: 50 })

    harness.time.set(5)

    expect(outlineOf(harness)).toEqual({ minX: -30, minY: -50, maxX: 130, maxY: 50 })

    harness.time.set(10)
    expect(outlineOf(harness)).toEqual({ minX: 20, minY: -50, maxX: 180, maxY: 50 })
  })

  it('redraws when keyframes are added, changed and deleted', () => {
    const harness = mountEvaluated()
    const selected = evaluatedNode(harness, 'Animated', 0, 0)
    useSelectionStore.getState().select(selected)
    harness.time.set(5)

    const first = harness.engine.addKeyframe(
      { kind: 'node', nodeId: selected, property: 'positionX' },
      0,
      0,
    )
    const second = harness.engine.addKeyframe(
      { kind: 'node', nodeId: selected, property: 'positionX' },
      10,
      100,
    )
    expect(outlineOf(harness)?.minX).toBe(-30)

    harness.engine.setKeyframeValue(
      { kind: 'node', nodeId: selected, property: 'positionX' },
      second.id,
      200,
    )
    expect(outlineOf(harness)?.minX).toBe(20)

    harness.engine.moveKeyframes({ kind: 'node', nodeId: selected, property: 'positionX' }, [
      { keyframeId: first.id, newTime: 2 },
    ])
    expect(outlineOf(harness)?.minX).toBe(-5)

    harness.engine.deleteKeyframes({ kind: 'node', nodeId: selected, property: 'positionX' }, [
      first.id,
    ])
    expect(outlineOf(harness)?.minX).toBe(120)

    harness.engine.deleteKeyframes({ kind: 'node', nodeId: selected, property: 'positionX' }, [
      second.id,
    ])
    expect(outlineOf(harness)?.minX).toBe(-80)
  })

  it('previews the dragged position and snaps back to the evaluated position', () => {
    const harness = mountEvaluated()
    const selected = evaluatedNode(harness, 'Animated', 0, 0)
    harness.engine.addKeyframe({ kind: 'node', nodeId: selected, property: 'positionX' }, 0, 0)
    harness.engine.addKeyframe({ kind: 'node', nodeId: selected, property: 'positionX' }, 10, 100)
    useSelectionStore.getState().select(selected)
    harness.time.set(5)
    expect(outlineOf(harness)?.minX).toBe(-30)

    harness.previews.set(selected, { x: 200, y: 0 })
    harness.overlay.redraw()
    expect(outlineOf(harness)).toEqual({ minX: 120, minY: -50, maxX: 280, maxY: 50 })

    harness.previews.clear()
    harness.time.set(7)
    expect(outlineOf(harness)?.minX).toBe(-10)
  })

  it('keeps redrawing on time changes after detach stops the subscription', () => {
    const harness = mountEvaluated()
    const selected = evaluatedNode(harness, 'Animated', 0, 0)
    harness.engine.addKeyframe({ kind: 'node', nodeId: selected, property: 'positionX' }, 0, 0)
    harness.engine.addKeyframe({ kind: 'node', nodeId: selected, property: 'positionX' }, 10, 100)
    useSelectionStore.getState().select(selected)
    expect(harness.time.listeners.size).toBe(1)

    harness.overlay.detach()
    expect(harness.time.listeners.size).toBe(0)
  })
})

describe('selection overlay rotation', () => {
  it('draws the bounding box rotated with the node (not axis-aligned)', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Rotated', 0, 0)
    harness.engine.setTransform(id, { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 })
    useSelectionStore.getState().select(id)

    const poly = outlinePolygon(harness.graphics)
    expect(poly).toHaveLength(4)
    // For 90deg rotation, 160x100 rect should have corners swapped: width along Y etc.
    // AABB of rotated rect would be 100x160 (minX -50 max 50 minY -80 max 80) but oriented polygon should be rotated.
    // Check that polygon points are rotated 90deg from unrotated corners (-80,-50),(80,-50),(80,50),(-80,50) -> rotated 90deg => (50,-80),(50,80),(-50,80),(-50,-80)
    const sorted = [...poly].sort((a, b) => a.x - b.x || a.y - b.y)
    const expected = [
      { x: -50, y: -80 },
      { x: -50, y: 80 },
      { x: 50, y: -80 },
      { x: 50, y: 80 },
    ].sort((a, b) => a.x - b.x || a.y - b.y)
    for (let i = 0; i < 4; i++) {
      expect(sorted[i].x).toBeCloseTo(expected[i].x)
      expect(sorted[i].y).toBeCloseTo(expected[i].y)
    }
    // Handles should also be rotated — topMid for 90deg should be at (0,-80)? Actually top edge center after 90deg is at? Check handle positions derived from corners
    const handles = rects(harness.graphics).map((r) => ({
      x: (r.minX + r.maxX) / 2,
      y: (r.minY + r.maxY) / 2,
    }))
    // TopMid is midpoint of first edge (tl-tr) after rotation: for 90deg, tl(50,-80)-tr(50,80) => mid (50,0)
    expect(handles).toEqual(expect.arrayContaining([{ x: 50, y: 0 }]))
  })

  it('places rotation handle 24px outward from the oriented top edge', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Rotated', 100, 100)
    harness.engine.setTransform(id, { x: 100, y: 100, rotation: Math.PI / 4, scaleX: 1, scaleY: 1 })
    useSelectionStore.getState().select(id)

    const poly = outlinePolygon(harness.graphics)
    const topMid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }
    // Rotation handle is 24px from topMid along -Y rotated
    const expectedHandleX = topMid.x - Math.sin(Math.PI / 4) * 24
    const expectedHandleY = topMid.y - Math.cos(Math.PI / 4) * 24
    // The rotation handle is drawn as circle; also line from topMid to handle exists as moveTo/lineTo after handles.
    // Find lineTo that corresponds to rotation handle: after handles, there's moveTo(topMid)->lineTo(handle)
    const lineTos = harness.graphics.calls
      .filter((c) => c.method === 'lineTo')
      .map((c) => c.args as [number, number])
    const hasHandleLine = lineTos.some(
      ([x, y]) => Math.abs(x - expectedHandleX) < 0.01 && Math.abs(y - expectedHandleY) < 0.01,
    )
    expect(hasHandleLine).toBe(true)
  })

  it('recomputes oriented bounds when scale or pivot changes', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Pivot', 0, 0)
    harness.engine.setTransform(id, { x: 0, y: 0, rotation: Math.PI / 6, scaleX: 1, scaleY: 1 })
    useSelectionStore.getState().select(id)
    const before = outlinePolygon(harness.graphics).map((p) => ({ ...p }))

    harness.engine.setTransform(id, { x: 0, y: 0, rotation: Math.PI / 6, scaleX: 2, scaleY: 1 })
    const afterScale = outlinePolygon(harness.graphics)
    expect(aabbFromPoints(afterScale)!.maxX - aabbFromPoints(afterScale)!.minX).toBeGreaterThan(
      aabbFromPoints(before)!.maxX - aabbFromPoints(before)!.minX,
    )

    harness.engine.setTransform(id, {
      x: 0,
      y: 0,
      rotation: Math.PI / 6,
      scaleX: 2,
      scaleY: 1,
      localPivot: { x: 0.5, y: 0 },
    })
    const afterPivot = outlinePolygon(harness.graphics)
    // With pivot at right edge, bounds should shift
    expect(aabbFromPoints(afterPivot)!.minX).not.toBeCloseTo(aabbFromPoints(afterScale)!.minX)
  })
})
