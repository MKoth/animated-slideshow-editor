import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import type { AnimationProperty } from '../../engine'
import {
  AddKeyframeCommand,
  DeleteKeyframesCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveKeyframesCommand,
  SetKeyframeValueCommand,
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

function addKeyframe(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  property: AnimationProperty,
  time: number,
  value: number,
): string {
  const { keyframe } = expectOk(
    system.dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
    ),
  )
  return keyframe.keyframeId
}

interface SeedTransform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

function createNode(
  system: ReturnType<typeof createCommandSystem>,
  name: string,
  transform?: SeedTransform,
): string {
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
        ...(transform !== undefined && { transform }),
      }),
    ),
  )
  return nodeId
}

function rootOf(app: FakeApplication): FakeContainer {
  const world = app.stage.children[0] as FakeContainer
  const root = world.children.find((child) => child.label === 'Root') as FakeContainer | undefined
  if (!root) {
    throw new Error('Root container not found')
  }
  return root
}

function nodeContainer(app: FakeApplication, name: string): FakeContainer {
  const container = rootOf(app).children.find((child) => child.label === name) as
    FakeContainer | undefined
  if (!container) {
    throw new Error(`Container for ${name} not found`)
  }
  return container
}

beforeEach(() => {
  pixiRegistry.reset()
})

describe('renderer evaluation path', () => {
  it('renders every node from the evaluator at the current time', async () => {
    const { system, timeSource, app } = await mount()
    const nodeId = createNode(system, 'A')
    addKeyframe(system, nodeId, 'positionX', 0, 0)
    addKeyframe(system, nodeId, 'positionX', 10, 100)

    const container = nodeContainer(app, 'A')
    expect(container.position.x).toBe(0)

    timeSource.set(5)
    expect(container.position.x).toBe(50)

    timeSource.set(10)
    expect(container.position.x).toBe(100)
  })

  it('evaluates at bind time using the current time source', async () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const nodeId = createNode(system, 'A')
    addKeyframe(system, nodeId, 'positionX', 0, 0)
    addKeyframe(system, nodeId, 'positionX', 10, 100)
    const timeSource = new FakeTimeSource()
    timeSource.time = 3
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

    expect(nodeContainer(app, 'A').position.x).toBe(30)
  })

  it('renders static values identically when nothing is animated', async () => {
    const { system, timeSource, app } = await mount()
    createNode(system, 'Static', {
      x: 42,
      y: -7,
      rotation: 0.5,
      scaleX: 2,
      scaleY: 2,
    })

    const container = nodeContainer(app, 'Static')
    expect(container.position.x).toBe(42)
    expect(container.position.y).toBe(-7)
    expect(container.rotation).toBe(0.5)
    expect(container.scale.x).toBe(2)
    expect(container.alpha).toBe(1)

    timeSource.set(7)
    expect(container.position.x).toBe(42)
    expect(container.alpha).toBe(1)
    expect(nodeContainer(app, 'Camera').alpha).toBe(1)
  })

  it('re-evaluates nodes on keyframe events', async () => {
    const { system, app } = await mount()
    const nodeId = createNode(system, 'A', {
      x: 7,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    const firstKeyframe = addKeyframe(system, nodeId, 'positionX', 0, 0)
    const secondKeyframe = addKeyframe(system, nodeId, 'positionX', 10, 100)
    const container = nodeContainer(app, 'A')
    expect(container.position.x).toBe(0)

    expectOk(
      system.dispatcher.dispatch(
        new SetKeyframeValueCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          keyframeId: firstKeyframe,
          newValue: 60,
        }),
      ),
    )
    expect(container.position.x).toBe(60)

    expectOk(
      system.dispatcher.dispatch(
        new MoveKeyframesCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          moves: [{ keyframeId: firstKeyframe, newTime: 2 }],
        }),
      ),
    )
    expect(container.position.x).toBe(60)

    expectOk(
      system.dispatcher.dispatch(
        new DeleteKeyframesCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          keyframeIds: [firstKeyframe],
        }),
      ),
    )
    expect(container.position.x).toBe(100)

    expectOk(
      system.dispatcher.dispatch(
        new DeleteKeyframesCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          keyframeIds: [secondKeyframe],
        }),
      ),
    )
    expect(container.position.x).toBe(7)
  })

  it('updates only the node whose keyframes changed', async () => {
    const { system, app } = await mount()
    const animatedId = createNode(system, 'A')
    createNode(system, 'B', {
      x: 99,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    const keyframeId = addKeyframe(system, animatedId, 'positionX', 0, 0)
    addKeyframe(system, animatedId, 'positionX', 10, 100)
    const animated = nodeContainer(app, 'A')
    const staticNode = nodeContainer(app, 'B')
    const animatedSet = vi.spyOn(animated.position, 'set')
    const staticSet = vi.spyOn(staticNode.position, 'set')

    expectOk(
      system.dispatcher.dispatch(
        new SetKeyframeValueCommand({
          target: { kind: 'node', nodeId: animatedId, property: 'positionX' },
          keyframeId,
          newValue: 80,
        }),
      ),
    )

    expect(animated.position.x).toBe(80)
    expect(animatedSet).toHaveBeenCalledTimes(1)
    expect(staticSet).not.toHaveBeenCalled()
    expect(staticNode.position.x).toBe(99)
  })

  it('updates all nodes on current-time changes but only applies changed values', async () => {
    const { system, timeSource, app } = await mount()
    const animatedId = createNode(system, 'A')
    createNode(system, 'B', {
      x: 99,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    addKeyframe(system, animatedId, 'positionX', 0, 0)
    addKeyframe(system, animatedId, 'positionX', 10, 100)
    const animated = nodeContainer(app, 'A')
    const staticNode = nodeContainer(app, 'B')
    const staticSet = vi.spyOn(staticNode.position, 'set')

    timeSource.set(5)
    expect(animated.position.x).toBe(50)
    expect(staticNode.position.x).toBe(99)
    expect(staticSet).not.toHaveBeenCalled()
  })

  it('never recreates a Pixi container on evaluation', async () => {
    const { system, timeSource, app } = await mount()
    const animatedId = createNode(system, 'A')
    createNode(system, 'B')
    const keyframeId = addKeyframe(system, animatedId, 'positionX', 0, 0)
    addKeyframe(system, animatedId, 'positionX', 10, 100)

    const before = rootOf(app).children
    timeSource.set(5)
    expectOk(
      system.dispatcher.dispatch(
        new SetKeyframeValueCommand({
          target: { kind: 'node', nodeId: animatedId, property: 'positionX' },
          keyframeId,
          newValue: 20,
        }),
      ),
    )
    timeSource.set(8)

    expect(rootOf(app).children).toEqual(before)
    expect(nodeContainer(app, 'A')).toBe(before.find((child) => child.label === 'A'))
    expect(nodeContainer(app, 'B')).toBe(before.find((child) => child.label === 'B'))
  })

  it('evaluates the camera node and animates it on current-time changes', async () => {
    const { system, timeSource, app } = await mount()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const cameraId = slide.scene.camera.id
    addKeyframe(system, cameraId, 'positionX', 0, 0)
    addKeyframe(system, cameraId, 'positionX', 10, 100)

    const camera = nodeContainer(app, 'Camera')
    expect(camera.position.x).toBe(0)

    timeSource.set(5)
    expect(camera.position.x).toBe(50)
  })

  it('applies evaluated opacity to the display object alpha', async () => {
    const { system, timeSource, app } = await mount()
    const nodeId = createNode(system, 'A', {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    addKeyframe(system, nodeId, 'opacity', 0, 0)
    addKeyframe(system, nodeId, 'opacity', 10, 1)

    const container = nodeContainer(app, 'A')
    expect(container.alpha).toBe(0)

    timeSource.set(5)
    expect(container.alpha).toBe(0.5)
  })

  it('stops re-evaluating after dispose', async () => {
    const { system, timeSource, app, renderer } = await mount()
    const nodeId = createNode(system, 'A')
    addKeyframe(system, nodeId, 'positionX', 0, 0)
    addKeyframe(system, nodeId, 'positionX', 10, 100)
    const container = nodeContainer(app, 'A')

    renderer.dispose()
    expect(timeSource.listeners.size).toBe(0)

    timeSource.set(5)
    expect(container.position.x).toBe(0)
  })
})
