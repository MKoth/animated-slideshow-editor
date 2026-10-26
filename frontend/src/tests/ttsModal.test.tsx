import { render, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { TtsModal } from '../components/audio/TtsModal'
import { ApiClient } from '../api/apiClient'
import { TtsApi } from '../engine/ttsProvider'
import { VoicePromptsApi } from '../api/voicePromptsApi'
import { noopPersistence } from './contextHarness'

function makeEngineWithPrompter(partText = 'Hello world', duration = 2.0) {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undo, () => {})
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  engine.createPrompterPart(slide.id, { id: 'p1', text: partText, duration })
  const readOnly = toReadOnly(engine)
  return { engine, readOnly, dispatcher, undo, slideId: slide.id, partId: 'p1' }
}

function wavBase64ForDuration(duration: number): string {
  const sampleRate = 24000
  const channels = 1
  const byteRate = sampleRate * channels * 2
  const dataSize = Math.round(duration * byteRate)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const write = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataSize, true)
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function wavBytesForDuration(duration: number): Uint8Array {
  const base64 = wavBase64ForDuration(duration)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

describe('TtsModal seam + mocked voice prompts & TTS', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('per-part TTS dialog reusing Record modal shell with prompt picker, language/voice overrides, progress, retry, error surfacing', async () => {
    const { engine, readOnly, dispatcher, slideId, partId } = makeEngineWithPrompter(
      'Hello TTS',
      2.0,
    )
    // Mock voice prompts list
    const mockPrompts = [
      {
        id: 'vp-1',
        title: 'Warm',
        instruction: 'speak warmly',
        language: 'en',
        voice: 'nova',
        params: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]
    const wav = wavBytesForDuration(2.0)
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts')) {
        if ((init?.method ?? 'GET') === 'GET')
          return new Response(JSON.stringify(mockPrompts), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      }
      if (url === '/api/tts/generate') {
        const body = JSON.parse(init?.body as string)
        expect(body.text).toBe('Hello TTS')
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      }
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const client = new ApiClient()
    const voiceApi = new VoicePromptsApi(client)
    const tts = new TtsApi(client)
    const onClose = vi.fn()
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)

    const { container } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: new UndoStack(),
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="Hello TTS"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={onClose}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )

    // Should show text read-only (header + body, so check container)
    expect(container.textContent).toContain('Hello TTS')
    // Prompt picker
    await waitFor(() =>
      expect(container.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    expect(container.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument()
    // language/voice overrides exist
    expect(container.querySelector('[data-testid="tts-language"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="tts-voice"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="tts-instruction"]')).toBeInTheDocument()

    // Select prompt
    const picker = container.querySelector('[data-testid="tts-prompt-picker"]') as HTMLSelectElement
    await waitFor(() => expect(picker.options.length).toBeGreaterThan(1))
    fireEvent.change(picker, { target: { value: 'vp-1' } })
    expect(picker.value).toBe('vp-1')

    // Override language
    fireEvent.change(container.querySelector('[data-testid="tts-language"]') as HTMLElement, {
      target: { value: 'es' },
    })
    fireEvent.change(container.querySelector('[data-testid="tts-voice"]') as HTMLElement, {
      target: { value: 'nova' },
    })

    // Click Generate -> progress
    fireEvent.click(container.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    expect(container.querySelector('[data-testid="tts-progress"]')).toBeInTheDocument()

    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    // Materialisation identical to recording
    const part = engine.getSlide(slideId).prompter!.parts[0]
    expect(part.audioClipId).toBeDefined()
    expect(part.audioAssetId).toBeDefined()
    const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === part.audioClipId)
    expect(clip).toBeDefined()
    expect(clip!.trackId).toBe('voice')
    expect(clip!.timelineStart).toBe(0)
    const asset = engine.getEmbeddedAsset(part.audioAssetId!)
    expect(asset).toBeDefined()
    expect(asset!.mimeType).toBe('audio/wav')
  })

  it('generation errors with retry surfacing', async () => {
    const { readOnly, dispatcher, slideId, partId } = makeEngineWithPrompter('Retry text', 1.0)
    const wav = wavBytesForDuration(1.0)
    let callCount = 0
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts'))
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/tts/generate') {
        callCount++
        if (callCount === 1)
          return new Response(JSON.stringify({ detail: 'engine busy' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const client = new ApiClient()
    const tts = new TtsApi(client)
    const voiceApi = new VoicePromptsApi(client)
    const onClose = vi.fn()
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)

    const { container } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: new UndoStack(),
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="Retry text"
          partStartTime={0}
          plannedDuration={1.0}
          onClose={onClose}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )
    await waitFor(() =>
      expect(container.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    fireEvent.click(container.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('[data-testid="tts-error"]')).toBeInTheDocument(),
    )
    expect(container.querySelector('[data-testid="tts-error"]')!.textContent).toMatch(
      /engine busy|Generation failed/i,
    )
    expect(container.querySelector('[data-testid="tts-retry"]')).toBeInTheDocument()
    fireEvent.click(container.querySelector('[data-testid="tts-retry"]') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('[data-testid="tts-progress"]')).toBeInTheDocument(),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    expect(callCount).toBe(2)
  })

  it('Voice Prompt CRU via modal: create and share across Slides', async () => {
    const store: Array<Record<string, unknown>> = []
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/voice-prompts' && method === 'GET')
        return new Response(JSON.stringify(store), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/voice-prompts' && method === 'POST') {
        const body = JSON.parse(init?.body as string)
        const created = {
          id: `vp-${store.length + 1}`,
          title: body.title,
          instruction: body.instruction,
          language: body.language ?? null,
          voice: body.voice ?? null,
          params: body.params ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        store.push(created)
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/voice-prompts/') && method === 'PUT') {
        const id = url.split('/')[3]
        const obj = store.find((p) => p.id === id)
        if (obj) Object.assign(obj, JSON.parse(init?.body as string))
        return new Response(JSON.stringify(obj), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/voice-prompts/') && method === 'DELETE') {
        const id = url.split('/')[3]
        const idx = store.findIndex((p) => p.id === id)
        if (idx !== -1) store.splice(idx, 1)
        return new Response(null, { status: 204 })
      }
      if (url === '/api/tts/generate') {
        const wav = wavBytesForDuration(0.7)
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const client = new ApiClient()
    const voiceApi = new VoicePromptsApi(client)
    const tts = new TtsApi(client)

    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide1 = engine.createSlide('S1')
    engine.createPrompterPart(slide1.id, { id: 'p1', text: 'Slide1 text', duration: 2.0 })
    const slide2 = engine.createSlide('S2')
    engine.createPrompterPart(slide2.id, { id: 'p2', text: 'Slide2 text', duration: 2.0 })
    const readOnly = toReadOnly(engine)
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)

    // Render modal for slide1, create prompt
    const { unmount, container: c1 } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: new UndoStack(),
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slide1.id}
          partId="p1"
          partText="Slide1 text"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={vi.fn()}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )
    await waitFor(() =>
      expect(c1.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    fireEvent.click(c1.querySelector('[data-testid="voice-prompt-create-btn"]') as HTMLElement)
    await waitFor(() =>
      expect(c1.querySelector('[data-testid="voice-prompt-form"]')).toBeInTheDocument(),
    )
    fireEvent.change(c1.querySelector('[data-testid="voice-prompt-title"]') as HTMLElement, {
      target: { value: 'Shared Voice' },
    })
    fireEvent.change(c1.querySelector('[data-testid="voice-prompt-instruction"]') as HTMLElement, {
      target: { value: 'Speak slowly' },
    })
    fireEvent.change(c1.querySelector('[data-testid="voice-prompt-language"]') as HTMLElement, {
      target: { value: 'en' },
    })
    fireEvent.click(c1.querySelector('[data-testid="voice-prompt-save"]') as HTMLElement)
    await waitFor(() =>
      expect(c1.querySelector('[data-testid="voice-prompt-form"]')).not.toBeInTheDocument(),
    )
    expect(store).toHaveLength(1)
    expect(store[0].title).toBe('Shared Voice')
    unmount()

    const { container: c2 } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: new UndoStack(),
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slide2.id}
          partId="p2"
          partText="Slide2 text"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={vi.fn()}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )
    await waitFor(() =>
      expect(c2.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    const picker = c2.querySelector('[data-testid="tts-prompt-picker"]') as HTMLSelectElement
    await waitFor(() => expect(picker.options.length).toBe(2))
    expect(picker.options[1].textContent).toContain('Shared Voice')
  })

  it('LessonJSON still excludes voice_prompts (global not in .lesson)', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Hello', duration: 1.0 })
    const { serialize } = await import('../engine/lessonSerializer')
    const text = serialize(engine.project!)
    const parsed = JSON.parse(text)
    expect(JSON.stringify(text)).not.toContain('voice_prompts')
    expect(parsed).not.toHaveProperty('voice_prompts')
    if (parsed.library) expect(parsed.library).not.toHaveProperty('voice_prompts')
  })
})

describe('TtsModal standard voice reference (Base)', () => {
  const BASE_MODEL = 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16'

  function baseModelsPayload() {
    return {
      models: [BASE_MODEL],
      providers: ['auto'],
      defaultModel: BASE_MODEL,
      defaultProvider: 'auto',
      capabilities: {
        [BASE_MODEL]: { speakers: [], mode: 'voice_clone', instructionSupported: false },
      },
      reference: { audioConfigured: true, textConfigured: true },
    }
  }

  // Reference assets resolve through the asset library, which the modal
  // loads on mount — serve the girl-voice asset there.
  const referenceAsset = {
    id: 'asset-9',
    name: 'Girl voice',
    description: '',
    category: 'audio',
    tags: [],
    ai_description: '',
    original_filename: 'girl.wav',
    import_date: '',
    width: 0,
    height: 0,
    file_size: 0,
    aspect_ratio: 0,
    default_scale: 1,
    default_rotation: 0,
    pivot: { x: 0, y: 0 },
    anchors: [],
    original_url: '',
    thumbnail_url: '',
    mimeType: 'audio/wav',
  }

  function renderModal(opts: {
    prompts: Array<Record<string, unknown>>
    onGenerateBody: (body: Record<string, unknown>) => void
  }) {
    const { readOnly, dispatcher, slideId, partId } = makeEngineWithPrompter('Hello TTS', 2.0)
    const wav = wavBytesForDuration(2.0)
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts') && (init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify(opts.prompts), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/tts/models')
        return new Response(JSON.stringify(baseModelsPayload()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.startsWith('/api/assets'))
        return new Response(JSON.stringify([referenceAsset]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/tts/generate') {
        opts.onGenerateBody(JSON.parse(init?.body as string) as Record<string, unknown>)
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      }
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const client = new ApiClient()
    const onClose = vi.fn()
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    const view = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: new UndoStack(),
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="Hello TTS"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={onClose}
          ttsProvider={new TtsApi(client)}
          voicePromptsApi={new VoicePromptsApi(client)}
        />
      </EngineContext.Provider>,
    )
    return { ...view, onClose }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('defaults to the standard reference and sends an explicit empty id', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const { container, onClose } = renderModal({
      prompts: [],
      onGenerateBody: (body) => bodies.push(body),
    })
    const ref = (await waitFor(() =>
      container.querySelector('[data-testid="tts-voice-reference"]'),
    )) as HTMLSelectElement
    expect(ref).not.toBeDisabled()
    expect(ref.value).toBe('__standard__')
    expect(container.querySelector('[data-testid="tts-reference-status"]')).toHaveTextContent(
      /Standard reference ready/,
    )
    fireEvent.click(container.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    expect(bodies).toHaveLength(1)
    // Explicit "" forces the backend default even with no prompt involved.
    expect(bodies[0]!.referenceAssetId).toBe('')
  })

  it('prefills a prompt-stored reference but resets to standard on prompts without one', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const stamp = new Date().toISOString()
    const { container, onClose } = renderModal({
      prompts: [
        {
          id: 'vp-ref',
          title: 'With ref',
          instruction: 'read well',
          language: 'en',
          voice: null,
          params: { referenceAssetId: 'asset-9' },
          created_at: stamp,
          updated_at: stamp,
        },
        {
          id: 'vp-plain',
          title: 'Plain',
          instruction: 'read plainly',
          language: 'en',
          voice: null,
          params: null,
          created_at: stamp,
          updated_at: stamp,
        },
      ],
      onGenerateBody: (body) => bodies.push(body),
    })
    await waitFor(() =>
      expect(container.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    const picker = container.querySelector('[data-testid="tts-prompt-picker"]') as HTMLSelectElement
    await waitFor(() => expect(picker.options.length).toBe(3))
    const ref = container.querySelector('[data-testid="tts-voice-reference"]') as HTMLSelectElement

    fireEvent.change(picker, { target: { value: 'vp-ref' } })
    await waitFor(() => expect(ref.value).toBe('asset-9'))

    // Switching to a prompt without a stored reference must not keep the
    // stale asset: it falls back to the standard reference.
    fireEvent.change(picker, { target: { value: 'vp-plain' } })
    await waitFor(() => expect(ref.value).toBe('__standard__'))

    fireEvent.click(container.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.referenceAssetId).toBe('')
  })
})
