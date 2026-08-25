import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  MoveNodeCommand,
  ScaleNodeCommand,
} from '../engine/commands'
import { CanvasSelection } from '../pixi/renderer/canvasSelection'
import type { NodeSizeSource } from '../pixi/renderer/hitTest'
import type { SceneNode } from '../engine'
import type { ViewportTransform, WorldPoint } from '../pixi/renderer/worldGeometry'
import { useSelectionStore } from '../stores/selectionStore'

const PLACEHOLDER = { width: 160, height: 100 }

function viewportOf(camera: SceneNode): ViewportTransform {
  const { x, y, scaleX, scaleY } = camera.transform
  return { x, y, scaleX, scaleY }
}

interface Harness {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  canvas: HTMLCanvasElement
  selection: CanvasSelection
  log: ReturnType<typeof vi.fn>
  events: unknown[]
  nodeSizes: { add(nodeId: string): void }
}

function mount(options?: { isIKHandleAt?: (x: number, y: number) => boolean }): Harness {
  const log = vi.fn()
  const events: unknown[] = []
  const engine = createEngine()
  engine.subscribe((event) => events.push(event))
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const known = new Set<string>()
  const sizes: NodeSizeSource = (nodeId) => (known.has(nodeId) ? PLACEHOLDER : null)
  const canvas = document.createElement('canvas')
  const selection = new CanvasSelection({
    canvas,
    getScene: () => slide.scene,
    getCameraTransform: () => viewportOf(slide.scene.camera),
    getNodeSize: (nodeId) => sizes(nodeId),
    store: { ...useSelectionStore.getState() },
    isIKHandleAt: options?.isIKHandleAt,
  })
  selection.attach()
  return {
    engine,
    dispatcher,
    undoStack,
    canvas,
    selection,
    log,
    events,
    nodeSizes: {
      add(nodeId: string): void {
        known.add(nodeId)
      },
    },
  }
}

function nodeAt(harness: Harness, name: string, position: WorldPoint = { x: 0, y: 0 }): string {
  const slide = harness.engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const created = harness.engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x: position.x, y: position.y, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  harness.nodeSizes.add(created.id)
  return created.id
}

function mouseDown(
  canvas: HTMLCanvasElement,
  point: WorldPoint,
  options: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): MouseEvent {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX: point.x,
    clientY: point.y,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
  })
  canvas.dispatchEvent(event)
  return event
}

function mouseMove(point: WorldPoint): void {
  window.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: point.x, clientY: point.y }),
  )
}

function mouseUp(point: WorldPoint): void {
  window.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, clientX: point.x, clientY: point.y }),
  )
}

function click(canvas: HTMLCanvasElement, point: WorldPoint, options = {}): void {
  mouseDown(canvas, point, options)
  mouseUp(point)
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

describe('canvas selection', () => {
  it('selects the node under the cursor on click', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })

    click(harness.canvas, { x: 300, y: 200 })

    expect(useSelectionStore.getState().selectedIds).toEqual([id])
  })

  it('selects the topmost visible node when objects overlap', () => {
    const harness = mount()
    const behind = nodeAt(harness, 'Behind', { x: 300, y: 200 })
    const front = nodeAt(harness, 'Front', { x: 300, y: 200 })

    click(harness.canvas, { x: 300, y: 200 })

    expect(useSelectionStore.getState().selectedIds).toEqual([front])
    expect(useSelectionStore.getState().selectedIds).not.toContain(behind)
  })

  it('clears the selection when clicking empty canvas', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    useSelectionStore.getState().select(id)

    click(harness.canvas, { x: 50, y: 50 })

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('clears the selection with ctrl+click on empty canvas', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    useSelectionStore.getState().select(id)

    click(harness.canvas, { x: 50, y: 50 }, { ctrlKey: true })

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('does not clear the new scene selection when the scene changes mid-gesture', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    engine.createSlide('Slide 2')
    const first = engine.project?.slides[0]
    const second = engine.project?.slides[1]
    if (!first || !second) {
      throw new Error('Slides were not created')
    }
    const known = new Set<string>()
    const sizes: NodeSizeSource = (nodeId) => (known.has(nodeId) ? PLACEHOLDER : null)
    let currentScene = second.scene
    const canvas = document.createElement('canvas')
    const selection = new CanvasSelection({
      canvas,
      getScene: () => currentScene,
      getCameraTransform: () => viewportOf(currentScene.camera),
      getNodeSize: (nodeId) => sizes(nodeId),
      store: { ...useSelectionStore.getState() },
    })
    selection.attach()
    const created = engine.createNode(second.scene.id, second.scene.root.id, 'Hero', {
      transform: { x: 300, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    known.add(created.id)

    click(canvas, { x: 300, y: 200 })
    expect(useSelectionStore.getState().selectedIds).toEqual([created.id])

    currentScene = first.scene
    mouseDown(canvas, { x: 50, y: 50 })
    currentScene = second.scene
    mouseUp({ x: 50, y: 50 })

    expect(useSelectionStore.getState().selectedIds).toEqual([created.id])
    selection.detach()
  })

  it('does not select invisible nodes', () => {
    const harness = mount()
    const hidden = nodeAt(harness, 'Hidden', { x: 300, y: 200 })
    harness.engine.setVisibility(hidden, false)

    click(harness.canvas, { x: 300, y: 200 })

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('toggles nodes in and out of the selection with ctrl+click', () => {
    const harness = mount()
    const first = nodeAt(harness, 'First', { x: 100, y: 100 })
    const second = nodeAt(harness, 'Second', { x: 400, y: 100 })

    click(harness.canvas, { x: 100, y: 100 })
    click(harness.canvas, { x: 400, y: 100 }, { ctrlKey: true })
    expect(useSelectionStore.getState().selectedIds).toEqual([first, second])

    click(harness.canvas, { x: 100, y: 100 }, { ctrlKey: true })
    expect(useSelectionStore.getState().selectedIds).toEqual([second])
  })

  it('extends the selection with shift+click without duplicating', () => {
    const harness = mount()
    const first = nodeAt(harness, 'First', { x: 100, y: 100 })
    const second = nodeAt(harness, 'Second', { x: 400, y: 100 })

    click(harness.canvas, { x: 100, y: 100 })
    click(harness.canvas, { x: 400, y: 100 }, { shiftKey: true })
    click(harness.canvas, { x: 400, y: 100 }, { shiftKey: true })

    expect(useSelectionStore.getState().selectedIds).toEqual([first, second])
  })

  it('selects all nodes intersecting the marquee in insertion order', () => {
    const harness = mount()
    const first = nodeAt(harness, 'First', { x: 150, y: 150 })
    const second = nodeAt(harness, 'Second', { x: 350, y: 200 })
    nodeAt(harness, 'Outside', { x: 700, y: 700 })

    mouseDown(harness.canvas, { x: 0, y: 0 })
    mouseMove({ x: 400, y: 300 })
    mouseUp({ x: 400, y: 300 })

    expect(useSelectionStore.getState().selectedIds).toEqual([first, second])
  })

  it('updates the marquee selection live while dragging', () => {
    const harness = mount()
    const first = nodeAt(harness, 'First', { x: 150, y: 150 })
    const late = nodeAt(harness, 'Late', { x: 350, y: 200 })

    mouseDown(harness.canvas, { x: 0, y: 0 })
    mouseMove({ x: 400, y: 300 })
    expect(useSelectionStore.getState().selectedIds).toEqual([first, late])

    const joined = nodeAt(harness, 'Joined', { x: 500, y: 350 })
    mouseMove({ x: 600, y: 450 })
    expect(useSelectionStore.getState().selectedIds).toEqual([first, late, joined])

    mouseUp({ x: 600, y: 450 })
    expect(useSelectionStore.getState().selectedIds).toEqual([first, late, joined])
  })

  it('clears instead of starting a marquee when released without dragging', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    useSelectionStore.getState().select(id)

    mouseDown(harness.canvas, { x: 50, y: 50 })
    mouseMove({ x: 52, y: 52 })
    mouseUp({ x: 52, y: 52 })

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('never starts a marquee from a node (reserved for dragging)', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    const other = nodeAt(harness, 'Other', { x: 100, y: 100 })

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 200, y: 200 })
    mouseUp({ x: 200, y: 200 })

    expect(useSelectionStore.getState().selectedIds).toEqual([id])
    expect(useSelectionStore.getState().selectedIds).not.toContain(other)
  })

  it('converts the cursor to world coordinates under the camera', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 270, y: 140 })
    const camera = harness.engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('No camera found')
    }
    harness.dispatcher.dispatch(new MoveNodeCommand({ nodeId: camera.id, x: 120, y: 40 }))
    harness.dispatcher.dispatch(new ScaleNodeCommand({ nodeId: camera.id, scaleX: 2, scaleY: 2 }))

    click(harness.canvas, { x: 300, y: 200 })

    expect(useSelectionStore.getState().selectedIds).toEqual([id])
  })

  it('produces no commands, no engine events, and no undo history', () => {
    const harness = mount()
    nodeAt(harness, 'Hero', { x: 300, y: 200 })
    const undoCount = harness.undoStack.entries.length
    const eventCount = harness.events.length
    const logCount = harness.log.mock.calls.length

    click(harness.canvas, { x: 300, y: 200 })
    click(harness.canvas, { x: 100, y: 100 }, { ctrlKey: true })
    mouseDown(harness.canvas, { x: 50, y: 50 })
    mouseMove({ x: 150, y: 150 })
    mouseUp({ x: 150, y: 150 })

    expect(harness.undoStack.entries).toHaveLength(undoCount)
    expect(harness.events).toHaveLength(eventCount)
    expect(harness.log.mock.calls).toHaveLength(logCount)
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('suppresses the context menu on ctrl+click so it can toggle the selection', () => {
    const harness = mount()

    const ctrlEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      ctrlKey: true,
    })
    harness.canvas.dispatchEvent(ctrlEvent)
    expect(ctrlEvent.defaultPrevented).toBe(true)

    const plainEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
    })
    harness.canvas.dispatchEvent(plainEvent)
    expect(plainEvent.defaultPrevented).toBe(false)
  })

  it('detaches all listeners on dispose; interactions change nothing afterwards', () => {
    const harness = mount()
    nodeAt(harness, 'Hero', { x: 300, y: 200 })

    harness.selection.detach()
    click(harness.canvas, { x: 300, y: 200 })

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  describe('IK handle priority', () => {
    it('does not select a node when clicking an IK handle', () => {
      const harness = mount({ isIKHandleAt: () => true })
      nodeAt(harness, 'Hero', { x: 300, y: 200 })

      click(harness.canvas, { x: 300, y: 200 })

      expect(useSelectionStore.getState().selectedIds).toEqual([])
    })

    it('selects a node normally when not clicking an IK handle', () => {
      const harness = mount({ isIKHandleAt: () => false })
      const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })

      click(harness.canvas, { x: 300, y: 200 })

      expect(useSelectionStore.getState().selectedIds).toEqual([id])
    })

    it('does not begin a node drag when clicking an IK handle', () => {
      const harness = mount({ isIKHandleAt: () => true })
      nodeAt(harness, 'Hero', { x: 300, y: 200 })

      mouseDown(harness.canvas, { x: 300, y: 200 })
      mouseMove({ x: 350, y: 250 })
      mouseUp({ x: 350, y: 250 })

      expect(useSelectionStore.getState().selectedIds).toEqual([])
    })

    it('clears selection on empty canvas even when isIKHandleAt is provided', () => {
      const harness = mount({ isIKHandleAt: () => false })
      const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
      useSelectionStore.getState().select(id)

      click(harness.canvas, { x: 50, y: 50 })

      expect(useSelectionStore.getState().selectedIds).toEqual([])
    })

    it('does not select when IK handle is hit even with ctrl+click', () => {
      const harness = mount({ isIKHandleAt: () => true })
      nodeAt(harness, 'Hero', { x: 300, y: 200 })

      click(harness.canvas, { x: 300, y: 200 }, { ctrlKey: true })

      expect(useSelectionStore.getState().selectedIds).toEqual([])
    })
  })
})
