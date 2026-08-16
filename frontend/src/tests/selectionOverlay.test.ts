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

    expect(rects(harness.graphics)).toHaveLength(9)
    const outline = rects(harness.graphics).find((rect) => rect.minX === 220 && rect.minY === 150)
    expect(outline).toEqual({ minX: 220, minY: 150, maxX: 380, maxY: 250 })
  })

  it('draws one outline with handles per selected node', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', 100, 100)
    const b = nodeAt(harness, 'B', 400, 100)

    useSelectionStore.getState().selectMany([a, b])

    expect(rects(harness.graphics)).toHaveLength(18)
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

    expect(rects(harness.graphics)).toHaveLength(9)
    expect(rects(harness.graphics)[0]).toEqual({ minX: 120, minY: 250, maxX: 280, maxY: 350 })
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
    expect(rects(harness.graphics)).toHaveLength(9)

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
