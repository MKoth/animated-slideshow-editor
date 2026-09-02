import { render, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateAudioAssetCommand,
  CreateAudioClipCommand,
} from '../engine/commands'
import { CommitTtsCommand } from '../engine/commands/commitTtsCommand'
import { TtsModal } from '../components/audio/TtsModal'
import { ApiClient } from '../api/apiClient'
import { TtsApi } from '../engine/ttsProvider'
import { VoicePromptsApi } from '../api/voicePromptsApi'
import { useAudioResizePreferenceStore } from '../stores/audioResizePreferenceStore'
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

function wavBytesForDuration(duration: number): Uint8Array {
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
  return bytes
}

describe('Issue #250 — TTS duration parity with recording prompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    useAudioResizePreferenceStore.setState({ preferences: { voice: null, sfx: null, music: null } })
    useAudioResizePreferenceStore.persist.clearStorage()
  })

  it('After TTS generation, duration mismatch triggers dialog Fit clip to text vs Fit text to clip', async () => {
    const { readOnly, dispatcher, undo, slideId, partId } = makeEngineWithPrompter('Hello TTS', 2.0)
    const wav = wavBytesForDuration(3.0) // longer than planned 2.0 => mismatch
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts'))
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/tts/generate')
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
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
          undoStack: undo,
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
    await waitFor(() =>
      expect(container.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    fireEvent.click(container.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(
      () => expect(container.querySelector('[data-testid="mismatch-dialog"]')).toBeInTheDocument(),
      { timeout: 2000 },
    )
    expect(container.querySelector('[data-testid="mismatch-dialog"]')!.textContent).toMatch(
      /Fit clip to text/,
    )
    expect(container.querySelector('[data-testid="mismatch-dialog"]')!.textContent).toMatch(
      /Fit text to clip/,
    )
    expect(
      container.querySelector('[data-testid="mismatch-speed-up"]') ||
        container.querySelector('[data-testid="mismatch-slow-down"]'),
    ).toBeTruthy()
    // Check per-track dont ask checkbox exists
    expect(container.querySelector('[data-testid="mismatch-dont-ask"]')).toBeInTheDocument()
    expect(container.textContent).toMatch(/Original WAV preserved/)
    expect(container.textContent).toMatch(/RubberBand/)
  })

  it('Fit clip to text sets playbackRate (non-destructive, RubberBand at export); Fit text to clip resizes PrompterPart and shifts downstream gap-free', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'First', duration: 2.0 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'Second', duration: 2.0 })
    // downstream clip at 3.5
    const base = btoa('x')
    const aRes = dispatcher.dispatch(
      new CreateAudioAssetCommand({
        name: 'x',
        data: base,
        mimeType: 'audio/wav',
        metadata: { duration: 1, sampleRate: 44100, channels: 1 },
      }),
    )
    if (!aRes.ok) throw new Error('asset create failed')
    const assetId = (aRes.inverse as { assetId: string }).assetId
    dispatcher.dispatch(
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'voice',
        timelineStart: 3.5,
        sourceEnd: 1,
      }),
    )
    undo.clear()
    // Test Fit clip to text via CommitTtsCommand with playbackRate
    const wavAssetId = 'tts-asset-1'
    const wavData = btoa('tts')
    // Simulate TTS asset with duration 3.0 vs planned 2.0
    const commitStretch = dispatcher.dispatch(
      new CommitTtsCommand({
        slideId: slide.id,
        partId: 'p1',
        asset: {
          id: wavAssetId,
          name: 'TTS First',
          data: wavData,
          mimeType: 'audio/wav',
          metadata: { duration: 3.0, sampleRate: 24000, channels: 1 },
        },
        trackId: 'voice',
        timelineStart: 0,
        sourceEnd: 3.0,
        playbackRate: 1.5, // 3.0 / 2.0
      }),
    )
    expect(commitStretch.ok).toBe(true)
    const clip = engine.getSlide(slide.id).audio.clips.find((c) => c.assetId === wavAssetId)
    expect(clip).toBeDefined()
    expect(clip!.playbackRate).toBeCloseTo(1.5)
    // Original asset preserved
    expect(engine.getEmbeddedAsset(wavAssetId)!.data).toBe(wavData)
    // Part duration unchanged
    expect(engine.getSlide(slide.id).prompter!.parts[0].duration).toBeCloseTo(2.0)
    expect(engine.getSlide(slide.id).prompter!.parts[1].startTime).toBeCloseTo(2.0)
    // Undo should revert clip and link atomically
    dispatcher.undo()
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.assetId === wavAssetId),
    ).toBeUndefined()
    expect(engine.getSlide(slide.id).prompter!.parts[0].audioClipId).toBeUndefined()
    // Test Fit text to clip with shift
    undo.clear()
    const wavAssetId2 = 'tts-asset-2'
    const commitFitText = dispatcher.dispatch(
      new CommitTtsCommand({
        slideId: slide.id,
        partId: 'p1',
        asset: {
          id: wavAssetId2,
          name: 'TTS First2',
          data: wavData,
          mimeType: 'audio/wav',
          metadata: { duration: 3.0, sampleRate: 24000, channels: 1 },
        },
        trackId: 'voice',
        timelineStart: 0,
        sourceEnd: 3.0,
        playbackRate: 1,
        fitTextToClip: { duration: 3.0, shiftDownstream: true },
      }),
    )
    expect(commitFitText.ok).toBe(true)
    expect(engine.getSlide(slide.id).prompter!.parts[0].duration).toBeCloseTo(3.0)
    expect(engine.getSlide(slide.id).prompter!.parts[1].startTime).toBeCloseTo(3.0)
    // Downstream clip should have shifted by +1.0 (from 3.5 to 4.5)
    const downstreamClip = engine
      .getSlide(slide.id)
      .audio.clips.find((c) => c.timelineStart === 4.5)
    expect(downstreamClip).toBeDefined()
    // Undo should revert both prompter and clip atomically
    dispatcher.undo()
    expect(engine.getSlide(slide.id).prompter!.parts[0].duration).toBeCloseTo(2.0)
    expect(engine.getSlide(slide.id).prompter!.parts[1].startTime).toBeCloseTo(2.0)
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.assetId === wavAssetId2),
    ).toBeUndefined()
    const clipAfterUndo = engine.getSlide(slide.id).audio.clips.find((c) => c.timelineStart === 3.5)
    expect(clipAfterUndo).toBeDefined()
  })

  it('Per-track Dont ask again applies here too; respects Alt/Shift overrides', async () => {
    const { engine, readOnly, dispatcher, undo, slideId, partId } = makeEngineWithPrompter(
      'Hello',
      2.0,
    )
    const wavLong = wavBytesForDuration(3.0)
    let nextWav: Uint8Array = wavLong
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts'))
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/tts/generate')
        return new Response(nextWav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const client = new ApiClient()
    const tts = new TtsApi(client)
    const voiceApi = new VoicePromptsApi(client)
    const onClose = vi.fn()
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)

    // First, set preference to stretch and verify auto-apply without dialog
    useAudioResizePreferenceStore.getState().setPreference('voice', 'stretch')
    const { container: c1, unmount: unmount1 } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: undo,
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="Hello"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={onClose}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )
    await waitFor(() =>
      expect(c1.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    nextWav = wavLong
    fireEvent.click(c1.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    const partAfterStretch = engine.getSlide(slideId).prompter!.parts[0]
    const clipAfterStretch = engine
      .getSlide(slideId)
      .audio.clips.find((c) => c.id === partAfterStretch.audioClipId)
    expect(clipAfterStretch!.playbackRate).toBeCloseTo(1.5)
    expect(c1.querySelector('[data-testid="mismatch-dialog"]')).toBeNull()
    unmount1()
    onClose.mockClear()
    // Clear and test Don't ask via dialog
    engine.deleteAudioClip(slideId, partAfterStretch.audioClipId!)
    // Reset part link
    const slide = engine.getSlide(slideId)
    delete (slide.prompter!.parts[0] as unknown as { audioClipId?: string }).audioClipId
    delete (slide.prompter!.parts[0] as unknown as { audioAssetId?: string }).audioAssetId
    useAudioResizePreferenceStore.getState().clearAll()
    nextWav = wavLong
    const { container: c2 } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: undo,
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="Hello"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={onClose}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )
    await waitFor(() =>
      expect(c2.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    fireEvent.click(c2.querySelector('[data-testid="tts-generate"]') as HTMLElement)
    await waitFor(() =>
      expect(c2.querySelector('[data-testid="mismatch-dialog"]')).toBeInTheDocument(),
    )
    const dontAsk = c2.querySelector('[data-testid="mismatch-dont-ask"]') as HTMLInputElement
    fireEvent.click(dontAsk)
    expect(dontAsk.checked).toBe(true)
    fireEvent.click(c2.querySelector('[data-testid="mismatch-speed-up"]') as HTMLElement)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBe('stretch')
    // Next generation should auto-apply without dialog even though we clear for next test we need to check Alt override
    onClose.mockClear()
    // Test Alt override forces stretch even when preference is trim
    useAudioResizePreferenceStore.getState().setPreference('voice', 'trim')
    // Need new part for Alt test - use same part but delete old clip first
    const partBeforeAlt = engine.getSlide(slideId).prompter!.parts[0]
    if (partBeforeAlt.audioClipId) {
      try {
        engine.deleteAudioClip(slideId, partBeforeAlt.audioClipId)
      } catch {
        /* ignore */
      }
      delete (engine.getSlide(slideId).prompter!.parts[0] as unknown as { audioClipId?: string })
        .audioClipId
      delete (engine.getSlide(slideId).prompter!.parts[0] as unknown as { audioAssetId?: string })
        .audioAssetId
    }
    // Render new modal for Alt test
    const { container: c3 } = render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          undoStack: undo,
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="Hello"
          partStartTime={0}
          plannedDuration={2.0}
          onClose={onClose}
          ttsProvider={tts}
          voicePromptsApi={voiceApi}
        />
      </EngineContext.Provider>,
    )
    await waitFor(() =>
      expect(c3.querySelector('[data-testid="tts-prompt-picker"]')).toBeInTheDocument(),
    )
    nextWav = wavLong
    const generateBtn = c3.querySelector('[data-testid="tts-generate"]') as HTMLElement
    fireEvent.click(generateBtn, { altKey: true } as unknown as MouseEvent)
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    expect(c3.querySelector('[data-testid="mismatch-dialog"]')).toBeNull()
    const clipAlt = engine
      .getSlide(slideId)
      .audio.clips.find((c) => c.id === engine.getSlide(slideId).prompter!.parts[0].audioClipId)
    expect(clipAlt!.playbackRate).toBeCloseTo(1.5) // stretch via Alt despite trim preference
  })

  it('Undo reverts both prompter and clip changes atomically via TTS dialog choice', async () => {
    const { engine, readOnly, dispatcher, undo, slideId, partId } = makeEngineWithPrompter(
      'First',
      2.0,
    )
    // Add second part for shift test
    engine.createPrompterPart(slideId, { id: 'p2', text: 'Second', duration: 2.0 })
    const wav = wavBytesForDuration(3.0)
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/voice-prompts'))
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url === '/api/tts/generate')
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
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
          undoStack: undo,
          dispatch: dispatch as unknown as never,
          persistence: noopPersistence,
        }}
      >
        <TtsModal
          slideId={slideId}
          partId={partId}
          partText="First"
          partStartTime={0}
          plannedDuration={2.0}
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
      expect(container.querySelector('[data-testid="mismatch-dialog"]')).toBeInTheDocument(),
    )
    // Choose Fit text to clip with shift checked
    const shiftCb = container.querySelector(
      '[data-testid="mismatch-shift-checkbox"]',
    ) as HTMLInputElement
    fireEvent.click(shiftCb)
    expect(shiftCb.checked).toBe(true)
    fireEvent.click(container.querySelector('[data-testid="mismatch-extend"]') as HTMLElement)
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    // Verify downstream shifted
    expect(engine.getSlide(slideId).prompter!.parts[0].duration).toBeCloseTo(3.0)
    expect(engine.getSlide(slideId).prompter!.parts[1].startTime).toBeCloseTo(3.0)
    const clip = engine
      .getSlide(slideId)
      .audio.clips.find((c) => c.id === engine.getSlide(slideId).prompter!.parts[0].audioClipId)
    expect(clip).toBeDefined()
    // Undo should revert both
    const beforeUndoClipCount = engine.getSlide(slideId).audio.clips.length
    dispatcher.undo()
    expect(engine.getSlide(slideId).prompter!.parts[0].duration).toBeCloseTo(2.0)
    expect(engine.getSlide(slideId).prompter!.parts[1].startTime).toBeCloseTo(2.0)
    expect(engine.getSlide(slideId).prompter!.parts[0].audioClipId).toBeUndefined()
    expect(engine.getSlide(slideId).audio.clips.length).toBe(beforeUndoClipCount - 1)
  })
})
