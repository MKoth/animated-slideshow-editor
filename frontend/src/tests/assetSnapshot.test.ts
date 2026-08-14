import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition } from '../api'
import { captureAssetSnapshot, ensureReferencedEmbedded } from '../app/assetSnapshot'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngine } from '../engine/internal'
import { deserialize, serialize } from '../engine/lessonSerializer'
import { ASSET_DEFINITION_MIME } from '../pixi/renderer/dropPlacement'
import { Renderer } from '../pixi/renderer/renderer'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { makeProjectWithAssets } from './engine/helpers'
import { pixiRegistry } from './renderer/pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

const BOY: AssetDefinition = {
  id: 'def-boy',
  name: 'Boy',
  description: 'A friendly boy',
  category: 'Character',
  tags: ['kid'],
  ai_description: 'AI summary',
  original_filename: 'boy.png',
  import_date: '2026-08-11T12:00:00',
  width: 100,
  height: 80,
  file_size: 1024,
  aspect_ratio: 1.25,
  default_scale: 1,
  default_rotation: 0,
  pivot: { x: 0.5, y: 0.5 },
  anchors: [],
  original_url: '/api/assets/originals/def-boy.png',
  thumbnail_url: '/api/assets/thumbnails/def-boy.png',
}

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function stubAssetImage(url: string): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    if (String(input) === url) {
      return Promise.resolve(
        new Response(IMAGE_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      )
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
  })
}

function setLibraryDefinitions(definitions: readonly AssetDefinition[]): void {
  useAssetLibraryStore.setState({
    definitions: [...definitions],
    loaded: true,
    unavailable: false,
  })
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('captureAssetSnapshot', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAssetLibraryStore.setState({
      definitions: [],
      loaded: false,
      unavailable: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  })

  it('captures the definition metadata and image bytes into the project snapshot', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    setLibraryDefinitions([BOY])
    stubAssetImage(BOY.original_url)

    const captured = await captureAssetSnapshot(engine, BOY.id)

    expect(captured).toBe(true)
    const embedded = engine.getEmbeddedAsset(BOY.id)
    expect(embedded?.name).toBe('Boy')
    expect(embedded?.mimeType).toBe('image/png')
    expect(atob(embedded?.data ?? '')).toBe(String.fromCharCode(...IMAGE_BYTES))
    expect(embedded?.metadata).toMatchObject({
      category: 'Character',
      original_filename: 'boy.png',
    })
    expect(engine.project?.embeddedAssets).toHaveLength(1)
  })

  it('skips the fetch when the definition is already embedded', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    engine.embedAsset({ id: BOY.id, name: BOY.name, data: 'QUJD', mimeType: 'image/png' })
    setLibraryDefinitions([BOY])

    const captured = await captureAssetSnapshot(engine, BOY.id)

    expect(captured).toBe(true)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('returns false without throwing when the library does not hold the definition', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')

    expect(await captureAssetSnapshot(engine, 'def-gone')).toBe(false)
  })

  it('returns false without throwing when the bytes cannot be fetched', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    setLibraryDefinitions([BOY])
    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))

    expect(await captureAssetSnapshot(engine, BOY.id)).toBe(false)
    expect(engine.getEmbeddedAsset(BOY.id)).toBeUndefined()
  })
})

describe('ensureReferencedEmbedded', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  })

  it('embeds every referenced definition missing from the snapshot (save-time fallback)', async () => {
    const { project } = makeProjectWithAssets('Slim', [
      { name: 'Boy', definitionId: 'def-boy' },
      { name: 'Cat', definitionId: 'def-cat' },
    ])
    setLibraryDefinitions([BOY, { ...BOY, id: 'def-cat', name: 'Cat' }])
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === BOY.original_url || url === '/api/assets/originals/def-cat.png') {
        return Promise.resolve(
          new Response(IMAGE_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const engine = createEngine()
    engine.openProject(project)

    await ensureReferencedEmbedded(engine)

    expect(engine.embeddedAssets.map((asset) => asset.id).sort()).toEqual(['def-boy', 'def-cat'])
    const json = JSON.parse(serialize(engine.project as never)) as {
      library: { assets: Array<{ id: string; data: string; mimeType: string }> }
    }
    expect(json.library.assets.map((asset) => asset.id).sort()).toEqual(['def-boy', 'def-cat'])
    expect(json.library.assets[0]?.mimeType).toBe('image/png')
  })

  it('keeps saving self-contained in degraded mode from the cached snapshot', async () => {
    const { project } = makeProjectWithAssets('Degraded', [
      { name: 'Boy', definitionId: 'def-boy' },
    ])
    project.embedAsset({ id: 'def-boy', name: 'Boy', data: 'QUJD', mimeType: 'image/png' })
    const engine = createEngine()
    engine.openProject(project)
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: true })
    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))

    await ensureReferencedEmbedded(engine)

    expect(engine.getEmbeddedAsset('def-boy')?.data).toBe('QUJD')
    const json = JSON.parse(serialize(engine.project as never)) as {
      library: { assets: Array<{ id: string; data: string }> }
    }
    expect(json.library.assets).toEqual([
      { id: 'def-boy', name: 'Boy', data: 'QUJD', mimeType: 'image/png' },
    ])
  })
})

describe('capture at placement', () => {
  beforeEach(() => {
    pixiRegistry.reset()
    vi.stubGlobal('fetch', vi.fn())
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  })

  it('captures the definition and bytes the moment an asset is dropped onto the slide', async () => {
    const engine = createEngine()
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const host = document.createElement('div')
    const onAssetPlaced = vi.fn((definitionId: string) => {
      void captureAssetSnapshot(engine, definitionId)
    })
    const renderer = new Renderer(
      host,
      engine,
      (command) => dispatcher.dispatch(command),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onAssetPlaced,
    )
    await renderer.start()
    const canvas = host.querySelector('canvas')
    if (!canvas) {
      throw new Error('Canvas not found')
    }
    engine.registerAssetDefinition(BOY.id, BOY.name)
    setLibraryDefinitions([BOY])
    stubAssetImage(BOY.original_url)
    const dataTransfer = new DataTransfer()
    dataTransfer.setData(ASSET_DEFINITION_MIME, BOY.id)
    canvas.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: 40,
        clientY: 50,
      }),
    )
    await flushAsync()

    expect(onAssetPlaced).toHaveBeenCalledWith(BOY.id)
    let embedded = engine.getEmbeddedAsset(BOY.id)
    for (let attempt = 0; attempt < 50 && embedded === undefined; attempt += 1) {
      await flushAsync()
      embedded = engine.getEmbeddedAsset(BOY.id)
    }
    expect(embedded?.data).not.toBe('')
    expect(embedded?.mimeType).toBe('image/png')
    expect(engine.project?.embeddedAssets.map((asset) => asset.id)).toEqual([BOY.id])
    renderer.dispose()
  })
})

describe('round-trip through the file', () => {
  it('a captured project deserializes with identical ids and bytes', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    engine.embedAsset({
      id: 'def-boy',
      name: 'Boy',
      data: 'QUJDREU=',
      mimeType: 'image/png',
      metadata: { category: 'Character' },
    })

    const restored = deserialize(serialize(engine.project as never))

    expect(restored.embeddedAssets).toEqual([
      {
        id: 'def-boy',
        name: 'Boy',
        data: 'QUJDREU=',
        mimeType: 'image/png',
        metadata: { category: 'Character' },
      },
    ])
  })
})
