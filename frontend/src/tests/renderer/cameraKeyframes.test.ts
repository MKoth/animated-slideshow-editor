import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AddKeyframeCommand,
  BatchMoveKeyframesCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { AnimationProperty } from '../../engine'
import { Renderer } from '../../pixi/renderer/renderer'
import { worldOf } from './testUtils'
import { pixiRegistry } from './pixiFake'
import { FakeTimeSource } from '../fakeTimeSource'
import { useSelectionStore } from '../../stores/selectionStore'
import { useUiStore } from '../../stores/uiStore'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
  useUiStore.getState().setAnimationMode(false)
  useUiStore.getState().setCameraAnimationMode(false)
  useSelectionStore.setState({ selectedIds: [] })
})

interface Harness {
  system: ReturnType<typeof createCommandSystem>
  app: (typeof pixiRegistry.applications)[number]
  canvas: HTMLCanvasElement
  cameraId: string
}

async function mount(timeSource?: FakeTimeSource): Promise<Harness> {
  const system = createCommandSystem()
  const host = document.createElement('div')
  const renderer = new Renderer(
    host,
    system.engine,
    (command) => system.dispatcher.dispatch(command),
    undefined,
    undefined,
    timeSource,
  )
  await renderer.start()
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
  system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
  const app = pixiRegistry.applications.at(-1)
  const canvas = host.querySelector('canvas')
  const camera = system.engine.project?.slides[0]?.scene.camera
  if (!app || !canvas || !camera) {
    throw new Error('Failed to mount the renderer with a camera')
  }
  return { system, app, canvas, cameraId: camera.id }
}

function wheelAt(canvas: HTMLCanvasElement, x: number, y: number, deltaY: number): void {
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      clientX: x,
      clientY: y,
      deltaY,
      bubbles: true,
      cancelable: true,
    }),
  )
}

function middleDrag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]): void {
  canvas.dispatchEvent(
    new MouseEvent('mousedown', {
      button: 1,
      clientX: from[0],
      clientY: from[1],
      bubbles: true,
      cancelable: true,
    }),
  )
  window.dispatchEvent(
    new MouseEvent('mousemove', { button: 1, clientX: to[0], clientY: to[1], bubbles: true }),
  )
  window.dispatchEvent(
    new MouseEvent('mouseup', { button: 1, clientX: to[0], clientY: to[1], bubbles: true }),
  )
}

function click(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }),
  )
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }))
}

function dispatchKeyframe(
  system: Harness['system'],
  nodeId: string,
  property: AnimationProperty,
  time: number,
  value: number,
): void {
  system.dispatcher.dispatch(new AddKeyframeCommand({ nodeId, property, time, value }))
}

function keyframesOf(system: Harness['system'], nodeId: string, property: AnimationProperty) {
  return system.engine.getKeyframes(nodeId, property)
}

function storedTransformOf(system: Harness['system'], cameraId: string) {
  return system.engine.getNode(cameraId).transform
}

describe('evaluated viewport', () => {
  it('moves and zooms the world container from camera keyframes as the playhead scrubs', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, cameraId } = await mount(timeSource)
    useUiStore.getState().setCameraAnimationMode(true)
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    dispatchKeyframe(system, cameraId, 'positionY', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionY', 10, 200)
    dispatchKeyframe(system, cameraId, 'scaleX', 0, 1)
    dispatchKeyframe(system, cameraId, 'scaleX', 10, 2)
    dispatchKeyframe(system, cameraId, 'scaleY', 0, 1)
    dispatchKeyframe(system, cameraId, 'scaleY', 10, 2)

    const world = worldOf(app)
    app.ticker.tick()
    expect(world.position.x).toBeCloseTo(0)
    expect(world.position.y).toBeCloseTo(0)
    expect(world.scale.x).toBe(1)

    timeSource.set(5)
    app.ticker.tick()
    expect(world.position.x).toBeCloseTo(-50 * 1.5)
    expect(world.position.y).toBeCloseTo(-100 * 1.5)
    expect(world.scale.x).toBeCloseTo(1.5)
    expect(world.scale.y).toBeCloseTo(1.5)

    timeSource.set(10)
    app.ticker.tick()
    expect(world.position.x).toBeCloseTo(-200)
    expect(world.position.y).toBeCloseTo(-400)
    expect(world.scale.x).toBeCloseTo(2)
  })

  it('keeps the stored camera transform untouched while the viewport follows keyframes', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, cameraId } = await mount(timeSource)
    useUiStore.getState().setCameraAnimationMode(true)
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    timeSource.set(7)
    app.ticker.tick()

    expect(storedTransformOf(system, cameraId)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(worldOf(app).position.x).toBeCloseTo(-70)
  })

  it('ignores camera keyframes while camera animation mode is off: stored pan/zoom still move the viewport', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, canvas, cameraId } = await mount(timeSource)
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    dispatchKeyframe(system, cameraId, 'positionY', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionY', 10, 200)
    timeSource.set(5)
    app.ticker.tick()
    expect(worldOf(app).position.x).toBeCloseTo(0)

    middleDrag(canvas, [300, 200], [350, 220])
    app.ticker.tick()

    expect(worldOf(app).position.x).toBeCloseTo(50)
    expect(worldOf(app).position.y).toBeCloseTo(20)
    expect(storedTransformOf(system, cameraId).x).toBeCloseTo(-50)
    expect(storedTransformOf(system, cameraId).y).toBeCloseTo(-20)
    expect(keyframesOf(system, cameraId, 'positionX')).toHaveLength(2)
  })

  it('snaps the viewport to the keyframe at the playhead when camera animation mode turns on', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, cameraId } = await mount(timeSource)
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    timeSource.set(7)
    app.ticker.tick()
    expect(worldOf(app).position.x).toBeCloseTo(0)

    useUiStore.getState().setCameraAnimationMode(true)
    app.ticker.tick()

    expect(worldOf(app).position.x).toBeCloseTo(-70)
  })

  it('does not react to moved camera keyframes while camera animation mode is off', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, cameraId } = await mount(timeSource)
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    timeSource.set(7)
    app.ticker.tick()
    expect(worldOf(app).position.x).toBeCloseTo(0)

    const keyframes = keyframesOf(system, cameraId, 'positionX')
    system.dispatcher.dispatch(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId: cameraId, property: 'positionX', keyframeId: keyframes[1].id, newTime: 5 },
        ],
      }),
    )
    app.ticker.tick()

    expect(worldOf(app).position.x).toBeCloseTo(0)
  })

  it('moves the viewport when camera keyframes are dragged while camera animation mode is on', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, cameraId } = await mount(timeSource)
    useUiStore.getState().setCameraAnimationMode(true)
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    timeSource.set(7)
    app.ticker.tick()
    expect(worldOf(app).position.x).toBeCloseTo(-70)

    const keyframes = keyframesOf(system, cameraId, 'positionX')
    system.dispatcher.dispatch(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId: cameraId, property: 'positionX', keyframeId: keyframes[1].id, newTime: 5 },
        ],
      }),
    )
    app.ticker.tick()

    expect(worldOf(app).position.x).toBeCloseTo(-100)
  })
})

describe('animation-mode pan', () => {
  it('creates positionX/positionY keyframes at the playhead on a static span, one transaction per gesture', async () => {
    const timeSource = new FakeTimeSource()
    const { system, canvas, cameraId } = await mount(timeSource)
    timeSource.set(5)
    useUiStore.getState().setCameraAnimationMode(true)
    const stored = storedTransformOf(system, cameraId)
    const undoCount = system.undoStack.entries.length

    middleDrag(canvas, [300, 200], [350, 220])

    expect(keyframesOf(system, cameraId, 'positionX')).toHaveLength(1)
    expect(keyframesOf(system, cameraId, 'positionX')[0]).toMatchObject({ time: 5, value: -50 })
    expect(keyframesOf(system, cameraId, 'positionY')).toHaveLength(1)
    expect(keyframesOf(system, cameraId, 'positionY')[0]).toMatchObject({ time: 5, value: -20 })
    expect(storedTransformOf(system, cameraId)).toEqual(stored)
    expect(system.undoStack.entries).toHaveLength(undoCount + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
  })

  it('previews the pan on the viewport while dragging and keeps it after the commit', async () => {
    const timeSource = new FakeTimeSource()
    const { app, canvas } = await mount(timeSource)
    timeSource.set(5)
    useUiStore.getState().setCameraAnimationMode(true)

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))
    app.ticker.tick()
    expect(worldOf(app).position.x).toBeCloseTo(50)
    expect(worldOf(app).position.y).toBeCloseTo(20)

    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: 350, clientY: 220 }))
    app.ticker.tick()
    expect(worldOf(app).position.x).toBeCloseTo(50)
    expect(worldOf(app).position.y).toBeCloseTo(20)
  })

  it('updates existing keyframes under the playhead instead of adding duplicates', async () => {
    const timeSource = new FakeTimeSource()
    const { system, canvas, cameraId } = await mount(timeSource)
    timeSource.set(5)
    dispatchKeyframe(system, cameraId, 'positionX', 5, 0)
    dispatchKeyframe(system, cameraId, 'positionY', 5, 0)
    useUiStore.getState().setCameraAnimationMode(true)
    const undoCount = system.undoStack.entries.length

    middleDrag(canvas, [300, 200], [350, 220])

    expect(keyframesOf(system, cameraId, 'positionX')).toHaveLength(1)
    expect(keyframesOf(system, cameraId, 'positionX')[0]).toMatchObject({ time: 5, value: -50 })
    expect(keyframesOf(system, cameraId, 'positionY')).toHaveLength(1)
    expect(keyframesOf(system, cameraId, 'positionY')[0]).toMatchObject({ time: 5, value: -20 })
    expect(system.undoStack.entries).toHaveLength(undoCount + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
  })

  it('pans in zoomed coordinates against the evaluated camera', async () => {
    const timeSource = new FakeTimeSource()
    const { system, canvas, cameraId } = await mount(timeSource)
    dispatchKeyframe(system, cameraId, 'scaleX', 0, 2)
    dispatchKeyframe(system, cameraId, 'scaleY', 0, 2)
    dispatchKeyframe(system, cameraId, 'scaleX', 10, 2)
    dispatchKeyframe(system, cameraId, 'scaleY', 10, 2)
    timeSource.set(5)
    useUiStore.getState().setCameraAnimationMode(true)

    middleDrag(canvas, [100, 100], [120, 110])

    expect(keyframesOf(system, cameraId, 'positionX')[0].value).toBeCloseTo(-10)
    expect(keyframesOf(system, cameraId, 'positionY')[0].value).toBeCloseTo(-5)
  })

  it('clears the preview when the gesture ends with animation mode switched off mid-drag', async () => {
    const timeSource = new FakeTimeSource()
    const { app, canvas } = await mount(timeSource)
    timeSource.set(5)
    useUiStore.getState().setCameraAnimationMode(true)

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))
    useUiStore.getState().setCameraAnimationMode(false)
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: 350, clientY: 220 }))
    app.ticker.tick()

    expect(worldOf(app).position.x).toBeCloseTo(0)
    expect(worldOf(app).position.y).toBeCloseTo(0)
  })

  it('records inverse data for a pan gesture so one undo removes both keyframes', async () => {
    const timeSource = new FakeTimeSource()
    const { system, canvas } = await mount(timeSource)
    timeSource.set(5)
    useUiStore.getState().setCameraAnimationMode(true)

    middleDrag(canvas, [300, 200], [350, 220])

    const entry = system.undoStack.entries[0]
    expect(entry.type).toBe('Transaction')
    const children = entry.inverse as {
      children: { type: string; inverse: { property: string; keyframeId: string } }[]
    }
    expect(children.children).toHaveLength(2)
    expect(children.children.map((child) => child.type)).toEqual(['AddKeyframe', 'AddKeyframe'])
    expect(children.children.map((child) => child.inverse.property)).toEqual([
      'positionX',
      'positionY',
    ])
    expect(children.children.every((child) => typeof child.inverse.keyframeId === 'string')).toBe(
      true,
    )
  })
})

describe('animation-mode zoom', () => {
  it('creates scale/position keyframes at the playhead, one transaction per gesture', async () => {
    vi.useFakeTimers()
    try {
      const timeSource = new FakeTimeSource()
      const { system, canvas, cameraId } = await mount(timeSource)
      timeSource.set(5)
      useUiStore.getState().setCameraAnimationMode(true)
      const stored = storedTransformOf(system, cameraId)
      const undoCount = system.undoStack.entries.length

      wheelAt(canvas, 400, 300, -100)
      wheelAt(canvas, 400, 300, -100)
      vi.advanceTimersByTime(250)

      const expectedZoom = Math.exp(0.2)
      expect(keyframesOf(system, cameraId, 'scaleX')).toHaveLength(1)
      expect(keyframesOf(system, cameraId, 'scaleX')[0]).toMatchObject({ time: 5 })
      expect(keyframesOf(system, cameraId, 'scaleX')[0].value).toBeCloseTo(expectedZoom)
      expect(keyframesOf(system, cameraId, 'scaleY')[0].value).toBeCloseTo(expectedZoom)
      expect(keyframesOf(system, cameraId, 'positionX')[0]).toMatchObject({ time: 5 })
      expect(keyframesOf(system, cameraId, 'positionY')[0]).toMatchObject({ time: 5 })
      expect(storedTransformOf(system, cameraId)).toEqual(stored)
      expect(system.undoStack.entries).toHaveLength(undoCount + 1)
      expect(system.undoStack.entries[0].type).toBe('Transaction')
    } finally {
      vi.useRealTimers()
    }
  })

  it('previews the zoom on the viewport during the gesture and keeps it after the commit', async () => {
    vi.useFakeTimers()
    try {
      const timeSource = new FakeTimeSource()
      const { app, canvas } = await mount(timeSource)
      timeSource.set(5)
      useUiStore.getState().setCameraAnimationMode(true)

      wheelAt(canvas, 400, 300, -100)
      app.ticker.tick()
      expect(worldOf(app).scale.x).toBeCloseTo(Math.exp(0.1))

      vi.advanceTimersByTime(250)
      app.ticker.tick()
      expect(worldOf(app).scale.x).toBeCloseTo(Math.exp(0.1))
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates existing scale keyframes under the playhead instead of adding duplicates', async () => {
    vi.useFakeTimers()
    try {
      const timeSource = new FakeTimeSource()
      const { system, canvas, cameraId } = await mount(timeSource)
      timeSource.set(5)
      dispatchKeyframe(system, cameraId, 'scaleX', 5, 1)
      dispatchKeyframe(system, cameraId, 'scaleY', 5, 1)
      useUiStore.getState().setCameraAnimationMode(true)
      const undoCount = system.undoStack.entries.length

      wheelAt(canvas, 400, 300, -100)
      vi.advanceTimersByTime(250)

      expect(keyframesOf(system, cameraId, 'scaleX')).toHaveLength(1)
      expect(keyframesOf(system, cameraId, 'scaleX')[0].value).toBeCloseTo(Math.exp(0.1))
      expect(keyframesOf(system, cameraId, 'scaleY')).toHaveLength(1)
      expect(system.undoStack.entries).toHaveLength(undoCount + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('commits nothing when the gesture ends where the evaluated camera already is', async () => {
    vi.useFakeTimers()
    try {
      const timeSource = new FakeTimeSource()
      const { system, canvas, cameraId } = await mount(timeSource)
      timeSource.set(5)
      useUiStore.getState().setCameraAnimationMode(true)

      wheelAt(canvas, 400, 300, -10_000_000)
      vi.advanceTimersByTime(250)
      const undoCount = system.undoStack.entries.length
      const keyframeCount = keyframesOf(system, cameraId, 'scaleX').length

      wheelAt(canvas, 400, 300, -10_000_000)
      vi.advanceTimersByTime(250)

      expect(system.undoStack.entries).toHaveLength(undoCount)
      expect(keyframesOf(system, cameraId, 'scaleX')).toHaveLength(keyframeCount)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records inverse data for a zoom gesture so one undo removes all four keyframes', async () => {
    vi.useFakeTimers()
    try {
      const timeSource = new FakeTimeSource()
      const { system, canvas, cameraId } = await mount(timeSource)
      timeSource.set(5)
      useUiStore.getState().setCameraAnimationMode(true)

      wheelAt(canvas, 400, 300, -100)
      vi.advanceTimersByTime(250)
      expect(keyframesOf(system, cameraId, 'scaleX')).toHaveLength(1)

      const entry = system.undoStack.entries[0]
      expect(entry.type).toBe('Transaction')
      const children = entry.inverse as {
        children: { type: string; inverse: { property: string } }[]
      }
      expect(children.children).toHaveLength(4)
      expect(children.children.map((child) => child.type)).toEqual([
        'AddKeyframe',
        'AddKeyframe',
        'AddKeyframe',
        'AddKeyframe',
      ])
      expect(children.children.map((child) => child.inverse.property)).toEqual([
        'positionX',
        'positionY',
        'scaleX',
        'scaleY',
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('animation-mode reset', () => {
  it('creates position/scale keyframes at the playhead in one transaction on double-click reset', async () => {
    const timeSource = new FakeTimeSource()
    const { system, canvas, cameraId } = await mount(timeSource)
    middleDrag(canvas, [300, 200], [500, 400])
    wheelAt(canvas, 200, 150, -100)
    timeSource.set(4)
    useUiStore.getState().setCameraAnimationMode(true)
    const stored = storedTransformOf(system, cameraId)
    const undoCount = system.undoStack.entries.length

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(keyframesOf(system, cameraId, 'positionX')[0]).toMatchObject({ time: 4, value: 0 })
    expect(keyframesOf(system, cameraId, 'positionY')[0]).toMatchObject({ time: 4, value: 0 })
    expect(keyframesOf(system, cameraId, 'scaleX')[0]).toMatchObject({ time: 4, value: 1 })
    expect(keyframesOf(system, cameraId, 'scaleY')[0]).toMatchObject({ time: 4, value: 1 })
    expect(storedTransformOf(system, cameraId)).toEqual(stored)
    expect(system.undoStack.entries).toHaveLength(undoCount + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
  })

  it('keeps the plain stored-value reset when animation mode is off', async () => {
    const { system, canvas, cameraId } = await mount()
    middleDrag(canvas, [300, 200], [400, 300])
    const undoCount = system.undoStack.entries.length

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(storedTransformOf(system, cameraId)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(system.undoStack.entries).toHaveLength(undoCount + 2)
    expect(system.undoStack.entries[0]).toMatchObject({ type: 'ScaleNode' })
    expect(system.undoStack.entries[1]).toMatchObject({ type: 'MoveNode' })
  })
})

describe('cursor-world consistency', () => {
  it('hit-tests through the evaluated camera: clicking where a node renders selects it', async () => {
    const timeSource = new FakeTimeSource()
    const { system, app, canvas, cameraId } = await mount(timeSource)
    useUiStore.getState().setCameraAnimationMode(true)
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const created = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Hero',
        transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
      }),
    )
    if (!created.ok) {
      throw new Error(`Failed to create the node: ${created.error.message}`)
    }
    const { nodeId } = created.inverse
    dispatchKeyframe(system, cameraId, 'positionX', 0, 0)
    dispatchKeyframe(system, cameraId, 'positionX', 10, 100)
    timeSource.set(5)
    app.ticker.tick()

    click(canvas, 50, 0)

    expect(useSelectionStore.getState().selectedIds).toEqual([nodeId])
  })
})
