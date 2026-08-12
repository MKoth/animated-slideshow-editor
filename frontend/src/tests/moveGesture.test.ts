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
import type {
  GuideController,
  MoveOptions,
  PreviewController,
} from '../pixi/renderer/canvasSelection'
import type { NodeSizeSource } from '../pixi/renderer/hitTest'
import type { WorldPoint, WorldRect } from '../pixi/renderer/worldGeometry'
import { useSelectionStore } from '../stores/selectionStore'

const PLACEHOLDER = { width: 160, height: 100 }
const GRID_STEP = 25

interface FakePreview extends PreviewController {
  positions: Map<string, { x: number; y: number }>
}

interface FakeGuides extends GuideController {
  shows: { vertical: number[]; horizontal: number[]; span: WorldRect }[]
  clears: number
}

function makePreview(): FakePreview {
  return {
    positions: new Map(),
    setPosition(nodeId, x, y) {
      this.positions.set(nodeId, { x, y })
    },
    clear() {
      this.positions.clear()
    },
  }
}

function makeGuides(): FakeGuides {
  return {
    shows: [],
    clears: 0,
    show(v, h, span) {
      this.shows.push({ vertical: [...v], horizontal: [...h], span })
    },
    clear() {
      this.clears += 1
    },
  }
}

interface Harness {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  canvas: HTMLCanvasElement
  selection: CanvasSelection
  preview: FakePreview
  guides: FakeGuides
  setGridSnap: (enabled: boolean) => void
  nodeSizes: { add(nodeId: string): void }
}

function mount(): Harness {
  const log = vi.fn()
  const engine = createEngine()
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
  const preview = makePreview()
  const guides = makeGuides()
  let gridSnap = false
  const options: () => MoveOptions = () => ({ gridSnap, gridStep: GRID_STEP })
  const selection = new CanvasSelection({
    canvas,
    getScene: () => slide.scene,
    getCamera: () => slide.scene.camera,
    getNodeSize: (nodeId) => sizes(nodeId),
    store: { ...useSelectionStore.getState() },
    dispatch: (command) => dispatcher.dispatch(command),
    preview,
    guides,
    getMoveOptions: options,
  })
  selection.attach()
  return {
    engine,
    dispatcher,
    undoStack,
    canvas,
    selection,
    preview,
    guides,
    setGridSnap: (enabled) => {
      gridSnap = enabled
    },
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

function mouseDown(canvas: HTMLCanvasElement, point: WorldPoint): void {
  canvas.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }),
  )
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

function drag(canvas: HTMLCanvasElement, from: WorldPoint, to: WorldPoint): void {
  mouseDown(canvas, from)
  mouseMove(to)
  mouseUp(to)
}

function transformOf(engine: Engine, id: string): { x: number; y: number } {
  return { x: engine.getNode(id).transform.x, y: engine.getNode(id).transform.y }
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

describe('move gesture', () => {
  it('moves a selected object in real time and records one history entry on release', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    const before = harness.undoStack.entries.length

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 350, y: 240 })
    expect(harness.preview.positions.get(id)).toEqual({ x: 350, y: 240 })
    expect(harness.undoStack.entries).toHaveLength(before)

    mouseUp({ x: 350, y: 240 })

    expect(harness.undoStack.entries).toHaveLength(before + 1)
    expect(harness.undoStack.entries[0].type).toBe('Transaction')
    expect(transformOf(harness.engine, id)).toEqual({ x: 350, y: 240 })
  })

  it('moves all selected objects together by the same delta', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', { x: 300, y: 200 })
    const b = nodeAt(harness, 'B', { x: 700, y: 200 })
    useSelectionStore.getState().selectMany([a, b])
    const before = harness.undoStack.entries.length

    drag(harness.canvas, { x: 300, y: 200 }, { x: 320, y: 260 })

    expect(transformOf(harness.engine, a)).toEqual({ x: 320, y: 260 })
    expect(transformOf(harness.engine, b)).toEqual({ x: 720, y: 260 })
    expect(harness.undoStack.entries).toHaveLength(before + 1)
  })

  it('selects an unselected object before dragging it', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })

    drag(harness.canvas, { x: 300, y: 200 }, { x: 330, y: 210 })

    expect(useSelectionStore.getState().selectedIds).toEqual([id])
    expect(transformOf(harness.engine, id)).toEqual({ x: 330, y: 210 })
  })

  it('snaps movement to the grid step when the pref is on', () => {
    const harness = mount()
    harness.setGridSnap(true)
    const id = nodeAt(harness, 'Hero', { x: 0, y: 0 })

    drag(harness.canvas, { x: 0, y: 0 }, { x: 38, y: 40 })

    expect(transformOf(harness.engine, id)).toEqual({ x: 50, y: 50 })
  })

  it('leaves movement unsnapped when the pref is off', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 0, y: 0 })

    drag(harness.canvas, { x: 0, y: 0 }, { x: 38, y: 40 })

    expect(transformOf(harness.engine, id)).toEqual({ x: 38, y: 40 })
  })

  it('shows alignment guides while moving and clears them on release', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', { x: 300, y: 200 })
    nodeAt(harness, 'B', { x: 540, y: 200 })

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 380, y: 200 })

    expect(harness.guides.shows.length).toBeGreaterThan(0)

    mouseUp({ x: 380, y: 200 })
    expect(harness.guides.clears).toBeGreaterThan(0)
    expect(transformOf(harness.engine, a)).toEqual({ x: 380, y: 200 })
  })

  it('does not show guides for objects outside the nearby margin', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', { x: 300, y: 200 })
    nodeAt(harness, 'Faraway', { x: 4000, y: 200 })

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 350, y: 200 })

    expect(harness.guides.shows).toHaveLength(0)
    mouseUp({ x: 350, y: 200 })
    expect(transformOf(harness.engine, a)).toEqual({ x: 350, y: 200 })
  })

  it('commits nothing when the pointer moves less than the drag threshold', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    const before = harness.undoStack.entries.length

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 301, y: 200 })
    mouseUp({ x: 301, y: 200 })

    expect(harness.undoStack.entries).toHaveLength(before)
    expect(transformOf(harness.engine, id)).toEqual({ x: 300, y: 200 })
  })

  it('records the original position of each moved object as inverse data', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', { x: 100, y: 100 })
    useSelectionStore.getState().select(a)

    drag(harness.canvas, { x: 100, y: 100 }, { x: 150, y: 200 })

    const inverse = harness.undoStack.entries[0].inverse as { children: { inverse: unknown }[] }
    expect(inverse.children[0].inverse).toEqual({ nodeId: a, oldX: 100, oldY: 100 })
  })

  it('moves by the world delta regardless of camera pan and zoom', () => {
    const harness = mount()
    const camera = harness.engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('No camera found')
    }
    harness.dispatcher.dispatch(new MoveNodeCommand({ nodeId: camera.id, x: 120, y: 40 }))
    harness.dispatcher.dispatch(new ScaleNodeCommand({ nodeId: camera.id, scaleX: 2, scaleY: 2 }))
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })

    drag(harness.canvas, { x: 360, y: 320 }, { x: 420, y: 340 })

    expect(transformOf(harness.engine, id)).toEqual({ x: 330, y: 210 })
  })
})
