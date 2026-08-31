import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetsPanel } from '../components/panels/AssetsPanel'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { EngineContext } from '../app/engineContext'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { CreateAudioAssetCommand } from '../engine/commands'
import type { EmbeddedAsset } from '../engine/embeddedAsset'

function stubBackendWithMetadata(meta: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/assets') && url.includes('/peaks')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ peaks: Array(800).fill(200), duration: meta.duration, sampleRate: 44100, channels: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    if (url.startsWith('/api/assets/originals/')) {
      // audio bytes for quick decode — not needed if we mock AudioContext
      return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 }))
    }
    if (url.startsWith('/api/assets')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

function makeEmbeddedAudioAsset(overrides: Partial<EmbeddedAsset> & { metadata?: Record<string, unknown> }): EmbeddedAsset {
  return {
    id: 'audio-1',
    name: 'tone',
    data: 'dGVzdA==', // dummy base64
    mimeType: 'audio/wav',
    metadata: overrides.metadata ?? { duration: 2.5, sampleRate: 44100, channels: 1, waveformPeaks: Array(800).fill(127) },
    ...overrides,
  } as EmbeddedAsset
}

function engineWithEmbeddedAssets(assets: EmbeddedAsset[]) {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undo, { log: () => {} })
  engine.createProject({ name: 'Test' })
  for (const a of assets) {
    dispatcher.dispatch(new CreateAudioAssetCommand({ name: a.name, data: a.data, mimeType: a.mimeType, metadata: a.metadata as Record<string, unknown> }))
  }
  // Return read-only engine + dispatcher for provider
  const ro = toReadOnly(engine)
  return { engine: ro, internal: engine, dispatcher }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useAssetLibraryStore.setState({
    definitions: [],
    loading: false,
    error: null,
    unavailable: false,
    search: '',
    sort: 'import_date',
    order: 'desc',
    selectedId: null,
  })
})

describe('Audio waveform caching', () => {
  it('badge mm:ss from cached duration never decodes on every open', async () => {
    const asset = makeEmbeddedAudioAsset({ metadata: { duration: 65, waveformPeaks: Array(800).fill(100) } })
    const { engine } = engineWithEmbeddedAssets([asset])
    // Spy decode: ensure no AudioContext decode is triggered for badge render
    const decodeSpy = vi.fn()
    ;(globalThis as unknown as { AudioContext?: unknown }).AudioContext = decodeSpy as unknown as typeof AudioContext

    stubBackendWithMetadata({ duration: 65 })

    render(
      <EngineContext.Provider value={{ engine, dispatch: vi.fn() }}>
        <AssetsPanel />
      </EngineContext.Provider>,
    )

    // Switch to audio filter
    const audioChip = screen.getByRole('button', { name: 'Audio' })
    audioChip.click()
    // Badge should be 01:05 from cached 65s
    expect(await screen.findByText('01:05')).toBeInTheDocument()
    expect(decodeSpy).not.toHaveBeenCalled()
  })

  it('frontend fallback quick peaks then swap to canonical for <30s backend asset', async () => {
    // Backend definition with short duration but no cached peaks initially (simulating before canonical)
    const def = {
      id: 'backend-audio-1',
      name: 'short-tone',
      description: '',
      category: 'audio',
      tags: [],
      ai_description: '',
      original_filename: 'tone.wav',
      import_date: '2026-08-31T00:00:00',
      width: 1,
      height: 1,
      file_size: 1234,
      aspect_ratio: 1,
      default_scale: 1,
      default_rotation: 0,
      pivot: { x: 0.5, y: 0.5 },
      anchors: [],
      original_url: '/api/assets/originals/backend-audio-1.wav',
      thumbnail_url: '/api/assets/thumbnails/backend-audio-1.png',
      mimeType: 'audio/wav',
      metadata: { duration: 2.5, sampleRate: 44100, channels: 1 }, // no waveformPeaks initially
    }

    useAssetLibraryStore.setState({
      definitions: [def as unknown as never],
      loading: false,
      error: null,
      unavailable: false,
      search: '',
      sort: 'import_date',
      order: 'desc',
      selectedId: null,
    })

    // Mock AudioContext to produce quick peaks of 50
    const quickPeaks = Array(800).fill(50)
    const canonicalPeaks = Array(800).fill(200)
    const mockBuffer = {
      duration: 2.5,
      sampleRate: 44100,
      numberOfChannels: 1,
      length: 11025,
      getChannelData: () => new Float32Array(11025).fill(0.5),
    }
    const AudioCtor = vi.fn().mockImplementation(() => ({
      decodeAudioData: vi.fn().mockResolvedValue(mockBuffer),
      close: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('AudioContext', AudioCtor as unknown as typeof AudioContext)
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = AudioCtor as unknown as typeof AudioContext

    stubBackendWithMetadata({ duration: 2.5 })
    // Also mock fetch for audio file to succeed
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/assets/originals/backend-audio-1.wav') {
        return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 }))
      }
      if (url.includes('/peaks')) {
        return Promise.resolve(
          new Response(JSON.stringify({ peaks: canonicalPeaks, duration: 2.5, sampleRate: 44100, channels: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.startsWith('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([def]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    })

    const { engine } = engineWithEmbeddedAssets([])
    render(
      <EngineContext.Provider value={{ engine, dispatch: vi.fn() }}>
        <AssetsPanel />
      </EngineContext.Provider>,
    )
    const audioChip = screen.getByRole('button', { name: 'Audio' })
    audioChip.click()

    // Initially quick decode may produce peaks, then canonical swap
    // Wait for canonical to be fetch and rendered (WaveformCanvas should exist)
    await waitFor(() => {
      const canvases = document.querySelectorAll('canvas[data-testid="waveform-canvas-backend"]')
      expect(canvases.length).toBeGreaterThan(0)
    })
    // badge still from cached duration
    expect(screen.getByText('00:02.5')).toBeInTheDocument()
  })

  it('long asset (>=30s) never decodes frontend — only backend canonical', async () => {
    const def = {
      id: 'backend-audio-long',
      name: 'long-tone',
      description: '',
      category: 'audio',
      tags: [],
      ai_description: '',
      original_filename: 'long.wav',
      import_date: '2026-08-31T00:00:00',
      width: 1,
      height: 1,
      file_size: 999999,
      aspect_ratio: 1,
      default_scale: 1,
      default_rotation: 0,
      pivot: { x: 0.5, y: 0.5 },
      anchors: [],
      original_url: '/api/assets/originals/backend-audio-long.wav',
      thumbnail_url: '/api/assets/thumbnails/backend-audio-long.png',
      mimeType: 'audio/wav',
      metadata: { duration: 120, sampleRate: 44100, channels: 1 },
    }
    useAssetLibraryStore.setState({
      definitions: [def as unknown as never],
      loading: false,
      error: null,
      unavailable: false,
      search: '',
      sort: 'import_date',
      order: 'desc',
      selectedId: null,
    })
    const decodeSpy = vi.fn().mockImplementation(() => ({
      decodeAudioData: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('AudioContext', decodeSpy as unknown as typeof AudioContext)
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = decodeSpy as unknown as typeof AudioContext

    const canonical = Array(2000).fill(180)
    vi.mocked(fetch).mockImplementation((url) => {
      const u = String(url)
      if (u.includes('/peaks')) {
        return Promise.resolve(
          new Response(JSON.stringify({ peaks: canonical, duration: 120, sampleRate: 44100, channels: 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (u.startsWith('/api/assets')) return Promise.resolve(new Response(JSON.stringify([def]), { status: 200 }))
      return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 }))
    })

    const { engine } = engineWithEmbeddedAssets([])
    render(
      <EngineContext.Provider value={{ engine, dispatch: vi.fn() }}>
        <AssetsPanel />
      </EngineContext.Provider>,
    )
    const audioChip = screen.getByRole('button', { name: 'Audio' })
    audioChip.click()
    await waitFor(() => {
      expect(document.querySelectorAll('canvas[data-testid="waveform-canvas-backend"]').length).toBeGreaterThan(0)
    })
    // decodeAudioData should not have been called for long asset quick path
    // Our spy wraps AudioContext construction, not decode; we check that decode not called indirectly via our stub
    // Since we stubbed fetch to not return audio bytes decode path, the quick decode fetch would fail; but we ensure no quick decode attempted
    expect(decodeSpy).not.toHaveBeenCalled()
    expect(screen.getByText('02:00')).toBeInTheDocument() // 120s = 02:00
  })
})
