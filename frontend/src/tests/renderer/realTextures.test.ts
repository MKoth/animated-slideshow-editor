import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import type { CreateAssetInstanceInverse } from '../../engine/commands/createAssetInstanceCommand'
import { CreateAssetInstanceCommand } from '../../engine/commands/createAssetInstanceCommand'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  MoveNodeCommand,
} from '../../engine/commands'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { realPixi } from '../../pixi/renderer/pixi'
import { Renderer } from '../../pixi/renderer/renderer'
import {
  FakeTexture,
  assetLoadCalls,
  deferredTexture,
  pixiRegistry,
  resetTextureRegistries,
  textureDeferreds,
  textureFailures,
  textureLoads,
} from './pixiFake'
import type { FakeChild } from './testUtils'
import { findByLabel, worldOf } from './testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
  resetTextureRegistries()
})

const ORIGINAL_URL = '/api/assets/originals/def-boy.png'
const BOY_IMAGE = new FakeTexture('boy.png', { width: 512, height: 300 })

interface Harness {
  system: { engine: Engine; dispatcher: CommandDispatcher }
  app: (typeof pixiRegistry.applications)[number]
  definitionId: string
}

async function setup(): Promise<Harness> {
  const engine = createEngine()
  const dispatcher = new CommandDispatcher(engine, new UndoStack())
  const host = document.createElement('div')
  const definition = engine.defineAsset('Boy')
  const renderer = new Renderer(host, engine, undefined, realPixi, (definitionId) =>
    definitionId === definition.id ? ORIGINAL_URL : null,
  )
  await renderer.start()
  dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
  const app = pixiRegistry.applications[0]
  if (!app) {
    throw new Error('No pixi application was created')
  }
  return { system: { engine, dispatcher }, app, definitionId: definition.id }
}

function placeInstance(
  system: Harness['system'],
  definitionId: string,
  name: string,
): CommandResult<CreateAssetInstanceInverse> {
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return system.dispatcher.dispatch(
    new CreateAssetInstanceCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      definitionId,
      name,
      position: { x: 0, y: 0 },
    }),
  )
}

function instanceContainer(root: FakeChild | undefined, name: string): FakeChild | undefined {
  return findByLabel(root ?? { children: [] }, name)
}

function placeholderOf(container: FakeChild | undefined): FakeChild | undefined {
  return container?.children[0]
}

function spriteOf(container: FakeChild | undefined): FakeChild | undefined {
  return placeholderOf(container)?.children.find((child) => child.kind === 'sprite')
}

function outlineOf(container: FakeChild | undefined): FakeChild | undefined {
  return placeholderOf(container)?.children.find((child) => child.kind === 'graphics')
}

function labelOf(container: FakeChild | undefined): FakeChild | undefined {
  return placeholderOf(container)?.children.find((child) => child.kind === 'text')
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('real textures in the renderer', () => {
  it('renders the definition image for an asset instance once the texture is loaded', async () => {
    textureLoads.set(ORIGINAL_URL, BOY_IMAGE)
    const { system, app, definitionId } = await setup()
    const root = findByLabel(worldOf(app), 'Root')

    placeInstance(system, definitionId, 'Boy')
    const sprite = spriteOf(instanceContainer(root, 'Boy'))
    if (!sprite) {
      throw new Error('Sprite not found')
    }
    expect(sprite.texture).not.toBe(BOY_IMAGE)

    await flushAsync()

    expect(sprite.texture).toBe(BOY_IMAGE)
    expect(sprite.width).toBe(512)
    expect(sprite.height).toBe(300)
    const placeholder = placeholderOf(instanceContainer(root, 'Boy'))
    if (!placeholder) {
      throw new Error('Placeholder group not found')
    }
    expect(outlineOf(instanceContainer(root, 'Boy'))?.visible).toBe(false)
    expect(labelOf(instanceContainer(root, 'Boy'))?.visible).toBe(false)
    expect(placeholder.label).toBe('placeholder:Boy')
  })

  it('shows the placeholder while the texture is still loading, then swaps it in', async () => {
    const pending = deferredTexture()
    textureDeferreds.set(ORIGINAL_URL, pending)
    const { system, app, definitionId } = await setup()
    const root = findByLabel(worldOf(app), 'Root')

    placeInstance(system, definitionId, 'Boy')
    const sprite = spriteOf(instanceContainer(root, 'Boy'))
    if (!sprite) {
      throw new Error('Sprite not found')
    }
    expect(sprite.width).toBe(160)
    expect(labelOf(instanceContainer(root, 'Boy'))?.visible).toBe(true)

    pending.resolve(BOY_IMAGE)
    await flushAsync()

    expect(sprite.texture).toBe(BOY_IMAGE)
    expect(labelOf(instanceContainer(root, 'Boy'))?.visible).toBe(false)
  })

  it('shares one cached texture between instances of the same definition', async () => {
    textureLoads.set(ORIGINAL_URL, BOY_IMAGE)
    const { system, app, definitionId } = await setup()
    const root = findByLabel(worldOf(app), 'Root')

    placeInstance(system, definitionId, 'Boy')
    placeInstance(system, definitionId, 'Boy')
    await flushAsync()

    expect(assetLoadCalls).toHaveLength(1)
    expect(assetLoadCalls[0]).toBe(ORIGINAL_URL)
    const first = spriteOf(instanceContainer(root, 'Boy'))
    const second = spriteOf(instanceContainer(root, 'Boy (2)'))
    expect(first?.texture).toBe(BOY_IMAGE)
    expect(second?.texture).toBe(BOY_IMAGE)
  })

  it('falls back to the placeholder look and logs an error when the texture load fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    textureFailures.set(ORIGINAL_URL, new Error('boom'))
    const { system, app, definitionId } = await setup()
    const root = findByLabel(worldOf(app), 'Root')

    const placed = placeInstance(system, definitionId, 'Boy')
    if (!placed.ok || !placed.inverse) {
      throw new Error('Node was not created')
    }
    await flushAsync()

    const container = instanceContainer(root, 'Boy')
    if (!container) {
      throw new Error('Container not found')
    }
    expect(spriteOf(container)?.width).toBe(160)
    expect(outlineOf(container)?.visible).toBe(true)
    expect(labelOf(container)?.visible).toBe(true)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toContain(ORIGINAL_URL)

    const moveResult = system.dispatcher.dispatch(
      new MoveNodeCommand({ nodeId: placed.inverse.nodeId, x: 120, y: 80 }),
    )
    expect(moveResult.ok).toBe(true)
    expect(container.position.x).toBe(120)
    expect(container.position.y).toBe(80)
    consoleError.mockRestore()
  })

  it('keeps the placeholder look without loading when the definition has no url', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { system, app } = await setup()
    const orphan = system.engine.defineAsset('Orphan')
    const root = findByLabel(worldOf(app), 'Root')

    placeInstance(system, orphan.id, 'Orphan')
    await flushAsync()

    const container = instanceContainer(root, 'Orphan')
    expect(spriteOf(container)?.width).toBe(160)
    expect(labelOf(container)?.visible).toBe(true)
    expect(assetLoadCalls).toHaveLength(0)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('ignores a texture that finishes loading after its node was removed', async () => {
    const pending = deferredTexture()
    textureDeferreds.set(ORIGINAL_URL, pending)
    const { system, app, definitionId } = await setup()
    const root = findByLabel(worldOf(app), 'Root')

    const placed = placeInstance(system, definitionId, 'Boy')
    if (!placed.ok || !placed.inverse) {
      throw new Error('Node was not created')
    }
    const container = instanceContainer(root, 'Boy')
    if (!container) {
      throw new Error('Container not found')
    }
    const removed = system.dispatcher.dispatch(
      new DeleteNodeCommand({ nodeId: placed.inverse.nodeId }),
    )
    expect(removed.ok).toBe(true)
    expect(container.destroyed).toBe(true)

    pending.resolve(BOY_IMAGE)
    await flushAsync()

    expect(findByLabel(root ?? { children: [] }, 'Boy')).toBeUndefined()
    const latecomer = placeInstance(system, definitionId, 'Boy')
    if (!latecomer.ok) {
      throw new Error('Late placement failed')
    }
    await flushAsync()
    expect(spriteOf(instanceContainer(root, 'Boy'))?.texture).toBe(BOY_IMAGE)
  })
})
