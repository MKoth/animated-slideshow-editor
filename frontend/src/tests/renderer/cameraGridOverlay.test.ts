import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { Renderer } from '../../pixi/renderer/renderer'
import { findByLabel, mountRenderer, worldOf } from './testUtils'
import type { FakeApplication, FakeGraphics } from './pixiFake'
import { pixiRegistry } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

function seededEngine(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  engine.createNode(slide.scene.id, slide.scene.root.id, 'Hero', {
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  engine.createNode(slide.scene.id, slide.scene.root.id, 'Title', {
    components: { text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'center' } },
    transform: { x: 40, y: -30, rotation: 0.5, scaleX: 2, scaleY: 2 },
  })
  return engine
}

function gridOf(app: FakeApplication): FakeGraphics {
  const grid = findByLabel(worldOf(app), 'grid')
  if (!grid) {
    throw new Error('Grid graphics not found')
  }
  return grid as unknown as FakeGraphics
}

function sortedVerticalXsOf(grid: FakeGraphics): number[] {
  const xs: number[] = []
  let current: { x1?: number; x2?: number } | null = null
  for (const call of grid.calls) {
    if (call.method === 'moveTo') {
      current = { x1: call.args[0] as number }
    } else if (call.method === 'lineTo' && current) {
      current.x2 = call.args[0] as number
    } else if (call.method === 'stroke' && current) {
      if (current.x1 === current.x2) {
        xs.push(current.x1 as number)
      }
      current = null
    }
  }
  return [...new Set(xs)].sort((a, b) => a - b)
}

describe('camera mirror', () => {
  it('mirrors the camera node transform onto the world container (position = pan, scale = zoom)', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('Camera was not created')
    }

    expect(world.position.x).toBeCloseTo(0)
    expect(world.position.y).toBeCloseTo(0)
    expect(world.scale.x).toBe(1)
    expect(world.scale.y).toBe(1)

    engine.setTransform(camera.id, { x: 120, y: 60, rotation: 0, scaleX: 2, scaleY: 2 })
    app.ticker.tick()

    expect(world.position.x).toBe(-240)
    expect(world.position.y).toBe(-120)
    expect(world.scale.x).toBe(2)
    expect(world.scale.y).toBe(2)
  })

  it('keeps the world rotation at zero regardless of the camera transform', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('Camera was not created')
    }

    engine.setTransform(camera.id, { x: 5, y: -5, rotation: 0, scaleX: 3, scaleY: 3 })
    app.ticker.tick()

    expect(world.rotation).toBe(0)
  })

  it('stays at identity when no project or camera exists', async () => {
    const { app } = await mountRenderer(createEngine())
    const world = worldOf(app)
    app.ticker.tick()

    expect(world.position.x).toBeCloseTo(0)
    expect(world.position.y).toBeCloseTo(0)
    expect(world.scale.x).toBe(1)
    expect(world.scale.y).toBe(1)
  })

  it('follows camera changes through the ticker without engine events', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('Camera was not created')
    }

    engine.setTransform(camera.id, { x: 10, y: 20, rotation: 0, scaleX: 0.5, scaleY: 0.5 })

    expect(world.position.x).toBeCloseTo(0)

    app.ticker.tick()

    expect(world.position.x).toBe(-5)
    expect(world.position.y).toBe(-10)
    expect(world.scale.x).toBe(0.5)
  })
})

describe('world grid', () => {
  it('renders beneath all scene objects', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)

    expect(world.children[0].label).toBe('grid')
    expect(world.children.map((child) => child.label)).toEqual(
      expect.arrayContaining(['axis-lines', 'Root']),
    )
  })

  it('shifts its lines with the camera when panning', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('Camera was not created')
    }
    const grid = gridOf(app)

    engine.setTransform(camera.id, { x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1 })
    app.ticker.tick()

    const verticals = grid.calls.filter((call) => call.method === 'moveTo')
    expect(verticals.length).toBeGreaterThan(0)
    const firstVertical = verticals[0].args[0] as number
    expect(firstVertical).toBe(100)
  })

  it('redraws with a coarser world spacing when zooming out', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('Camera was not created')
    }
    const grid = gridOf(app)

    engine.setTransform(camera.id, { x: 0, y: 0, rotation: 0, scaleX: 0.5, scaleY: 0.5 })
    app.ticker.tick()

    const verticalXs = sortedVerticalXsOf(grid)
    expect(verticalXs[0]).toBe(0)
    expect(verticalXs[1]).toBe(50)
    expect(verticalXs[2]).toBe(100)
  })
})

describe('theme-adaptive grid colors', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
  })

  function strokeColorsOf(grid: FakeGraphics): number[] {
    return grid.calls
      .filter((call) => call.method === 'stroke')
      .map((call) => (call.args[0] as { color: number }).color)
  }

  async function mountWithGridColors(colors: Record<string, string>) {
    const host = document.createElement('div')
    for (const [name, value] of Object.entries(colors)) {
      host.style.setProperty(name, value)
    }
    const renderer = new Renderer(host, seededEngine())
    await renderer.start()
    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application was created')
    }
    return { host, renderer, app }
  }

  it('uses the grid colors and canvas background from the host stylesheet for the current theme', async () => {
    document.documentElement.dataset.theme = 'dark'
    const { app } = await mountWithGridColors({
      '--grid-minor': '#3f444d',
      '--grid-major': '#656d7a',
      '--canvas-background': '#17181b',
    })
    const colors = new Set(strokeColorsOf(gridOf(app)))

    expect(colors).toEqual(new Set([0x3f444d, 0x656d7a]))
    expect(app.renderer.background.color).toBe(0x17181b)
  })

  it('re-resolves colors when the theme changes at runtime', async () => {
    document.documentElement.dataset.theme = 'light'
    const { app } = await mountWithGridColors({
      '--grid-minor': '#c3c8cf',
      '--grid-major': '#8f96a0',
      '--canvas-background': '#f5f6f8',
    })
    const host = app.canvas.parentElement
    if (!host) {
      throw new Error('Canvas host not found')
    }
    expect(new Set(strokeColorsOf(gridOf(app)))).toEqual(new Set([0xc3c8cf, 0x8f96a0]))
    expect(app.renderer.background.color).toBe(0xf5f6f8)

    document.documentElement.dataset.theme = 'dark'
    host.style.setProperty('--grid-minor', '#3f444d')
    host.style.setProperty('--grid-major', '#656d7a')
    host.style.setProperty('--canvas-background', '#17181b')
    app.ticker.tick()

    expect(new Set(strokeColorsOf(gridOf(app)))).toEqual(new Set([0x3f444d, 0x656d7a]))
    expect(app.renderer.background.color).toBe(0x17181b)
  })

  it('falls back to default colors when no grid colors are defined', async () => {
    const { app } = await mountRenderer(seededEngine())
    const colors = new Set(strokeColorsOf(gridOf(app)))

    expect(colors).toEqual(new Set([0xe8e8e8, 0xc4c4c4]))
    expect(app.renderer.background.color).toBe(0xffffff)
  })
})

describe('dev overlay', () => {
  it('shows FPS, camera position, camera zoom and node count, updating continuously', async () => {
    const engine = seededEngine()
    const { host, app } = await mountRenderer(engine)
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) {
      throw new Error('Camera was not created')
    }

    const overlay = host.querySelector('.canvas-dev-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.textContent).toContain('FPS 60.0')
    expect(overlay?.textContent).toContain('Camera (0.00, 0.00)')
    expect(overlay?.textContent).toContain('Zoom 1.00')
    expect(overlay?.textContent).toContain('Nodes 4')

    app.ticker.FPS = 30
    engine.setTransform(camera.id, { x: 10.5, y: -20, rotation: 0, scaleX: 2, scaleY: 2 })
    app.ticker.tick()

    expect(overlay?.textContent).toContain('FPS 30.0')
    expect(overlay?.textContent).toContain('Camera (10.50, -20.00)')
    expect(overlay?.textContent).toContain('Zoom 2.00')
  })

  it('reports the node count including root and camera containers', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const { host } = await mountRenderer(engine)

    expect(host.querySelector('.canvas-dev-overlay')?.textContent).toContain('Nodes 2')
  })

  it('excludes hidden nodes from the rendered count', async () => {
    const engine = seededEngine()
    const { host, app } = await mountRenderer(engine)
    const slide = engine.project?.slides[0]
    const overlay = host.querySelector('.canvas-dev-overlay')
    const hero = slide?.scene.root.children.find((node) => node.name === 'Hero')
    if (!slide || !overlay || !hero) {
      throw new Error('Setup failed')
    }

    expect(overlay.textContent).toContain('Nodes 4')

    engine.setVisibility(hero.id, false)
    app.ticker.tick()

    expect(overlay.textContent).toContain('Nodes 3')
  })

  it('is absent outside dev builds', async () => {
    vi.stubEnv('DEV', false)
    try {
      const { host } = await mountRenderer(seededEngine())
      expect(host.querySelector('.canvas-dev-overlay')).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('stops updating after dispose', async () => {
    const engine = seededEngine()
    const { host, renderer, app } = await mountRenderer(engine)
    const overlay = host.querySelector('.canvas-dev-overlay')
    if (!overlay) {
      throw new Error('Dev overlay was not created')
    }

    renderer.dispose()

    expect(app.ticker.listenerCount).toBe(0)
    app.ticker.FPS = 12
    app.ticker.tick()
    expect(overlay.textContent).toContain('FPS 60.0')
  })
})
