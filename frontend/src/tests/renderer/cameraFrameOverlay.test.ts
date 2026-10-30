import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
  AddKeyframeCommand,
} from '../../engine/commands'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry } from './pixiFake'
import { FakeTimeSource } from '../fakeTimeSource'
import { useUiStore } from '../../stores/uiStore'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
  useUiStore.getState().setAnimationMode(false)
  useUiStore.getState().setCameraAnimationMode(false)
  useOverlayVisibilityStore.setState({ cameraFrameVisible: true })
})

async function mount(timeSource?: FakeTimeSource) {
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
  const app = pixiRegistry.applications.at(-1)!
  const camera = system.engine.project?.slides[0]?.scene.camera
  if (!camera) throw new Error('no camera')
  return { system, app, cameraId: camera.id }
}

function frameGraphics() {
  return pixiRegistry.graphics.filter((g) => g.label === 'camera-frame-overlay')
}

describe('camera frame overlay', () => {
  it('shows authored camera rect while navigating freely', async () => {
    const time = new FakeTimeSource()
    const { system, app, cameraId } = await mount(time)
    // author camera at (100,50) scale 2 via keyframes at t=0
    for (const [prop, val] of [
      ['positionX', 100],
      ['positionY', 50],
      ['scaleX', 2],
      ['scaleY', 2],
    ] as const) {
      system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId: cameraId, property: prop },
          time: 0,
          value: val,
        }),
      )
    }
    time.set(0)
    app.ticker.tick()
    const frames = frameGraphics()
    expect(frames.length).toBe(1)
    const g = frames[0]
    expect(g.visible).toBe(true)
    // app.screen 800x600, scale 2 => w=400 h=300, origin 100,50
    const rectCall = g.calls.find((c) => c.method === 'rect')
    expect(rectCall?.args).toEqual([100, 50, 400, 300])
  })

  it('hides when camera animation mode is on', async () => {
    const time = new FakeTimeSource()
    const { system, app, cameraId } = await mount(time)
    for (const [prop, val] of [
      ['positionX', 100],
      ['positionY', 50],
      ['scaleX', 2],
      ['scaleY', 2],
    ] as const) {
      system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId: cameraId, property: prop },
          time: 0,
          value: val,
        }),
      )
    }
    useUiStore.getState().setCameraAnimationMode(true)
    time.set(0)
    app.ticker.tick()
    const g = frameGraphics()[0]
    expect(g.visible).toBe(false)
  })

  it('hides when toggle is off', async () => {
    const time = new FakeTimeSource()
    const { app } = await mount(time)
    useOverlayVisibilityStore.getState().setCameraFrameVisible(false)
    app.ticker.tick()
    const g = frameGraphics()[0]
    expect(g.visible).toBe(false)
  })
})
