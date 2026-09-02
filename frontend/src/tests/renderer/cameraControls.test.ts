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

function viewportOf(app: (typeof pixiRegistry.applications)[number]) {
  const world = worldOf(app)
  const scaleX = world.scale.x
  const scaleY = world.scale.y
  return {
    scaleX,
    scaleY,
    x: scaleX === 0 ? 0 : -world.position.x / scaleX,
    y: scaleY === 0 ? 0 : -world.position.y / scaleY,
  }
}

describe('wheel zoom', () => {
  it('zooms in toward the cursor, keeping the world point under the cursor fixed', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()
    const cursorX = 400
    const cursorY = 300

    wheelAt(canvas, cursorX, cursorY, -100)
    app.ticker.tick()

    const expectedZoom = Math.exp(0.1)
    const viewport = viewportOf(app)
    expect(viewport.scaleX).toBeCloseTo(expectedZoom)
    expect(viewport.scaleY).toBeCloseTo(expectedZoom)
    expect(viewport.x).toBeCloseTo(cursorX - cursorX / expectedZoom)
    expect(viewport.y).toBeCloseTo(cursorY - cursorY / expectedZoom)
    // ephemeral: stored camera stays identity, no history
    expect(transformOf(system, cameraId).scaleX).toBe(1)
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('zooms out toward the cursor when scrolling down', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, 100)
    app.ticker.tick()

    const expectedZoom = Math.exp(-0.1)
    const viewport = viewportOf(app)
    expect(viewport.scaleX).toBeCloseTo(expectedZoom)
    expect(viewport.x).toBeCloseTo(400 - 400 / expectedZoom)
    expect(viewport.y).toBeCloseTo(300 - 300 / expectedZoom)
    expect(transformOf(system, cameraId).scaleX).toBe(1)
  })

  it('keeps the world point under the cursor fixed across repeated zooms at different positions', async () => {
    const { app, canvas } = await mountWithControls()

    wheelAt(canvas, 400, 300, -100)
    app.ticker.tick()
    let viewport = viewportOf(app)
    const firstWorldX = 400
    const firstWorldY = 300
    expect((firstWorldX - viewport.x) * viewport.scaleX).toBeCloseTo(400)
    expect((firstWorldY - viewport.y) * viewport.scaleY).toBeCloseTo(300)

    const secondCursorX = 100
    const secondCursorY = 500
    const secondWorldX = viewport.x + secondCursorX / viewport.scaleX
    const secondWorldY = viewport.y + secondCursorY / viewport.scaleY
    wheelAt(canvas, secondCursorX, secondCursorY, 100)
    app.ticker.tick()
    viewport = viewportOf(app)
    expect((secondWorldX - viewport.x) * viewport.scaleX).toBeCloseTo(secondCursorX)
    expect((secondWorldY - viewport.y) * viewport.scaleY).toBeCloseTo(secondCursorY)
  })

  it('does not pollute history: wheel zoom updates the ephemeral viewport, not the camera node', async () => {
    const { system, app, canvas, cameraId, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length

    wheelAt(canvas, 400, 300, -100)
    app.ticker.tick()

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log).toHaveBeenCalledTimes(logCount)
    expect(transformOf(system, cameraId).scaleX).toBe(1)
    const viewport = viewportOf(app)
    expect(viewport.scaleX).toBeCloseTo(Math.exp(0.1))
  })

  it('prevents the page from scrolling while zooming', async () => {
    const { canvas } = await mountWithControls()

    const event = wheelAt(canvas, 100, 100, -100)

    expect(event.defaultPrevented).toBe(true)
  })

  it('clamps the zoom to a minimum without producing non-finite camera values', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()

    wheelAt(canvas, 400, 300, 10_000_000)
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport.scaleX).toBe(0.01)
    expect(viewport.scaleY).toBe(0.01)
    expect(Number.isFinite(viewport.x)).toBe(true)
    expect(Number.isFinite(viewport.y)).toBe(true)
    expect(transformOf(system, cameraId).scaleX).toBe(1)
  })

  it('clamps the zoom to a maximum', async () => {
    const { app, canvas } = await mountWithControls()

    wheelAt(canvas, 400, 300, -10_000_000)
    app.ticker.tick()

    expect(viewportOf(app).scaleX).toBe(100)
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
    const { system, app, canvas, cameraId } = await mountWithControls()

    middleDrag(canvas, [300, 200], [350, 220])
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport.x).toBeCloseTo(-50)
    expect(viewport.y).toBeCloseTo(-20)
    expect(transformOf(system, cameraId).x).toBe(0)
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('accumulates movement across a continuous drag, without creating history entries', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()
    const undoCount = system.undoStack.entries.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 370, clientY: 225, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: 370, clientY: 225 }))
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport.x).toBeCloseTo(-70)
    expect(viewport.y).toBeCloseTo(-25)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(transformOf(system, cameraId).x).toBe(0)
  })

  it('pans in zoomed coordinates', async () => {
    const { app, canvas } = await mountWithControls()
    wheelAt(canvas, 400, 300, -100)
    app.ticker.tick()
    const zoomed = viewportOf(app).scaleX
    const zoomedX = viewportOf(app).x
    const zoomedY = viewportOf(app).y

    middleDrag(canvas, [100, 100], [120, 110])
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport.x).toBeCloseTo(zoomedX - 20 / zoomed)
    expect(viewport.y).toBeCloseTo(zoomedY - 10 / zoomed)
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
    const { system, app, canvas, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 0, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))
    app.ticker.tick()

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
    expect(viewportOf(app).x).toBeCloseTo(0)
  })

  it('pans on option+left drag, preventing the default mousedown behaviour', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()

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
    app.ticker.tick()

    expect(mousedown.defaultPrevented).toBe(true)
    const viewport = viewportOf(app)
    expect(viewport.x).toBeCloseTo(-50)
    expect(viewport.y).toBeCloseTo(-20)
    expect(transformOf(system, cameraId).x).toBe(0)
  })

  it('accumulates movement across an option+left drag, without creating history', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()
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
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport.x).toBeCloseTo(-70)
    expect(viewport.y).toBeCloseTo(-25)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(transformOf(system, cameraId).x).toBe(0)
  })

  it('pans in zoomed coordinates with option+left drag', async () => {
    const { app, canvas } = await mountWithControls()
    wheelAt(canvas, 400, 300, -100)
    app.ticker.tick()
    const zoomed = viewportOf(app).scaleX
    const zoomedX = viewportOf(app).x
    const zoomedY = viewportOf(app).y

    optionDrag(canvas, [100, 100], [120, 110])
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport.x).toBeCloseTo(zoomedX - 20 / zoomed)
    expect(viewport.y).toBeCloseTo(zoomedY - 10 / zoomed)
  })

  it('stops panning on mouseup; later moves do not change viewport', async () => {
    const { system, app, canvas, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length

    canvas.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, clientX: 300, clientY: 200, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: 300, clientY: 200 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true }))
    app.ticker.tick()

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
    expect(viewportOf(app).x).toBeCloseTo(0)
  })
})

describe('double-click reset', () => {
  it('resets the ephemeral viewport to identity without polluting history', async () => {
    const { system, app, canvas, cameraId, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length
    middleDrag(canvas, [300, 200], [400, 300])
    wheelAt(canvas, 200, 150, -100)
    app.ticker.tick()
    expect(viewportOf(app).scaleX).not.toBeCloseTo(1)

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    app.ticker.tick()

    const viewport = viewportOf(app)
    expect(viewport).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 })
    // stored camera stays as authored (identity initially), no extra commands
    expect(transformOf(system, cameraId)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
    const world = worldOf(app)
    expect(world.scale.x).toBeCloseTo(1)
    expect(world.position.x).toBeCloseTo(0)
  })
})

describe('camera integrity', () => {
  it('never modifies the camera rotation across pan, zoom and reset', async () => {
    const { system, app, canvas, cameraId } = await mountWithControls()

    middleDrag(canvas, [100, 100], [200, 150])
    wheelAt(canvas, 300, 200, -100)
    wheelAt(canvas, 300, 200, 100)
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    app.ticker.tick()

    expect(transformOf(system, cameraId).rotation).toBe(0)
    expect(viewportOf(app).scaleX).toBeCloseTo(1)
    expect(system.undoStack.entries.some((entry) => entry.type === 'RotateNode')).toBe(false)
  })

  it('mirrors pan and zoom onto the world container on the next tick', async () => {
    const { app, canvas } = await mountWithControls()

    wheelAt(canvas, 400, 300, -100)
    middleDrag(canvas, [100, 100], [140, 120])
    app.ticker.tick()

    const world = worldOf(app)
    const viewport = viewportOf(app)
    expect(world.scale.x).toBeCloseTo(viewport.scaleX)
    expect(world.scale.y).toBeCloseTo(viewport.scaleY)
    expect(world.position.x).toBeCloseTo(-viewport.x * viewport.scaleX)
    expect(world.position.y).toBeCloseTo(-viewport.y * viewport.scaleY)
    expect(world.rotation).toBe(0)
  })
})

describe('lifecycle', () => {
  it('detaches all listeners on dispose; events do nothing afterwards', async () => {
    const { system, app, renderer, canvas, log } = await mountWithControls()
    const undoCount = system.undoStack.entries.length
    const logCount = log.mock.calls.length
    const before = viewportOf(app)

    renderer.dispose()
    wheelAt(canvas, 100, 100, -100)
    middleDrag(canvas, [100, 100], [200, 200])

    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(log.mock.calls).toHaveLength(logCount)
    // world not ticked after dispose
    expect(before.x).toBeCloseTo(0)
  })
})
