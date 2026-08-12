import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import type { DispatchCommand } from '../engine/commands'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { ResolveAssetUrl } from '../pixi/renderer/textureCache'
import { Renderer } from '../pixi/renderer/renderer'
import { useSelectionStore } from '../stores/selectionStore'
import {
  FakeTexture,
  deferredTexture,
  pixiRegistry,
  resetTextureRegistries,
  textureDeferreds,
} from './renderer/pixiFake'
import type { FakeGraphics } from './renderer/pixiFake'
import type { FakeChild } from './renderer/testUtils'
import { worldOf } from './renderer/testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
  resetTextureRegistries()
  useSelectionStore.setState({ selectedIds: [] })
})

interface Harness {
  engine: Engine
  canvas: HTMLCanvasElement
  app: (typeof pixiRegistry.applications)[number]
}

async function mount(resolveAssetUrl?: ResolveAssetUrl): Promise<Harness> {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const host = document.createElement('div')
  const dispatcher = new CommandDispatcher(engine, new UndoStack(), vi.fn())
  const dispatch: DispatchCommand = (command) => dispatcher.dispatch(command)
  const renderer = new Renderer(host, engine, dispatch, undefined, resolveAssetUrl)
  await renderer.start()
  const app = pixiRegistry.applications[0]
  if (!app) {
    throw new Error('No pixi application was created')
  }
  return { engine, canvas: app.canvas, app }
}

function nodeAt(engine: Engine, name: string, x = 0, y = 0): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  }).id
}

function overlayGraphics(app: Harness['app']): FakeChild | undefined {
  const world = worldOf(app)
  return [...world.children]
    .reverse()
    .find(
      (child) => child.kind === 'graphics' && child.label !== 'grid' && child.label !== 'guides',
    )
}

function overlayRects(app: Harness['app']): { x: number; y: number; w: number; h: number }[] {
  const graphics = overlayGraphics(app) as FakeGraphics | undefined
  const ops = graphics?.ops ?? []
  const rects: { x: number; y: number; w: number; h: number }[] = []
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index] === 'rect') {
      const call = graphics?.calls[index]
      rects.push({
        x: Number(call?.args[0]),
        y: Number(call?.args[1]),
        w: Number(call?.args[2]),
        h: Number(call?.args[3]),
      })
    }
  }
  return rects
}

function click(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }),
  )
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }))
}

function mouseDown(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }),
  )
}

function mouseMove(x: number, y: number): void {
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
}

function mouseUp(x: number, y: number): void {
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }))
}

describe('renderer selection wiring', () => {
  it('selects a placed node on click and draws its outline and handles', async () => {
    const { engine, canvas, app } = await mount()
    const id = nodeAt(engine, 'Hero', 300, 200)

    click(canvas, 300, 200)

    expect(useSelectionStore.getState().selectedIds).toEqual([id])
    const graphics = overlayGraphics(app)
    expect(graphics?.ops?.filter((op) => op === 'rect')).toHaveLength(9)
  })

  it('clears the selection and the overlay when clicking empty canvas', async () => {
    const { engine, canvas, app } = await mount()
    const id = nodeAt(engine, 'Hero', 300, 200)
    click(canvas, 300, 200)
    expect(useSelectionStore.getState().selectedIds).toEqual([id])

    click(canvas, 40, 40)

    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(overlayGraphics(app)?.ops?.filter((op) => op === 'rect')).toHaveLength(0)
  })

  it('clears the selection and keeps the overlay on top when the bound scene changes', async () => {
    const { engine, app } = await mount()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const first = nodeAt(engine, 'Hero', 300, 200)
    click(app.canvas, 300, 200)
    expect(useSelectionStore.getState().selectedIds).toEqual([first])

    engine.createSlide('Slide 2')
    engine.removeSlide(slide.id)

    expect(useSelectionStore.getState().selectedIds).toEqual([])
    const world = worldOf(app)
    const overlay = world.children.at(-1)
    expect(overlay?.kind).toBe('graphics')
  })

  it('deselects removed nodes while keeping the rest of the selection', async () => {
    const { engine, app } = await mount()
    const first = nodeAt(engine, 'First', 100, 100)
    const second = nodeAt(engine, 'Second', 400, 100)
    useSelectionStore.getState().selectMany([first, second])
    expect(useSelectionStore.getState().selectedIds).toHaveLength(2)

    engine.removeNode(first)

    expect(useSelectionStore.getState().selectedIds).toEqual([second])
    expect(overlayGraphics(app)).toBeDefined()
  })

  it('redraws the outline at the real texture bounds once the asset texture resolves', async () => {
    const { engine, canvas, app } = await mount((definitionId) =>
      definitionId === 'def-1' ? '/api/assets/originals/def-1.png' : null,
    )
    engine.registerAssetDefinition('def-1', 'Boy')
    const deferred = deferredTexture()
    textureDeferreds.set('/api/assets/originals/def-1.png', deferred)
    const id = nodeAt(engine, 'Hero', 300, 200)
    click(canvas, 300, 200)
    expect(overlayRects(app)[0]).toEqual({ x: 220, y: 150, w: 160, h: 100 })

    void deferred.resolve(new FakeTexture('boy.png', { width: 512, height: 300 }))

    await deferred.promise
    await vi.waitFor(() => {
      expect(overlayRects(app)[0]).toEqual({ x: 44, y: 50, w: 512, h: 300 })
    })
    expect(useSelectionStore.getState().selectedIds).toEqual([id])
  })

  it('follows the selected node while it is being dragged', async () => {
    const { engine, canvas, app } = await mount()
    const id = nodeAt(engine, 'Hero', 300, 200)
    mouseDown(canvas, 300, 200)

    mouseMove(330, 200)
    expect(overlayRects(app)[0]).toEqual({ x: 250, y: 150, w: 160, h: 100 })

    mouseMove(380, 200)
    expect(overlayRects(app)[0]).toEqual({ x: 300, y: 150, w: 160, h: 100 })

    mouseUp(380, 200)
    expect(overlayRects(app)[0]).toEqual({ x: 300, y: 150, w: 160, h: 100 })
    expect(useSelectionStore.getState().selectedIds).toEqual([id])
  })
})
