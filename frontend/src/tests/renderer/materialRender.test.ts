import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  AssignMaterialCommand,
  ClearMaterialOverrideCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideMaterialParameterCommand,
  SetOpacityCommand,
  UndoStack,
} from '../../engine/commands'
import type { AnimationProperty } from '../../engine'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry } from './pixiFake'
import type { FakeApplication, FakeContainer } from './pixiFake'
import { FakeTimeSource } from '../fakeTimeSource'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

interface Mounted {
  engine: Engine
  dispatcher: CommandDispatcher
  timeSource: FakeTimeSource
  renderer: Renderer
  app: FakeApplication
}

async function mount(): Promise<Mounted> {
  const engine = createEngine()
  const dispatcher = new CommandDispatcher(engine, new UndoStack())
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const timeSource = new FakeTimeSource()
  const host = document.createElement('div')
  const renderer = new Renderer(
    host,
    engine,
    (command) => dispatcher.dispatch(command),
    undefined,
    undefined,
    timeSource,
  )
  await renderer.start()
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('No pixi application was created')
  }
  return { engine, dispatcher, timeSource, renderer, app }
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

interface SeedTransform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

function createNode(
  engine: Engine,
  dispatcher: CommandDispatcher,
  name: string,
  options: {
    transform?: SeedTransform
    components?: Record<string, unknown>
    opacity?: number
  } = {},
): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
        ...(options.transform !== undefined && { transform: options.transform }),
        ...(options.opacity !== undefined && { opacity: options.opacity }),
        ...(options.components !== undefined && {
          components: options.components as never,
        }),
      }),
    ),
  )
  return nodeId
}

function addKeyframes(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: AnimationProperty,
  keyframes: ReadonlyArray<{ time: number; value: number }>,
): void {
  for (const keyframe of keyframes) {
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property },
          time: keyframe.time,
          value: keyframe.value,
        }),
      ),
    )
  }
}

function nodeNamed(engine: Engine, name: string): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const node = slide.scene.root.children.find((child) => child.name === name)
  if (!node) {
    throw new Error(`Node ${name} not found`)
  }
  return node.id
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

function placeholderBody(container: FakeContainer): FakeContainer {
  const placeholder = container.children[0] as FakeContainer | undefined
  if (!placeholder) {
    throw new Error('Placeholder group not found')
  }
  const body = placeholder.children.find((child) => child.kind === 'sprite') as
    FakeContainer | undefined
  if (!body) {
    throw new Error('Placeholder body sprite not found')
  }
  return body
}

function spriteTint(container: FakeContainer): number {
  return (placeholderBody(container) as unknown as { tint: number }).tint
}

beforeEach(() => {
  pixiRegistry.reset()
})

describe('renderer material composition', () => {
  it('renders the default material as a plain texture with no tint', async () => {
    const { engine, dispatcher, app } = await mount()
    const nodeId = createNode(engine, dispatcher, 'A', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' } },
    })

    const container = nodeContainer(app, 'A')
    expect(spriteTint(container)).toBe(0xffffff)
    expect(container.alpha).toBe(1)

    expectOk(dispatcher.dispatch(new SetOpacityCommand({ nodeId, opacity: 0.5 })))
    expect(container.alpha).toBe(0.5)
    expect(spriteTint(container)).toBe(0xffffff)
  })

  it('applies an instance tint override to the asset sprite', async () => {
    const { engine, dispatcher, app } = await mount()
    createNode(engine, dispatcher, 'A', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' } },
    })
    const nodeId = nodeNamed(engine, 'A')
    const container = nodeContainer(app, 'A')

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
      ),
    )

    expect(spriteTint(container)).toBe(0xff0000)
  })

  it('applies the instance tint override to a text node', async () => {
    const { engine, dispatcher, app } = await mount()
    createNode(engine, dispatcher, 'T', {
      components: {
        text: { kind: 'text', content: 'Hi', fontSize: 24, alignment: 'center' },
      },
    })
    const nodeId = nodeNamed(engine, 'T')
    const container = nodeContainer(app, 'T')

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#00ff00' }),
      ),
    )

    expect(spriteTint(container)).toBe(0x00ff00)
  })

  it('uses the definition default tint when there is no override', async () => {
    const { engine, dispatcher, app } = await mount()
    engine.registerMaterialDefinition('mat-warm', 'Warm', [
      { key: 'tint', kind: 'color', default: '#ff8800' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
    ])
    createNode(engine, dispatcher, 'A', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' } },
    })
    const nodeId = nodeNamed(engine, 'A')

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-warm' })),
    )

    expect(spriteTint(nodeContainer(app, 'A'))).toBe(0xff8800)
  })

  it('clearing the tint override returns to the definition default', async () => {
    const { engine, dispatcher, app } = await mount()
    engine.registerMaterialDefinition('mat-warm', 'Warm', [
      { key: 'tint', kind: 'color', default: '#ff8800' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
    ])
    createNode(engine, dispatcher, 'A', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' } },
    })
    const nodeId = nodeNamed(engine, 'A')
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-warm' })),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#0000ff' }),
      ),
    )
    expect(spriteTint(nodeContainer(app, 'A'))).toBe(0x0000ff)

    expectOk(dispatcher.dispatch(new ClearMaterialOverrideCommand({ nodeId, parameter: 'tint' })))

    expect(spriteTint(nodeContainer(app, 'A'))).toBe(0xff8800)
  })

  it('composes evaluated node opacity with the instance multiplier override', async () => {
    const { engine, dispatcher, timeSource, app } = await mount()
    const nodeId = createNode(engine, dispatcher, 'A')
    addKeyframes(dispatcher, nodeId, 'opacity', [
      { time: 0, value: 0 },
      { time: 10, value: 1 },
    ])
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({
          nodeId,
          parameter: 'opacityMultiplier',
          value: 0.5,
        }),
      ),
    )
    const container = nodeContainer(app, 'A')
    expect(container.alpha).toBe(0)

    timeSource.set(5)
    expect(container.alpha).toBe(0.25)

    timeSource.set(10)
    expect(container.alpha).toBe(0.5)
  })

  it('uses the definition default opacity multiplier in composition', async () => {
    const { engine, dispatcher, timeSource, app } = await mount()
    engine.registerMaterialDefinition('mat-half', 'Half', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 0.5 },
    ])
    const nodeId = createNode(engine, dispatcher, 'A')
    addKeyframes(dispatcher, nodeId, 'opacity', [
      { time: 0, value: 0 },
      { time: 10, value: 1 },
    ])
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-half' })),
    )
    const container = nodeContainer(app, 'A')

    timeSource.set(10)
    expect(container.alpha).toBe(0.5)
  })

  it('re-evaluates material composition on MaterialAssigned', async () => {
    const { engine, dispatcher, timeSource, app } = await mount()
    engine.registerMaterialDefinition('mat-half', 'Half', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 0.5 },
    ])
    const nodeId = createNode(engine, dispatcher, 'A', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' } },
    })
    const container = nodeContainer(app, 'A')
    timeSource.set(4)
    expect(container.alpha).toBe(1)

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-half' })),
    )

    expect(container.alpha).toBe(0.5)
    expect(spriteTint(container)).toBe(0xffffff)
  })

  it('updates only the affected node on a material change', async () => {
    const { engine, dispatcher, app } = await mount()
    createNode(engine, dispatcher, 'A', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' } },
    })
    createNode(engine, dispatcher, 'B', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-b' } },
    })
    const aId = nodeNamed(engine, 'A')
    const bId = nodeNamed(engine, 'B')
    const a = nodeContainer(app, 'A')
    const b = nodeContainer(app, 'B')
    const bTint = vi.fn()
    Object.defineProperty(placeholderBody(b), 'tint', {
      configurable: true,
      get: () => 0xffffff,
      set: bTint,
    })

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId: aId, parameter: 'tint', value: '#ff0000' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({
          nodeId: bId,
          parameter: 'tint',
          value: '#00ff00',
        }),
      ),
    )

    expect(spriteTint(a)).toBe(0xff0000)
    expect(bTint).toHaveBeenCalledTimes(1)
  })
})
