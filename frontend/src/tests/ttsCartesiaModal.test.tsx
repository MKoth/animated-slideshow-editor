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

const MIKE_ID = 'f6184e65-98f2-4e3d-84e5-a2eb198b8688'

function makeEngineWithPrompter(partText = 'Hello Mike', duration = 2.0) {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undo, () => {})
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  engine.createPrompterPart(slide.id, { id: 'p1', text: partText, duration })
  const readOnly = toReadOnly(engine)
  return { engine, readOnly, dispatcher, undo, slideId: slide.id, partId: 'p1' }
}

function wavBytesForDuration(duration: number): Uint8Array {
  const sampleRate = 44100
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
  return new Uint8Array(buffer)
}

describe('TtsModal cartesia provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows saved Cartesia voices + 44 languages and generates with Mike', async () => {
    const { engine, readOnly, dispatcher, slideId, partId } = makeEngineWithPrompter()
    const wav = wavBytesForDuration(2.0)
    let generateBody: Record<string, unknown> | null = null
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/tts/voices')) {
        return new Response(
          JSON.stringify({
            voices: [{ id: MIKE_ID, name: 'Mike', language: 'en', description: 'mine' }],
            defaultVoiceId: MIKE_ID,
            cartesiaConfigured: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url === '/api/tts/models') {
        return new Response(
          JSON.stringify({
            models: [
              'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16',
              'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16',
              'sonic-3.6',
            ],
            providers: ['auto', 'sine', 'mlx', 'cartesia'],
            defaultModel: 'sonic-3.6',
            defaultProvider: 'cartesia',
            capabilities: {
              'sonic-3.6': {
                languages: ['en', 'es'],
                speakers: [],
                instructionSupported: false,
                mode: 'cartesia',
              },
            },
            downloaded: { 'sonic-3.6': true },
            mlxAvailable: false,
            reference: { audioConfigured: false, textConfigured: false },
            cartesiaConfigured: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url === '/api/tts/generate') {
        generateBody = JSON.parse(init?.body as string) as Record<string, unknown>
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
          partText="Hello Mike"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={onClose}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )

    const provider = container.querySelector('[data-testid="tts-provider"]') as HTMLSelectElement
    await waitFor(() => expect(provider.value).toBe('cartesia'))

    // Model locked to sonic-3.6, no local download affordance
    const model = container.querySelector('[data-testid="tts-model"]') as HTMLSelectElement
    expect(model.value).toBe('sonic-3.6')
    expect(model.disabled).toBe(true)

    // Saved voices listed with Mike; default option present
    const voice = container.querySelector('[data-testid="tts-voice"]') as HTMLSelectElement
    await waitFor(() => expect(voice.options.length).toBeGreaterThan(1))
    const voiceLabels = Array.from(voice.options).map((o) => o.textContent)
    expect(voiceLabels.some((t) => t?.includes('Mike'))).toBe(true)

    // Cartesia language list (Auto + 44)
    const language = container.querySelector('[data-testid="tts-language"]') as HTMLSelectElement
    expect(language.options.length).toBe(45)
    fireEvent.change(language, { target: { value: 'es' } })
    fireEvent.change(voice, { target: { value: MIKE_ID } })

    fireEvent.click(container.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })

    expect(generateBody).toMatchObject({
      provider: 'cartesia',
      modelId: 'sonic-3.6',
      voice: MIKE_ID,
      language: 'es',
    })
    const part = engine.getSlide(slideId).prompter!.parts[0]
    expect(part.audioClipId).toBeDefined()
  })
})
