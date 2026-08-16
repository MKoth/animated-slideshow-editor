import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  AddKeyframeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveNodeCommand,
  ScaleNodeCommand,
} from '../engine/commands'
import { EvaluatedWorldTransformSource } from '../engine/worldTransform'
import { CanvasSelection } from '../pixi/renderer/canvasSelection'
import type {
  GuideController,
  MoveOptions,
  PreviewController,
} from '../pixi/renderer/canvasSelection'
import { BLOCKED_ANIMATED_MOVE_MESSAGE } from '../pixi/renderer/animatedMove'
import type { NodeSizeSource } from '../pixi/renderer/hitTest'
import type { SceneNode } from '../engine'
import type { ViewportTransform, WorldPoint, WorldRect } from '../pixi/renderer/worldGeometry'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

const PLACEHOLDER = { width: 160, height: 100 }
const GRID_STEP = 25

function viewportOf(camera: SceneNode): ViewportTransform {
  const { x, y, scaleX, scaleY } = camera.transform
  return { x, y, scaleX, scaleY }
}

interface FakeGuides extends GuideController {
  shows: { vertical: number[]; horizontal: number[]; span: WorldRect }[]
  clears: number
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

interface FakePreview extends PreviewController {
  positions: Map<string, WorldPoint>
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
  setAnimationMode: (enabled: boolean) => void
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
  const previewPositions = new Map<string, WorldPoint>()
  const preview: FakePreview = {
    positions: previewPositions,
    setPosition(nodeId, x, y) {
      previewPositions.set(nodeId, { x, y })
    },
    clear() {
      previewPositions.clear()
    },
  }
  const guides = makeGuides()
  let gridSnap = false
  let animationMode = false
  const options: () => MoveOptions = () => ({ gridSnap, gridStep: GRID_STEP })
  const transforms = new EvaluatedWorldTransformSource(
    engine,
    () => {
      const slide = engine.project?.slides[0]
      return slide ? usePlaybackController.getState().getTime(slide.id) : 0
    },
    previewPositions,
  )
  const selection = new CanvasSelection({
    canvas,
    engine,
    getScene: () => slide.scene,
    getCameraTransform: () => viewportOf(slide.scene.camera),
    getNodeSize: (nodeId) => sizes(nodeId),
    store: { ...useSelectionStore.getState() },
    dispatch: (command) => dispatcher.dispatch(command),
    preview,
    guides,
    getMoveOptions: options,
    getAnimationMode: () => animationMode,
    getWorldTransform: (nodeId) => transforms.transformOf(nodeId),
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
    setAnimationMode: (enabled) => {
      animationMode = enabled
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

function scrub(harness: Harness, time: number): void {
  const slide = harness.engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  usePlaybackController.getState().setCurrentTime(slide.id, time, slide.duration)
}

function addKeyframe(
  harness: Harness,
  nodeId: string,
  property: 'positionX' | 'positionY',
  time: number,
  value: number,
): void {
  const result = harness.dispatcher.dispatch(
    new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
  )
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error?.message}`)
  }
}

function entryChildren(
  harness: Harness,
): { type: string; target: { nodeId: string; property: string }; time: number; value: number }[] {
  const entry = harness.undoStack.entries[0]
  if (!entry) {
    throw new Error('expected an undo entry')
  }
  return entry.parameters.commands as {
    type: string
    target: { nodeId: string; property: string }
    time: number
    value: number
  }[]
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useNotificationStore.setState({ notifications: [] })
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

describe('move gesture in animation mode', () => {
  it('starts from the evaluated position and creates both axis keyframes at the playhead', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 0, 300)
    addKeyframe(harness, id, 'positionX', 10, 500)
    scrub(harness, 5)
    harness.setAnimationMode(true)
    const before = harness.undoStack.entries.length

    mouseDown(harness.canvas, { x: 400, y: 200 })
    mouseMove({ x: 450, y: 240 })

    expect(harness.preview.positions.get(id)).toEqual({ x: 450, y: 240 })

    mouseUp({ x: 450, y: 240 })

    expect(harness.undoStack.entries).toHaveLength(before + 1)
    expect(harness.undoStack.entries[0].type).toBe('Transaction')
    const children = entryChildren(harness)
    expect(children.map((child) => child.type)).toEqual(['AddKeyframe', 'AddKeyframe'])
    expect(children.map((child) => child.target.property)).toEqual(['positionX', 'positionY'])
    for (const child of children) {
      expect(child.time).toBe(5)
    }
    expect(children[0].value).toBe(450)
    expect(children[1].value).toBe(240)
    expect(harness.engine.evaluateNode(id, 5).transform).toMatchObject({ x: 450, y: 240 })
  })

  it('updates the keyframes under the playhead instead of duplicating them', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 5, 500)
    addKeyframe(harness, id, 'positionY', 5, 200)
    scrub(harness, 5)
    harness.setAnimationMode(true)
    const before = harness.undoStack.entries.length

    drag(harness.canvas, { x: 500, y: 200 }, { x: 550, y: 230 })

    expect(harness.undoStack.entries).toHaveLength(before + 1)
    expect(harness.undoStack.entries[0].type).toBe('Transaction')
    const children = entryChildren(harness) as unknown as {
      type: string
      target: { nodeId: string; property: string }
      newValue: number
    }[]
    expect(children.map((child) => child.type)).toEqual(['SetKeyframeValue', 'SetKeyframeValue'])
    expect(children.map((child) => child.newValue)).toEqual([550, 230])
    expect(harness.engine.getKeyframes(id, 'positionX')).toHaveLength(1)
    expect(harness.engine.getKeyframes(id, 'positionY')).toHaveLength(1)
    expect(harness.engine.evaluateNode(id, 5).transform).toMatchObject({ x: 550, y: 230 })
  })

  it('commits one mixed transaction for a multi-node drag with inverse data', () => {
    const harness = mount()
    const a = nodeAt(harness, 'A', { x: 100, y: 100 })
    const b = nodeAt(harness, 'B', { x: 300, y: 200 })
    addKeyframe(harness, b, 'positionX', 4, 300)
    addKeyframe(harness, b, 'positionY', 4, 200)
    useSelectionStore.getState().selectMany([a, b])
    scrub(harness, 4)
    harness.setAnimationMode(true)
    const before = harness.undoStack.entries.length

    drag(harness.canvas, { x: 300, y: 200 }, { x: 320, y: 230 })

    expect(harness.undoStack.entries).toHaveLength(before + 1)
    const entry = harness.undoStack.entries[0]
    expect(entry.type).toBe('Transaction')
    const children = entryChildren(harness)
    expect(children.map((child) => child.type)).toEqual([
      'AddKeyframe',
      'AddKeyframe',
      'SetKeyframeValue',
      'SetKeyframeValue',
    ])
    expect(children.map((child) => child.target.nodeId)).toEqual([a, a, b, b])
    const inverse = entry.inverse as {
      children: {
        type: string
        inverse: {
          target: { nodeId: string; property?: string; parameter?: string }
          keyframeId?: string
          oldValue?: number
          time?: number
        }
      }[]
    }
    expect(inverse.children).toHaveLength(4)
    expect(inverse.children[0].inverse.target.nodeId).toBe(a)
    expect(inverse.children[1].inverse.target.nodeId).toBe(a)
    expect(inverse.children[2].inverse).toMatchObject({
      target: { kind: 'node', nodeId: b, property: 'positionX' },
      keyframeId: expect.any(String),
    })
    expect(inverse.children[3].inverse).toMatchObject({
      target: { kind: 'node', nodeId: b, property: 'positionY' },
      keyframeId: expect.any(String),
    })
    expect(harness.engine.evaluateNode(b, 4).transform).toMatchObject({ x: 320, y: 230 })
  })

  it('interpolates smoothly when scrubbing after the drag', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 0, 300)
    addKeyframe(harness, id, 'positionX', 10, 500)
    scrub(harness, 5)
    harness.setAnimationMode(true)

    drag(harness.canvas, { x: 400, y: 200 }, { x: 450, y: 200 })

    expect(harness.engine.getKeyframes(id, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      0, 5, 10,
    ])
    expect(harness.engine.evaluateNode(id, 5).transform.x).toBe(450)
    expect(harness.engine.evaluateNode(id, 2.5).transform.x).toBe(375)
    expect(harness.engine.evaluateNode(id, 7.5).transform.x).toBe(475)
  })

  it('converts the drag delta to local keyframe values through the evaluated parent', () => {
    const harness = mount()
    const slide = harness.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const parent = harness.engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 100, y: 50, rotation: 0, scaleX: 2, scaleY: 2 },
    })
    const child = harness.engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    harness.nodeSizes.add(child.id)
    scrub(harness, 0)
    harness.setAnimationMode(true)

    drag(harness.canvas, { x: 120, y: 90 }, { x: 180, y: 90 })

    expect(harness.engine.getKeyframes(child.id, 'positionX')[0]?.value).toBeCloseTo(40, 10)
    expect(harness.engine.getKeyframes(child.id, 'positionY')).toHaveLength(0)
    expect(harness.engine.evaluateNode(child.id, 0).transform).toMatchObject({
      x: expect.closeTo(40, 10),
      y: expect.closeTo(20, 10),
    })
  })

  it('previews the world→local converted position under a rotated parent and commits it', () => {
    const harness = mount()
    const slide = harness.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const parent = harness.engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 },
    })
    const child = harness.engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    harness.nodeSizes.add(child.id)
    scrub(harness, 0)
    harness.setAnimationMode(true)

    mouseDown(harness.canvas, { x: 0, y: 10 })
    mouseMove({ x: 10, y: 10 })

    expect(harness.preview.positions.get(child.id)).toEqual({ x: 10, y: -10 })

    mouseUp({ x: 10, y: 10 })

    expect(harness.engine.getKeyframes(child.id, 'positionY')[0]?.value).toBeCloseTo(-10, 10)
    expect(harness.engine.getKeyframes(child.id, 'positionX')).toHaveLength(0)
    expect(harness.engine.evaluateNode(child.id, 0).transform).toMatchObject({
      x: expect.closeTo(10, 10),
      y: expect.closeTo(-10, 10),
    })
  })

  it('commits nothing when the pointer moves less than the drag threshold', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    scrub(harness, 3)
    harness.setAnimationMode(true)
    const before = harness.undoStack.entries.length

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 301, y: 201 })
    mouseUp({ x: 301, y: 201 })

    expect(harness.undoStack.entries).toHaveLength(before)
    expect(harness.engine.getKeyframes(id, 'positionX')).toHaveLength(0)
    expect(harness.engine.getKeyframes(id, 'positionY')).toHaveLength(0)
  })
})

describe('move gesture guard in base mode', () => {
  it('rejects the drag of a node with positionX keyframes, showing a notification', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 0, 300)
    const before = harness.undoStack.entries.length

    mouseDown(harness.canvas, { x: 300, y: 200 })
    expect(useSelectionStore.getState().selectedIds).toEqual([id])
    mouseMove({ x: 350, y: 240 })

    expect(harness.preview.positions.has(id)).toBe(false)

    mouseUp({ x: 350, y: 240 })

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      BLOCKED_ANIMATED_MOVE_MESSAGE,
    ])
    expect(harness.undoStack.entries).toHaveLength(before)
    expect(transformOf(harness.engine, id)).toEqual({ x: 300, y: 200 })
    expect(harness.engine.getKeyframes(id, 'positionX')).toHaveLength(1)
  })

  it('rejects the drag of a node with only positionY keyframes', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionY', 0, 200)
    const before = harness.undoStack.entries.length

    drag(harness.canvas, { x: 300, y: 200 }, { x: 350, y: 240 })

    expect(harness.undoStack.entries).toHaveLength(before)
    expect(transformOf(harness.engine, id)).toEqual({ x: 300, y: 200 })
    expect(useNotificationStore.getState().notifications).toHaveLength(1)
  })

  it('does not notify for a plain click on an animated node', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 0, 300)

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseUp({ x: 300, y: 200 })

    expect(useNotificationStore.getState().notifications).toEqual([])
    expect(transformOf(harness.engine, id)).toEqual({ x: 300, y: 200 })
  })
})

describe('hit-testing follows the evaluated state', () => {
  it('selects an animated node at its rendered position and not at its stored position', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 0, 300)
    addKeyframe(harness, id, 'positionX', 10, 500)
    scrub(harness, 5)

    mouseDown(harness.canvas, { x: 400, y: 200 })
    mouseUp({ x: 400, y: 200 })
    expect(useSelectionStore.getState().selectedIds).toEqual([id])

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseUp({ x: 300, y: 200 })
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('selects via marquee only nodes at their rendered positions', () => {
    const harness = mount()
    const id = nodeAt(harness, 'Hero', { x: 300, y: 200 })
    addKeyframe(harness, id, 'positionX', 0, 300)
    addKeyframe(harness, id, 'positionX', 10, 500)
    scrub(harness, 5)

    mouseDown(harness.canvas, { x: 330, y: 150 })
    mouseMove({ x: 470, y: 250 })
    expect(useSelectionStore.getState().selectedIds).toEqual([id])
    mouseUp({ x: 470, y: 250 })

    mouseDown(harness.canvas, { x: 220, y: 150 })
    mouseMove({ x: 300, y: 250 })
    expect(useSelectionStore.getState().selectedIds).toEqual([])
    mouseUp({ x: 300, y: 250 })
  })

  it('aligns the move guides against rendered positions', () => {
    const harness = mount()
    const animated = nodeAt(harness, 'Animated', { x: 300, y: 200 })
    addKeyframe(harness, animated, 'positionX', 0, 300)
    addKeyframe(harness, animated, 'positionX', 10, 500)
    scrub(harness, 5)
    const moving = nodeAt(harness, 'Moving', { x: 300, y: 200 })
    useSelectionStore.getState().select(moving)

    mouseDown(harness.canvas, { x: 300, y: 200 })
    mouseMove({ x: 400, y: 200 })

    const lastShow = harness.guides.shows.at(-1)
    expect(lastShow?.vertical).toContain(400)

    mouseUp({ x: 400, y: 200 })
    expect(transformOf(harness.engine, moving)).toEqual({ x: 400, y: 200 })
  })
})
