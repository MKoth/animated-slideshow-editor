import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneNode } from '../engine'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  MoveNodeCommand,
  ScaleNodeCommand,
} from '../engine/commands'
import { createEngine } from '../engine/internal'
import { ASSET_DEFINITION_MIME } from '../pixi/renderer/dropPlacement'
import { Renderer } from '../pixi/renderer/renderer'
import { pixiRegistry } from './renderer/pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

interface DropHarness {
  engine: ReturnType<typeof createEngine>
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  renderer: Renderer
  canvas: HTMLCanvasElement
  log: ReturnType<typeof vi.fn>
}

async function mount(): Promise<DropHarness> {
  const log = vi.fn()
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  const host = document.createElement('div')
  const renderer = new Renderer(host, engine, (command) => dispatcher.dispatch(command))
  await renderer.start()
  dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
  const canvas = host.querySelector('canvas')
  if (!canvas) {
    throw new Error('Canvas not found')
  }
  return { engine, dispatcher, undoStack, renderer, canvas, log }
}

function dragOver(canvas: HTMLCanvasElement, dataTransfer: DataTransfer): DragEvent {
  const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
  canvas.dispatchEvent(event)
  return event
}

function dropAt(
  canvas: HTMLCanvasElement,
  dataTransfer: DataTransfer,
  clientX: number,
  clientY: number,
): DragEvent {
  const event = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    clientX,
    clientY,
  })
  canvas.dispatchEvent(event)
  return event
}

function assetDrag(definitionId: string): DataTransfer {
  const dataTransfer = new DataTransfer()
  dataTransfer.setData(ASSET_DEFINITION_MIME, definitionId)
  return dataTransfer
}

function sceneChildren(engine: DropHarness['engine']): SceneNode[] {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('No slide found')
  }
  return slide.scene.root.children.filter((child) => !child.components.camera)
}

describe('drop placement', () => {
  it('creates an instance at the exact world position under the cursor, one command per drop', async () => {
    const { engine, undoStack, canvas, log } = await mount()
    const definition = engine.defineAsset('Boy')
    const undoCount = undoStack.entries.length

    const event = dropAt(canvas, assetDrag(definition.id), 300, 200)

    expect(event.defaultPrevented).toBe(true)
    expect(undoStack.entries).toHaveLength(undoCount + 1)
    expect(undoStack.entries[0]).toMatchObject({ type: 'CreateAssetInstance' })
    expect(log).toHaveBeenCalledTimes(undoCount + 1)
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^CreateAssetInstance /)
    const children = sceneChildren(engine)
    expect(children).toHaveLength(1)
    expect(children[0].name).toBe('Boy')
    expect(children[0].transform).toEqual({ x: 300, y: 200, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('lands at the world position under the cursor after the camera has been panned and zoomed', async () => {
    const { engine, dispatcher, canvas } = await mount()
    const definition = engine.defineAsset('Boy')
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('No camera found')
    }
    dispatcher.dispatch(new MoveNodeCommand({ nodeId: camera.id, x: 120, y: 40 }))
    dispatcher.dispatch(new ScaleNodeCommand({ nodeId: camera.id, scaleX: 2, scaleY: 2 }))

    dropAt(canvas, assetDrag(definition.id), 300, 200)

    const children = sceneChildren(engine)
    expect(children).toHaveLength(1)
    expect(children[0].transform).toEqual({ x: 270, y: 140, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('places the instance under the slide root and leaves the definition untouched', async () => {
    const { engine, canvas } = await mount()
    const definition = engine.defineAsset('Boy')

    dropAt(canvas, assetDrag(definition.id), 10, 10)

    const children = sceneChildren(engine)
    const node = children[0]
    expect(node.id).not.toBe(definition.id)
    expect(engine.assetDefinitions).toHaveLength(1)
    expect(engine.assetDefinitions[0]).toEqual({ id: definition.id, name: 'Boy' })
  })

  it('auto-suffixes the name when the base name is already taken on the slide', async () => {
    const { engine, canvas } = await mount()
    const definition = engine.defineAsset('Boy')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('No slide found')
    }
    const first = engine.createAssetInstance(
      slide.scene.id,
      slide.scene.root.id,
      definition.id,
      'Boy',
    )
    expect(first.name).toBe('Boy')

    dropAt(canvas, assetDrag(definition.id), 50, 50)

    const children = sceneChildren(engine)
    expect(children.map((child) => child.name)).toEqual(['Boy', 'Boy (2)'])
  })

  it('rejects a drop outside the canvas with no state change', async () => {
    const { engine, undoStack } = await mount()
    const definition = engine.defineAsset('Boy')
    const undoCount = undoStack.entries.length

    document.body.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: assetDrag(definition.id),
      }),
    )

    expect(undoStack.entries).toHaveLength(undoCount)
    expect(sceneChildren(engine)).toHaveLength(0)
  })

  it('rejects a drop carrying no asset data with no state change', async () => {
    const { engine, undoStack, canvas } = await mount()
    const undoCount = undoStack.entries.length

    dropAt(canvas, new DataTransfer(), 100, 100)

    expect(undoStack.entries).toHaveLength(undoCount)
    expect(sceneChildren(engine)).toHaveLength(0)
  })

  it('rejects a drop with an unknown definition id with no state change', async () => {
    const { engine, undoStack, canvas } = await mount()
    const undoCount = undoStack.entries.length

    dropAt(canvas, assetDrag('ghost'), 100, 100)

    expect(undoStack.entries).toHaveLength(undoCount)
    expect(sceneChildren(engine)).toHaveLength(0)
  })

  it('rejects a drop when no project or slide exists', async () => {
    const log = vi.fn()
    const engine = createEngine()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, log)
    const host = document.createElement('div')
    const renderer = new Renderer(host, engine, (command) => dispatcher.dispatch(command))
    await renderer.start()
    const definition = engine.defineAsset('Boy')
    const canvas = host.querySelector('canvas')
    if (!canvas) {
      throw new Error('Canvas not found')
    }

    dropAt(canvas, assetDrag(definition.id), 100, 100)

    expect(undoStack.entries).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('accepts an asset drag on dragover and rejects non-asset drags', async () => {
    const { canvas } = await mount()

    const asset = dragOver(canvas, assetDrag('any-id'))
    expect(asset.defaultPrevented).toBe(true)
    expect(asset.dataTransfer?.dropEffect).toBe('copy')

    const foreign = dragOver(canvas, new DataTransfer())
    expect(foreign.defaultPrevented).toBe(false)
  })

  it('detaches all listeners on dispose; drops do nothing afterwards', async () => {
    const { engine, undoStack, renderer, canvas } = await mount()
    const definition = engine.defineAsset('Boy')
    const undoCount = undoStack.entries.length

    renderer.dispose()
    dropAt(canvas, assetDrag(definition.id), 100, 100)

    expect(undoStack.entries).toHaveLength(undoCount)
  })
})
