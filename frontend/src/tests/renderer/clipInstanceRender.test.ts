import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
  AssignClipCommand,
  SetClipInstanceStartTimeCommand,
  SetClipInstanceEnabledCommand,
  createCommandSystem,
} from '../../engine/commands'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry, FakeContainer } from './pixiFake'
import type { FakeApplication } from './pixiFake'
import { FakeTimeSource } from '../fakeTimeSource'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

interface Mounted {
  system: ReturnType<typeof createCommandSystem>
  timeSource: FakeTimeSource
  renderer: Renderer
  app: FakeApplication
}

async function mount(): Promise<Mounted> {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const timeSource = new FakeTimeSource()
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
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('No pixi application was created')
  }
  return { system, timeSource, renderer, app }
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function createNode(system: ReturnType<typeof createCommandSystem>, name: string): string {
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
      }),
    ),
  )
  return nodeId
}

function createClipWithChannel(
  system: ReturnType<typeof createCommandSystem>,
  channel: 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity',
  keyframes: Array<{ time: number; value: number }>,
): string {
  const inverse = expectOk(
    system.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'TestClip',
        duration: 1,
        channels: [{ property: channel }],
      }),
    ),
  )
  for (const kf of keyframes) {
    expectOk(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: inverse.clipId, channel },
          time: kf.time,
          value: kf.value,
        }),
      ),
    )
  }
  return inverse.clipId
}

function nodeContainer(app: FakeApplication, name: string): FakeContainer {
  const world = app.stage.children[0] as FakeContainer
  const root = world.children.find((child) => child.label === 'Root') as FakeContainer | undefined
  if (!root) {
    throw new Error('Root container not found')
  }
  const container = root.children.find((child) => child.label === name) as FakeContainer | undefined
  if (!container) {
    throw new Error(`Container for ${name} not found`)
  }
  return container
}

beforeEach(() => {
  pixiRegistry.reset()
})

describe('renderer clip instance evaluation', () => {
  it('renders clip instance composition on the canvas', async () => {
    const { system, timeSource, app } = await mount()
    const nodeId = createNode(system, 'A')
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ])
    expectOk(system.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })))

    const container = nodeContainer(app, 'A')
    expect(container.position.x).toBe(0)

    timeSource.set(0.5)
    expect(container.position.x).toBe(50)
  })

  it('applies opacity clip to container alpha during playback', async () => {
    const { system, timeSource, app } = await mount()
    const nodeId = createNode(system, 'A')
    const clipId = createClipWithChannel(system, 'opacity', [
      { time: 0, value: 1 },
      { time: 1, value: 0 },
    ])
    expectOk(system.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })))

    const container = nodeContainer(app, 'A')
    expect(container.alpha).toBe(1)

    timeSource.set(0.5)
    expect(container.alpha).toBe(0.5)

    timeSource.set(1)
    expect(container.alpha).toBe(0)
  })

  it('re-evaluates on clip instance start time change', async () => {
    const { system, timeSource, app } = await mount()
    const nodeId = createNode(system, 'A')
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ])
    const { instanceId } = expectOk(
      system.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )

    timeSource.set(0.5)
    const container = nodeContainer(app, 'A')
    expect(container.position.x).toBe(50)

    // Shift clip to start at t=5
    expectOk(
      system.dispatcher.dispatch(
        new SetClipInstanceStartTimeCommand({ nodeId, instanceId, startTime: 5 }),
      ),
    )

    // At t=0.5, clip hasn't started yet, so position should be 0 (base)
    expect(container.position.x).toBe(0)
  })

  it('re-evaluates on clip instance enable/disable', async () => {
    const { system, app } = await mount()
    const nodeId = createNode(system, 'A')
    const clipId = createClipWithChannel(system, 'positionX', [{ time: 0, value: 100 }])
    const { instanceId } = expectOk(
      system.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )

    const container = nodeContainer(app, 'A')
    expect(container.position.x).toBe(100)

    // Disable clip
    expectOk(
      system.dispatcher.dispatch(
        new SetClipInstanceEnabledCommand({ nodeId, instanceId, enabled: false }),
      ),
    )
    expect(container.position.x).toBe(0)
  })
})
