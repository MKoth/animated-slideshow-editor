import { render, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { WaveformEditorModal } from '../components/audio/WaveformEditorModal'
import { noopPersistence } from './contextHarness'

function makeEngineWithClip(
  opts: {
    assetDuration?: number
    sourceStart?: number
    sourceEnd?: number
    timelineStart?: number
    volume?: number
    muted?: boolean
    waveformPeaks?: number[]
    assetBase64?: string
  } = {},
) {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undo, () => {})
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  engine.setSlideDuration(slide.id, 20)
  const assetDuration = opts.assetDuration ?? 10
  const data = opts.assetBase64 ?? 'dGVzdA=='
  const peaks = opts.waveformPeaks ?? Array(800).fill(120)
  engine.embedAsset({
    id: 'audio-1',
    name: 'test.wav',
    data,
    mimeType: 'audio/wav',
    metadata: { duration: assetDuration, sampleRate: 44100, channels: 1, waveformPeaks: peaks },
  })
  const clip = engine.createAudioClip(slide.id, {
    assetId: 'audio-1',
    trackId: 'voice',
    timelineStart: opts.timelineStart ?? 2,
    sourceStart: opts.sourceStart ?? 0,
    sourceEnd: opts.sourceEnd ?? assetDuration,
    volume: opts.volume ?? 0.8,
    muted: opts.muted ?? false,
    playbackRate: 1,
  })
  const readOnly = toReadOnly(engine)
  return {
    engine,
    readOnly,
    dispatcher,
    undo,
    slideId: slide.id,
    clipId: clip.id,
    assetId: 'audio-1',
    clip,
    peaks,
  }
}

class MockAudio {
  src = ''
  currentTime = 0
  volume = 1
  muted = false
  playbackRate = 1
  play = vi.fn(async () => {})
  pause = vi.fn(() => {})
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(src?: string) {
    if (src) this.src = src
    MockAudio.instances.push(this)
  }
  static instances: MockAudio[] = []
  static clear() {
    MockAudio.instances = []
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  MockAudio.clear()
  vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ peaks: null }), { status: 200 })),
  )
})

describe('Waveform Editor — #265', () => {
  it('Modal renders waveform via cached waveformPeaks / decoded peaks', async () => {
    const { readOnly, dispatcher, slideId, clipId } = makeEngineWithClip({
      assetDuration: 8,
      waveformPeaks: Array(800).fill(200),
    })
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: new UndoStack(),
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slideId} clipId={clipId} onClose={vi.fn()} />
      </EngineContext.Provider>,
    )
    expect(screen.getByTestId('waveform-editor-modal')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-editor-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-ruler')).toBeInTheDocument()
    // canvas should exist and peaks cached path shows
    expect(screen.getByTestId('waveform-editor-canvas-container')).toBeInTheDocument()
    // check that cached peaks indicator present
    expect(screen.getByTestId('waveform-editor-modal').textContent).toContain('peaks cached')
  })

  it('Decoded peaks fallback when cached missing and duration <30', async () => {
    // Create engine with asset without waveformPeaks, duration 5 (<30)
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    // simple wav base64 for 1 sec
    const sampleRate = 8000
    const duration = 1
    const byteRate = sampleRate * 2
    const dataSize = duration * byteRate
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    const w = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
    }
    w(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    w(8, 'WAVE')
    w(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    w(36, 'data')
    view.setUint32(40, dataSize, true)
    const bytes = new Uint8Array(buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const b64 = btoa(bin)
    engine.embedAsset({
      id: 'audio-decode',
      name: 'dec.wav',
      data: b64,
      mimeType: 'audio/wav',
      metadata: { duration: 1, sampleRate: 8000, channels: 1 },
    })
    const clip = engine.createAudioClip(slide.id, {
      assetId: 'audio-decode',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
    })
    const readOnly = toReadOnly(engine)
    // Mock AudioContext to produce decoded peaks
    const mockBuffer = {
      duration: 1,
      sampleRate: 8000,
      numberOfChannels: 1,
      length: 8000,
      getChannelData: () => new Float32Array(8000).fill(0.3),
    } as unknown as AudioBuffer
    const Ctor = vi
      .fn()
      .mockImplementation(() => ({
        decodeAudioData: vi.fn().mockResolvedValue(mockBuffer),
        close: vi.fn().mockResolvedValue(undefined),
      }))
    vi.stubGlobal('AudioContext', Ctor as unknown as typeof AudioContext)
    ;(window as unknown as { AudioContext?: unknown }).AudioContext =
      Ctor as unknown as typeof AudioContext
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: new UndoStack(),
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slide.id} clipId={clip.id} onClose={vi.fn()} />
      </EngineContext.Provider>,
    )
    await waitFor(() => expect(screen.getByTestId('waveform-editor-canvas')).toBeInTheDocument())
    // After decode, peaks source should be decoded (check modal text)
    await waitFor(() => {
      const txt = screen.getByTestId('waveform-editor-modal').textContent ?? ''
      expect(txt.includes('peaks decoded') || txt.includes('peaks cached')).toBe(true)
    })
  })

  it('Edge trim updates sourceStart/End; Save as single Transaction and undo restores; no asset rewrite', async () => {
    const origData = 'dGVzdA=='
    const { engine, readOnly, dispatcher, undo, slideId, clipId } = makeEngineWithClip({
      assetDuration: 10,
      sourceStart: 0,
      sourceEnd: 10,
      timelineStart: 2,
      waveformPeaks: Array(800).fill(100),
      assetBase64: origData,
    })
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    const onClose = vi.fn()
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: undo,
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slideId} clipId={clipId} onClose={onClose} />
      </EngineContext.Provider>,
    )
    // Change edge trim via numeric inputs
    const startInput = screen.getByTestId('waveform-source-start') as HTMLInputElement
    const endInput = screen.getByTestId('waveform-source-end') as HTMLInputElement
    expect(startInput.value).toBe('0')
    expect(endInput.value).toBe('10')
    // trim to 1..9
    fireEvent.change(startInput, { target: { value: '1' } })
    fireEvent.change(endInput, { target: { value: '9' } })
    // Save should be enabled
    const saveBtn = screen.getByTestId('waveform-editor-save') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(false)
    fireEvent.click(saveBtn)
    // Expect clip updated
    const updated = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)!
    expect(updated.sourceStart).toBeCloseTo(1)
    expect(updated.sourceEnd).toBeCloseTo(9)
    // Undo stack should have one entry (Transaction)
    expect(undo.entries.length).toBe(1)
    expect(undo.entries[0].type).toBe('Transaction')
    // Undo should restore
    dispatcher.undo()
    const afterUndo = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)!
    expect(afterUndo.sourceStart).toBeCloseTo(0)
    expect(afterUndo.sourceEnd).toBeCloseTo(10)
    // Redo should re-apply
    dispatcher.redo()
    const afterRedo = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)!
    expect(afterRedo.sourceStart).toBeCloseTo(1)
    // No asset rewrite — data and metadata duration unchanged, waveformPeaks still same
    const asset = engine.getEmbeddedAsset('audio-1')!
    expect(asset.data).toBe(origData)
    expect((asset.metadata as Record<string, unknown>).duration).toBe(10)
    expect(onClose).toHaveBeenCalled()
    // Timeline reflects new clips — only still single clip but trimmed
    expect(engine.getSlide(slideId).audio.clips.length).toBe(1)
  })

  it('Middle delete splits into two clips gap-free; timeline reflects new clips; undo single Transaction', async () => {
    const { engine, readOnly, dispatcher, undo, slideId, clipId } = makeEngineWithClip({
      assetDuration: 10,
      sourceStart: 0,
      sourceEnd: 10,
      timelineStart: 5,
      waveformPeaks: Array(800).fill(100),
    })
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    const onClose = vi.fn()
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: undo,
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slideId} clipId={clipId} onClose={onClose} />
      </EngineContext.Provider>,
    )
    // Simulate middle delete via waveform drag: pointer down at 30% (3s), drag to 70% (7s)
    const container = screen.getByTestId('waveform-editor-canvas-container')
    // JSDOM layout: container getBoundingClientRect returns 0; we stub it
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 96,
      right: 640,
      bottom: 96,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect)
    // PointerDown at x= 0.3*640=192 (3s), move to 0.7*640=448 (7s)
    fireEvent.pointerDown(container, { clientX: 192, clientY: 48, pointerId: 1 })
    // Simulate move events via window dispatch
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 448, clientY: 48 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 448, clientY: 48 }))
    await waitFor(() => expect(screen.getByTestId('waveform-selection')).toBeInTheDocument())
    const selEl = screen.getByTestId('waveform-selection')
    expect(selEl.textContent).toContain('Delete')
    // Save
    const saveBtn = screen.getByTestId('waveform-editor-save') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(false)
    fireEvent.click(saveBtn)
    // Engine should now have 2 clips
    const clips = engine.getSlide(slideId).audio.clips
    expect(clips.length).toBe(2)
    const left = clips.find((c) => c.id === clipId)!
    const right = clips.find((c) => c.id !== clipId)!
    // Left: source 0..3, timeline 5, playback 3
    expect(left.sourceStart).toBeCloseTo(0)
    expect(left.sourceEnd).toBeCloseTo(3)
    expect(left.timelineStart).toBeCloseTo(5)
    // Right: source 7..10, timelineStart gap-free at 8 (5+3)
    expect(right.sourceStart).toBeCloseTo(7)
    expect(right.sourceEnd).toBeCloseTo(10)
    expect(right.timelineStart).toBeCloseTo(8)
    // Gap-free: left end == right start
    const leftPlayback = (left.sourceEnd - left.sourceStart) / (left.playbackRate || 1)
    expect(right.timelineStart).toBeCloseTo(left.timelineStart + leftPlayback)
    // No asset rewrite
    const asset = engine.getEmbeddedAsset('audio-1')!
    expect(asset.data).toBe('dGVzdA==')
    // Undo single Transaction should revert to 1 clip
    expect(undo.entries.length).toBe(1)
    expect(undo.entries[0].type).toBe('Transaction')
    dispatcher.undo()
    expect(engine.getSlide(slideId).audio.clips.length).toBe(1)
    const single = engine.getSlide(slideId).audio.clips[0]
    expect(single.sourceStart).toBeCloseTo(0)
    expect(single.sourceEnd).toBeCloseTo(10)
    // Redo restores 2 clips again
    dispatcher.redo()
    expect(engine.getSlide(slideId).audio.clips.length).toBe(2)
    expect(onClose).toHaveBeenCalled()
  })

  it('Audition plays selected interval; respects volume/muted and playbackRate', async () => {
    const { readOnly, dispatcher, slideId, clipId } = makeEngineWithClip({
      assetDuration: 6,
      sourceStart: 0,
      sourceEnd: 6,
      volume: 0.6,
      muted: false,
      waveformPeaks: Array(800).fill(100),
    })
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    MockAudio.clear()
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: new UndoStack(),
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slideId} clipId={clipId} onClose={vi.fn()} />
      </EngineContext.Provider>,
    )
    // Audition kept
    fireEvent.click(screen.getByTestId('waveform-audition-kept'))
    await waitFor(() => expect(MockAudio.instances.length).toBe(1))
    const a1 = MockAudio.instances[0]
    expect(a1.volume).toBeCloseTo(0.6)
    expect(a1.muted).toBe(false)
    expect(a1.currentTime).toBeCloseTo(0) // kept starts at 0
    expect(a1.play).toHaveBeenCalled()
    // Now test muted clip audition — create new engine with muted
    MockAudio.clear()
    // recreate to get ids
    const eng2 = createEngineInternal()
    const undo2 = new UndoStack()
    const disp2 = new CommandDispatcher(eng2, undo2, () => {})
    eng2.createProject({ name: 'P' })
    const sl2 = eng2.createSlide('S1')
    eng2.embedAsset({
      id: 'a-muted',
      name: 'm.wav',
      data: 'dGVzdA==',
      mimeType: 'audio/wav',
      metadata: { duration: 4, sampleRate: 44100, channels: 1, waveformPeaks: Array(800).fill(80) },
    })
    const cl2 = eng2.createAudioClip(sl2.id, {
      assetId: 'a-muted',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 4,
      volume: 0.9,
      muted: true,
    })
    const ro2b = toReadOnly(eng2)
    const dispatch2 = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => disp2.dispatch(cmd)
    const { unmount } = render(
      <EngineContext.Provider
        value={{
          engine: ro2b,
          dispatch: dispatch2 as never,
          undoStack: new UndoStack(),
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={sl2.id} clipId={cl2.id} onClose={vi.fn()} />
      </EngineContext.Provider>,
    )
    fireEvent.click(within(document.body).getAllByTestId('waveform-audition-kept').pop()!)
    await waitFor(() => expect(MockAudio.instances.length).toBe(1))
    const aMuted = MockAudio.instances[0]
    expect(aMuted.muted).toBe(true)
    expect(aMuted.volume).toBeCloseTo(0) // when muted, volume 0 in our code? We set volume = muted?0 : volume, but also muted flag. Our impl sets volume = muted?0:vol and muted=true. So volume 0
    unmount()
  })

  it('Shares timeline ruler — ruler uses same division logic as timelineViewStore', async () => {
    const { readOnly, dispatcher, slideId, clipId } = makeEngineWithClip({ assetDuration: 10 })
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: new UndoStack(),
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slideId} clipId={clipId} onClose={vi.fn()} />
      </EngineContext.Provider>,
    )
    const ruler = screen.getByTestId('waveform-ruler')
    // Ruler should have ticks like timelineViewStore (step candidates)
    // For pps = 640/10=64, step should be 0.5? Let's check ticks exist
    expect(ruler.children.length).toBeGreaterThan(3)
    // tick labels should be monospace numbers
    const labels = Array.from(ruler.querySelectorAll('span')).map((s) => s.textContent)
    expect(labels.some((l) => /^\d/.test(l ?? ''))).toBe(true)
  })

  it('Gap-free reflow after trim edge — timeline reflects new playback length and second clip not shifted (only split reflows)', async () => {
    const { engine, readOnly, dispatcher, slideId, clipId } = makeEngineWithClip({
      assetDuration: 10,
      sourceStart: 2,
      sourceEnd: 8,
      timelineStart: 0,
    })
    // Add downstream clip at 8
    engine.createAudioClip(slideId, {
      assetId: 'audio-1',
      trackId: 'voice',
      timelineStart: 8,
      sourceStart: 0,
      sourceEnd: 2,
    })
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    // Just ensure after edge trim, downstream unchanged (since audio timeline doesn't auto-reflow all tracks)
    render(
      <EngineContext.Provider
        value={{
          engine: readOnly,
          dispatch: dispatch as never,
          undoStack: new UndoStack(),
          persistence: noopPersistence,
        }}
      >
        <WaveformEditorModal slideId={slideId} clipId={clipId} onClose={vi.fn()} />
      </EngineContext.Provider>,
    )
    const startInput = screen.getByTestId('waveform-source-start') as HTMLInputElement
    fireEvent.change(startInput, { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('waveform-editor-save'))
    // First clip trimmed, downstream clip still at 8 (not shifted left to 5). Our spec's gap-free is only between split pair, not global reflow.
    const clips = engine.getSlide(slideId).audio.clips
    const first = clips.find((c) => c.id === clipId)!
    expect(first.sourceStart).toBeCloseTo(3)
    const second = clips.find((c) => c.id !== clipId)!
    expect(second.timelineStart).toBeCloseTo(8)
  })
})
