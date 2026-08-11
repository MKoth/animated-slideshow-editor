import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import { Renderer } from '../../pixi/renderer/renderer'
import { worldOf } from './testUtils'
import { pixiRegistry } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

interface CameraControlsHarness {
  system: ReturnType<typeof createCommandSystem>
  host: HTMLDivElement
  renderer: Renderer
  app: (typeof pixiRegistry.applications)[number]
  canvas: HTMLCanvasElement
  cameraId: string
  log: ReturnType<typeof vi.fn>
}

async function mountWithControls(): Promise<CameraControlsHarness> {
  const log = vi.fn()
  const system = createCommandSystem(log)
  const host = document.createElement('div')
  const renderer = new Renderer(host, system.engine, (command) =>
    system.dispatcher.dispatch(command),
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
  return { system, host, renderer, app, canvas, cameraId: camera.id, log }
}

function wheelAt(canvas: HTMLCanvasElement, x: number, y: number, deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', {
    clientX: x,
    clientY: y,
    deltaY,
    bubbles: true,
    cancelable: true,
  })
  canvas.dispatchEvent(event)
  return event
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

function optionDrag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]): void {
  canvas.dispatchEvent(
    new MouseEvent('mousedown', {
      button: 0,
      altKey: true,
      clientX: from[0],
      clientY: from[1],
      bubbles: true,
      cancelable: true,
    }),
  )
  window.dispatchEvent(
    new MouseEvent('mousemove', {
      button: 0,
      altKey: true,
      clientX: to[0],
      clientY: to[1],
      bubbles: true,
    }),
  )
  window.dispatchEvent(
    new MouseEvent('mouseup', {
      button: 0,
      altKey: true,
      clientX: to[0],
      clientY: to[1],
      bubbles: true,
    }),
  )
}

function transformOf(system: CameraControlsHarness['system'], cameraId: string) {
  return system.engine.getNode(cameraId).transform
}

describe('wheel zoom', () => {
  it('zooms in toward the cursor, keeping the world point under the cursor fixed', async () => {
    const { system, canvas, cameraId } = await mountWithControls()
    const cursorX = 400
    const cursorY = 300

    wheelAt(canvas, cursorX, cursorY, -100)

    const expectedZoom = Math.exp(0.1)
    const transform = transformOf(system, cameraId)
    expect(transform.scaleX).toBeCloseTo(expectedZoom)
    expect(transform.scaleY).toBeCloseTo(expectedZoom)
    expect(transform.x).toBeCloseTo(cursorX - cursorX / expectedZoom)
    expect(transform.y).toBeCloseTo(cursorY - cursorY / expectedZoom)
  })

  it('zooms out toward the cursor when scrolling down', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, 100)

    const expectedZoom = Math.exp(-0.1)
    const transform = transformOf(system, cameraId)
    expect(transform.scaleX).toBeCloseTo(expectedZoom)
    expect(transform.x).toBeCloseTo(400 - 400 / expectedZoom)
    expect(transform.y).toBeCloseTo(300 - 300 / expectedZoom)
  })

  it('keeps the world point under the cursor fixed across repeated zooms at different positions', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, -100)
    let transform = transformOf(system, cameraId)
    const firstWorldX = 400
    const firstWorldY = 300
    expect((firstWorldX - transform.x) * transform.scaleX).toBeCloseTo(400)
    expect((firstWorldY - transform.y) * transform.scaleY).toBeCloseTo(300)

    const secondCursorX = 100
    const secondCursorY = 500
    const secondWorldX = transform.x + secondCursorX / transform.scaleX
    const secondWorldY = transform.y + secondCursorY / transform.scaleY
    wheelAt(canvas, secondCursorX, secondCursorY, 100)
    transform = transformOf(system, cameraId)
    expect((secondWorldX - transform.x) * transform.scaleX).toBeCloseTo(secondCursorX)
    expect((secondWorldY - transform.y) * transform.scaleY).toBeCloseTo(secondCursorY)
  })

  it('dispatches MoveNode and ScaleNode commands against the camera node, recording history and log lines', async () => {
    const { system, canvas, cameraId, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length

    wheelAt(canvas, 400, 300, -100)

    expect(system.undoStack.entries).toHaveLength(undoCount + 2)
    expect(system.undoStack.entries[0]).toMatchObject({ type: 'ScaleNode' })
    expect(system.undoStack.entries[1]).toMatchObject({ type: 'MoveNode' })
    const scaleEntry = system.undoStack.entries[0].parameters
    expect(scaleEntry).toMatchObject({ nodeId: cameraId })
    expect(scaleEntry.scaleX).toBeCloseTo(Math.exp(0.1))
    expect(system.undoStack.entries[1].parameters).toMatchObject({
      nodeId: cameraId,
      x: expect.any(Number),
      y: expect.any(Number),
    })
    expect(log).toHaveBeenCalledTimes(undoCount + 2)
    expect(log.mock.calls.at(-2)?.[0]).toMatch(/^MoveNode nodeId=.+ x=.+ y=.+$/)
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^ScaleNode nodeId=.+ scaleX=.+ scaleY=.+$/)
  })

  it('prevents the page from scrolling while zooming', async () => {
    const { canvas } = await mountWithControls()

    const event = wheelAt(canvas, 100, 100, -100)

    expect(event.defaultPrevented).toBe(true)
  })

  it('clamps the zoom to a minimum without producing non-finite camera values', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, 10_000_000)

    const transform = transformOf(system, cameraId)
    expect(transform.scaleX).toBe(0.01)
    expect(transform.scaleY).toBe(0.01)
    expect(Number.isFinite(transform.x)).toBe(true)
    expect(Number.isFinite(transform.y)).toBe(true)
  })

  it('clamps the zoom to a maximum', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, -10_000_000)

    expect(transformOf(system, cameraId).scaleX).toBe(100)
  })

  it('does nothing when no project exists yet', async () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    const host = document.createElement('div')
    const renderer = new Renderer(host, system.engine, (command) =>
      system.dispatcher.dispatch(command),
    )
    await renderer.start()
    const canvas = host.querySelector('canvas')
    if (!canvas) {
      throw new Error('Canvas not found')
    }

    wheelAt(canvas, 100, 100, -100)

    expect(system.undoStack.entries).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('middle-button pan', () => {
  it('pans the camera by the drag delta divided by the current zoom', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    middleDrag(canvas, [300, 200], [350, 220])

    const transform = transformOf(system, cameraId)
    expect(transform.x).toBeCloseTo(-50)
    expect(transform.y).toBeCloseTo(-20)
    expect(system.undoStack.entries[0]).toMatchObject({ type: 'MoveNode' })
  })

  it('accumulates movement across a continuous drag, one command per move', async () => {
    const { system, canvas, cameraId } = await mountWithControls()
    const undoCount = system.undoStack.entries.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 370, clientY: 225, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: 370, clientY: 225 }))

    const transform = transformOf(system, cameraId)
    expect(transform.x).toBeCloseTo(-70)
    expect(transform.y).toBeCloseTo(-25)
    expect(system.undoStack.entries).toHaveLength(undoCount + 2)
    expect(system.undoStack.entries.slice(0, 2).map((entry) => entry.type)).toEqual([
      'MoveNode',
      'MoveNode',
    ])
  })

  it('pans in zoomed coordinates', async () => {
    const { system, canvas, cameraId } = await mountWithControls()
    wheelAt(canvas, 400, 300, -100)
    const zoomed = transformOf(system, cameraId).scaleX
    const zoomedX = transformOf(system, cameraId).x
    const zoomedY = transformOf(system, cameraId).y

    middleDrag(canvas, [100, 100], [120, 110])

    const transform = transformOf(system, cameraId)
    expect(transform.x).toBeCloseTo(zoomedX - 20 / zoomed)
    expect(transform.y).toBeCloseTo(zoomedY - 10 / zoomed)
  })

  it('calls preventDefault on the middle-button mousedown so autoscroll never triggers', async () => {
    const { canvas } = await mountWithControls()

    const event = new MouseEvent('mousedown', {
      button: 1,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    })
    canvas.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores plain left-button drags without the option key', async () => {
    const { system, canvas, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 0, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
  })

  it('pans on option+left drag, preventing the default mousedown behaviour', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    const mousedown = new MouseEvent('mousedown', {
      button: 0,
      altKey: true,
      clientX: 300,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    })
    canvas.dispatchEvent(mousedown)
    window.dispatchEvent(
      new MouseEvent('mousemove', { button: 0, altKey: true, clientX: 350, clientY: 220 }),
    )
    window.dispatchEvent(
      new MouseEvent('mouseup', { button: 0, altKey: true, clientX: 350, clientY: 220 }),
    )

    expect(mousedown.defaultPrevented).toBe(true)
    const transform = transformOf(system, cameraId)
    expect(transform.x).toBeCloseTo(-50)
    expect(transform.y).toBeCloseTo(-20)
    expect(system.undoStack.entries[0]).toMatchObject({ type: 'MoveNode' })
  })

  it('accumulates movement across an option+left drag, one command per move', async () => {
    const { system, canvas, cameraId } = await mountWithControls()
    const undoCount = system.undoStack.entries.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        altKey: true,
        clientX: 300,
        clientY: 200,
        bubbles: true,
      }),
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { button: 0, altKey: true, clientX: 350, clientY: 220 }),
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { button: 0, altKey: true, clientX: 370, clientY: 225 }),
    )
    window.dispatchEvent(
      new MouseEvent('mouseup', { button: 0, altKey: true, clientX: 370, clientY: 225 }),
    )

    const transform = transformOf(system, cameraId)
    expect(transform.x).toBeCloseTo(-70)
    expect(transform.y).toBeCloseTo(-25)
    expect(system.undoStack.entries).toHaveLength(undoCount + 2)
    expect(system.undoStack.entries.slice(0, 2).map((entry) => entry.type)).toEqual([
      'MoveNode',
      'MoveNode',
    ])
  })

  it('pans in zoomed coordinates with option+left drag', async () => {
    const { system, canvas, cameraId } = await mountWithControls()
    wheelAt(canvas, 400, 300, -100)
    const zoomed = transformOf(system, cameraId).scaleX
    const zoomedX = transformOf(system, cameraId).x
    const zoomedY = transformOf(system, cameraId).y

    optionDrag(canvas, [100, 100], [120, 110])

    const transform = transformOf(system, cameraId)
    expect(transform.x).toBeCloseTo(zoomedX - 20 / zoomed)
    expect(transform.y).toBeCloseTo(zoomedY - 10 / zoomed)
  })

  it('stops panning on mouseup; later moves dispatch nothing', async () => {
    const { system, canvas, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: 300, clientY: 200 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
  })
})

describe('double-click reset', () => {
  it('resets the camera to identity through MoveNode and ScaleNode commands', async () => {
    const { system, canvas, cameraId, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    middleDrag(canvas, [300, 200], [400, 300])
    wheelAt(canvas, 200, 150, -100)

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(transformOf(system, cameraId)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(system.undoStack.entries).toHaveLength(undoCount + 5)
    expect(system.undoStack.entries[0]).toMatchObject({ type: 'ScaleNode' })
    expect(system.undoStack.entries[1]).toMatchObject({ type: 'MoveNode' })
    expect(system.undoStack.entries[0].parameters).toEqual({
      nodeId: cameraId,
      scaleX: 1,
      scaleY: 1,
    })
    expect(system.undoStack.entries[1].parameters).toEqual({ nodeId: cameraId, x: 0, y: 0 })
    expect(log.mock.calls.at(-2)?.[0]).toMatch(/^MoveNode nodeId=.+ x=0 y=0$/)
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^ScaleNode nodeId=.+ scaleX=1 scaleY=1$/)
  })
})

describe('camera integrity', () => {
  it('never modifies the camera rotation across pan, zoom and reset', async () => {
    const { system, canvas, cameraId } = await mountWithControls()

    middleDrag(canvas, [100, 100], [200, 150])
    wheelAt(canvas, 300, 200, -100)
    wheelAt(canvas, 300, 200, 100)
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(transformOf(system, cameraId).rotation).toBe(0)
    expect(system.undoStack.entries.some((entry) => entry.type === 'RotateNode')).toBe(false)
  })

  it('mirrors pan and zoom onto the world container on the next tick', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, -100)
    middleDrag(canvas, [100, 100], [140, 120])
    app.ticker.tick()

    const world = worldOf(app)
    const transform = transformOf(system, cameraId)
    expect(world.scale.x).toBeCloseTo(transform.scaleX)
    expect(world.scale.y).toBeCloseTo(transform.scaleY)
    expect(world.position.x).toBeCloseTo(-transform.x * transform.scaleX)
    expect(world.position.y).toBeCloseTo(-transform.y * transform.scaleY)
    expect(world.rotation).toBe(0)
  })
})

describe('lifecycle', () => {
  it('detaches all listeners on dispose; events do nothing afterwards', async () => {
    const { system, renderer, canvas, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length

    renderer.dispose()
    wheelAt(canvas, 100, 100, -100)
    middleDrag(canvas, [100, 100], [200, 200])

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
  })
})
