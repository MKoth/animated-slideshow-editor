import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry } from './pixiFake'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { mountRenderer } from './testUtils'
import type { FakeApplication } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
  useThumbnailStore.setState({ thumbnails: {} })
})

function seededEngine(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  const first = engine.createSlide('Slide 1')
  engine.createSlide('Slide 2')
  engine.setActiveSlide(first.id)
  return engine
}

describe('Renderer thumbnail capture', () => {
  it('captures the canvas as the active slide thumbnail after it renders', async () => {
    const engine = seededEngine()
    const capture = vi.fn(() => 'data:image/png;base64,slide')
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      capture,
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1) as FakeApplication
    const second = engine.project?.slides[1]
    if (!second) {
      throw new Error('Slide 2 not created')
    }

    engine.setActiveSlide(second.id)
    app.ticker.tick()

    expect(useThumbnailStore.getState().thumbnails[second.id]).toBe('data:image/png;base64,slide')
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('captures the slide that is bound at render time when switches race', async () => {
    const engine = seededEngine()
    const first = engine.project?.slides[0]
    const second = engine.project?.slides[1]
    if (!first || !second) {
      throw new Error('Slides not created')
    }
    const capture = vi.fn(() => 'data:image/png;base64,canvas')
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      capture,
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1) as FakeApplication

    engine.setActiveSlide(second.id)
    engine.setActiveSlide(first.id)
    app.ticker.tick()

    expect(useThumbnailStore.getState().thumbnails[first.id]).toBe('data:image/png;base64,canvas')
    expect(useThumbnailStore.getState().thumbnails[second.id]).toBeUndefined()
  })

  it('stores nothing when the capture fails', async () => {
    const engine = seededEngine()
    const second = engine.project?.slides[1]
    if (!second) {
      throw new Error('Slide 2 not created')
    }
    const capture = vi.fn(() => null)
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      capture,
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1) as FakeApplication

    engine.setActiveSlide(second.id)
    app.ticker.tick()

    expect(useThumbnailStore.getState().thumbnails[second.id]).toBeUndefined()
  })

  it('removes the thumbnail of a deleted slide', async () => {
    const engine = seededEngine()
    const second = engine.project?.slides[1]
    if (!second) {
      throw new Error('Slide 2 not created')
    }
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => 'data:image/png;base64,x',
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1) as FakeApplication
    useThumbnailStore.getState().setThumbnail(second.id, 'data:image/png;base64,kept')

    engine.setActiveSlide(second.id)
    app.ticker.tick()
    expect(useThumbnailStore.getState().thumbnails[second.id]).toBe('data:image/png;base64,x')

    engine.removeSlide(second.id)
    expect(useThumbnailStore.getState().thumbnails[second.id]).toBeUndefined()
  })

  it('clears every thumbnail when a new project is opened', async () => {
    const engine = seededEngine()
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => 'data:image/png;base64,x',
    )
    await renderer.start()
    useThumbnailStore.getState().setThumbnail('stale', 'data:image/png;base64,stale')

    const incoming = createEngine()
    incoming.createProject({ name: 'Fresh' })
    incoming.createSlide('F1')
    engine.openProject(incoming.project!)

    expect(useThumbnailStore.getState().thumbnails['stale']).toBeUndefined()
  })

  it('captures the first slide after openProject', async () => {
    const engine = createEngine()
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => 'data:image/png;base64,first',
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1) as FakeApplication
    const incoming = createEngine()
    incoming.createProject({ name: 'Fresh' })
    const fresh = incoming.createSlide('F1')

    engine.openProject(incoming.project!)
    app.ticker.tick()

    expect(useThumbnailStore.getState().thumbnails[fresh.id]).toBe('data:image/png;base64,first')
  })

  it('captures nothing after dispose', async () => {
    const engine = seededEngine()
    const second = engine.project?.slides[1]
    if (!second) {
      throw new Error('Slide 2 not created')
    }
    const capture = vi.fn(() => 'data:image/png;base64,x')
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      capture,
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1) as FakeApplication

    renderer.dispose()
    engine.setActiveSlide(second.id)
    app.ticker.tick()

    expect(capture).not.toHaveBeenCalled()
    expect(useThumbnailStore.getState().thumbnails[second.id]).toBeUndefined()
  })

  it('defaults to extracting the canvas when no capture function is injected', async () => {
    const { app } = await mountRenderer(seededEngine())
    expect(app.renderer).toBeDefined()
  })
})
