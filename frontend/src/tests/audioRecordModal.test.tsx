import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack, CreateAudioAssetCommand, CreateAudioClipCommand } from '../engine/commands'
import { RecordModal } from '../components/audio/RecordModal'
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

function mockStream() {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream
}

function mockMediaRecorderBlobs(blobs: Blob[]) {
  // Returns ctor that will produce recorder which on stop fires ondataavailable+onstop
  return class {
    state = 'inactive'
    ondataavailable: ((e: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    mimeType = 'audio/webm'
    stream: MediaStream
    constructor(stream: MediaStream) {
      this.stream = stream
    }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      // simulate data
      for (const blob of blobs) this.ondataavailable?.({ data: blob })
      this.onstop?.()
    }
  } as unknown as new (s: MediaStream, opts?: MediaRecorderOptions) => MediaRecorder
}

function wavBase64ForDuration(duration: number): string {
  // Create a minimal WAV header with given duration (sampleRate 44100, mono, 16-bit)
  const sampleRate = 44100
  const channels = 1
  const byteRate = sampleRate * channels * 2
  const dataSize = Math.round(duration * byteRate)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const write = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataSize, true)
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

describe('RecordModal seam + mocked getUserMedia/MediaRecorder/AudioContext', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', class {
      createAnalyser() { return { fftSize: 256, frequencyBinCount: 2, getByteFrequencyData: (arr: Uint8Array) => arr.fill(10), connect: () => {}, disconnect: () => {} } as unknown as AnalyserNode }
      createMediaStreamSource() { return { connect: () => {} } as unknown as MediaStreamAudioSourceNode }
      close() { return Promise.resolve() }
      decodeAudioData = () => Promise.resolve({ duration: 2.5, sampleRate: 44100, numberOfChannels: 1, length: 11025, getChannelData: () => new Float32Array(11025) } as unknown as AudioBuffer)
    } as unknown as typeof AudioContext)
    // Mock navigator.mediaDevices
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } } as unknown as Navigator)
  })

  it('error branch NotAllowedError shows denied+retry+system settings hint and stream cleanup', async () => {
    const { readOnly, slideId, partId } = makeEngineWithPrompter()
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: vi.fn() as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slideId} partId={partId} partText="Hello world" partStartTime={0} plannedDuration={2.0} onClose={vi.fn()} getUserMedia={getUserMedia} MediaRecorderCtor={mockMediaRecorderBlobs([]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-error')).toBeInTheDocument())
    expect(screen.getByTestId('record-error')).toHaveTextContent(/denied/i)
    expect(screen.getByTestId('record-error')).toHaveTextContent(/system settings/i)
    expect(screen.getByTestId('record-retry')).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalled()
  })

  it('error branch NotFoundError shows no-mic guidance', async () => {
    const { readOnly, slideId, partId } = makeEngineWithPrompter()
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('no device'), { name: 'NotFoundError' }))
    render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: vi.fn() as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slideId} partId={partId} partText="Hello" partStartTime={0} plannedDuration={2.0} onClose={vi.fn()} getUserMedia={getUserMedia} MediaRecorderCtor={mockMediaRecorderBlobs([]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-error')).toBeInTheDocument())
    expect(screen.getByTestId('record-error')).toHaveTextContent(/No microphone/i)
    expect(screen.getByTestId('record-error')).toHaveTextContent(/Connect a microphone/i)
  })

  it('teardown on close/abort cleans stream via stop tracks', async () => {
    const { readOnly, slideId, partId } = makeEngineWithPrompter()
    const stream = mockStream()
    const stopSpy = vi.fn()
    stream.getTracks = () => [{ stop: stopSpy } as unknown as MediaStreamTrack]
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    const onClose = vi.fn()
    render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: vi.fn() as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slideId} partId={partId} partText="Hello" partStartTime={0} plannedDuration={2.0} onClose={onClose} getUserMedia={getUserMedia} MediaRecorderCtor={mockMediaRecorderBlobs([new Blob(['x'], { type: 'audio/webm' })]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-stop')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('record-cancel'))
    expect(stopSpy).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('meter via AnalyserNode bar meter exists and text read-only', async () => {
    const { readOnly, slideId, partId } = makeEngineWithPrompter('My text is readonly', 1.5)
    const getUserMedia = vi.fn().mockResolvedValue(mockStream())
    render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: vi.fn() as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slideId} partId={partId} partText="My text is readonly" partStartTime={0} plannedDuration={1.5} onClose={vi.fn()} getUserMedia={getUserMedia} MediaRecorderCtor={mockMediaRecorderBlobs([new Blob(['x'], { type: 'audio/webm' })]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    expect(screen.getByTestId('record-meter')).toBeInTheDocument()
    expect(screen.getAllByText(/My text is readonly/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('record-modal')).toBeInTheDocument()
  })

  it('record→asset→clip linkage: Stop produces asset+clip linked and status cleared', async () => {
    const { engine, readOnly, dispatcher, slideId, partId } = makeEngineWithPrompter('Hello world', 2.5)
    // make part stale to test clearing
    engine.getSlide(slideId).prompter!.parts[0].status = 'stale'
    const base64 = wavBase64ForDuration(2.5)
    const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'audio/wav' })
    const getUserMedia = vi.fn().mockResolvedValue(mockStream())
    const MediaRecorderCtor = mockMediaRecorderBlobs([blob])
    const onClose = vi.fn()
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: dispatch as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slideId} partId={partId} partText="Hello world" partStartTime={0} plannedDuration={2.5} onClose={onClose} getUserMedia={getUserMedia} MediaRecorderCtor={MediaRecorderCtor as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-stop')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('record-stop'))
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    const part = engine.getSlide(slideId).prompter!.parts[0]
    expect(part.audioClipId).toBeDefined()
    expect(part.audioAssetId).toBeDefined()
    expect(part.status).toBeUndefined()
    const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === part.audioClipId)
    expect(clip).toBeDefined()
    expect(clip!.trackId).toBe('voice')
    expect(clip!.timelineStart).toBe(0)
    const asset = engine.getEmbeddedAsset(part.audioAssetId!)
    expect(asset).toBeDefined()
    expect(asset!.mimeType).toContain('audio')
  })

  it('mismatch dialog shows for longer/shorter and Speed/Slow sets playbackRate', async () => {
    const { engine, readOnly, dispatcher, slideId, partId } = makeEngineWithPrompter('Hello', 2.0)
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    // Longer: recorded 3.0 vs planned 2.0 => threshold 0.3 => mismatch longer
    const base64Long = wavBase64ForDuration(3.0)
    const blobLong = new Blob([Uint8Array.from(atob(base64Long), (c) => c.charCodeAt(0))], { type: 'audio/wav' })
    // Mock AudioContext to decode to 3.0 duration
    vi.stubGlobal('AudioContext', class {
      createAnalyser() { return { fftSize: 256, frequencyBinCount: 2, getByteFrequencyData: (a: Uint8Array) => a.fill(10), connect: () => {}, disconnect: () => {} } as unknown as AnalyserNode }
      createMediaStreamSource() { return { connect: () => {} } as unknown as MediaStreamAudioSourceNode }
      close() { return Promise.resolve() }
      decodeAudioData = () => Promise.resolve({ duration: 3.0, sampleRate: 44100, numberOfChannels: 1, length: 132300, getChannelData: () => new Float32Array(132300) } as unknown as AudioBuffer)
    } as unknown as typeof AudioContext)
    const getUserMediaLong = vi.fn().mockResolvedValue(mockStream())
    const onCloseLong = vi.fn()
    const { unmount } = render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: dispatch as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slideId} partId={partId} partText="Hello" partStartTime={0} plannedDuration={2.0} onClose={onCloseLong} getUserMedia={getUserMediaLong} MediaRecorderCtor={mockMediaRecorderBlobs([blobLong]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-stop')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('record-stop'))
    await waitFor(() => expect(screen.getByTestId('mismatch-dialog')).toBeInTheDocument())
    expect(screen.getByTestId('mismatch-speed-up')).toBeInTheDocument()
    expect(screen.getByTestId('mismatch-extend')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mismatch-speed-up'))
    await waitFor(() => expect(onCloseLong).toHaveBeenCalled())
    const partLong = engine.getSlide(slideId).prompter!.parts[0]
    const clipLong = engine.getSlide(slideId).audio.clips.find((c) => c.id === partLong.audioClipId)
    expect(clipLong!.playbackRate).toBeCloseTo(2.0 / 3.0)
    unmount()
    // Shorter: recorded 1.0 vs planned 2.0
    const engine2 = createEngineInternal()
    const undo2 = new UndoStack()
    const disp2 = new CommandDispatcher(engine2, undo2, () => {})
    engine2.createProject({ name: 'P2' })
    const slide2 = engine2.createSlide('S1')
    engine2.createPrompterPart(slide2.id, { id: 'p1', text: 'Hello', duration: 2.0 })
    const readOnly2 = toReadOnly(engine2)
    const dispatch2 = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => disp2.dispatch(cmd)
    vi.stubGlobal('AudioContext', class {
      createAnalyser() { return { fftSize: 256, frequencyBinCount: 2, getByteFrequencyData: (a: Uint8Array) => a.fill(10), connect: () => {}, disconnect: () => {} } as unknown as AnalyserNode }
      createMediaStreamSource() { return { connect: () => {} } as unknown as MediaStreamAudioSourceNode }
      close() { return Promise.resolve() }
      decodeAudioData = () => Promise.resolve({ duration: 1.0, sampleRate: 44100, numberOfChannels: 1, length: 44100, getChannelData: () => new Float32Array(44100) } as unknown as AudioBuffer)
    } as unknown as typeof AudioContext)
    const base64Short = wavBase64ForDuration(1.0)
    const blobShort = new Blob([Uint8Array.from(atob(base64Short), (c) => c.charCodeAt(0))], { type: 'audio/wav' })
    const getUserMediaShort = vi.fn().mockResolvedValue(mockStream())
    const onCloseShort = vi.fn()
    render(
      <EngineContext.Provider value={{ engine: readOnly2, undoStack: new UndoStack(), dispatch: dispatch2 as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slide2.id} partId="p1" partText="Hello" partStartTime={0} plannedDuration={2.0} onClose={onCloseShort} getUserMedia={getUserMediaShort} MediaRecorderCtor={mockMediaRecorderBlobs([blobShort]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-stop')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('record-stop'))
    await waitFor(() => expect(screen.getByTestId('mismatch-dialog')).toBeInTheDocument())
    expect(screen.getByTestId('mismatch-slow-down')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mismatch-slow-down'))
    await waitFor(() => expect(onCloseShort).toHaveBeenCalled())
    const partShort = engine2.getSlide(slide2.id).prompter!.parts[0]
    const clipShort = engine2.getSlide(slide2.id).audio.clips.find((c) => c.id === partShort.audioClipId)
    expect(clipShort!.playbackRate).toBeCloseTo(2.0)
  })

  it('mismatch Extend/Keep with shift checkbox moves downstream', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'First', duration: 2.0 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'Second', duration: 2.0 })
    // downstream clip at 3.5
    const base = btoa('x')
    const aRes = dispatcher.dispatch(new CreateAudioAssetCommand({ name: 'x', data: base, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
    const assetId = (aRes.inverse as { assetId: string }).assetId
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'voice', timelineStart: 3.5, sourceEnd: 1 }))
    const readOnly = toReadOnly(engine)
    const dispatch = (cmd: Parameters<CommandDispatcher['dispatch']>[0]) => dispatcher.dispatch(cmd)
    vi.stubGlobal('AudioContext', class {
      createAnalyser() { return { fftSize: 256, frequencyBinCount: 2, getByteFrequencyData: (a: Uint8Array) => a.fill(10), connect: () => {}, disconnect: () => {} } as unknown as AnalyserNode }
      createMediaStreamSource() { return { connect: () => {} } as unknown as MediaStreamAudioSourceNode }
      close() { return Promise.resolve() }
      decodeAudioData = () => Promise.resolve({ duration: 3.0, sampleRate: 44100, numberOfChannels: 1, length: 132300, getChannelData: () => new Float32Array(132300) } as unknown as AudioBuffer)
    } as unknown as typeof AudioContext)
    const base64 = wavBase64ForDuration(3.0)
    const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'audio/wav' })
    const getUserMedia = vi.fn().mockResolvedValue(mockStream())
    const onClose = vi.fn()
    render(
      <EngineContext.Provider value={{ engine: readOnly, undoStack: new UndoStack(), dispatch: dispatch as unknown as never, persistence: noopPersistence }}>
        <RecordModal slideId={slide.id} partId="p1" partText="First" partStartTime={0} plannedDuration={2.0} onClose={onClose} getUserMedia={getUserMedia} MediaRecorderCtor={mockMediaRecorderBlobs([blob]) as unknown as never} AudioContextCtor={globalThis.AudioContext as unknown as never} />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('record-start'))
    await waitFor(() => expect(screen.getByTestId('record-stop')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('record-stop'))
    await waitFor(() => expect(screen.getByTestId('mismatch-dialog')).toBeInTheDocument())
    // Check shift checkbox and click Extend
    const shiftCb = screen.getByTestId('mismatch-shift-checkbox') as HTMLInputElement
    fireEvent.click(shiftCb)
    expect(shiftCb.checked).toBe(true)
    fireEvent.click(screen.getByTestId('mismatch-extend'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Downstream part should have shifted by +1
    expect(engine.getSlide(slide.id).prompter!.parts[1].startTime).toBeCloseTo(3.0)
    const clip = engine.getSlide(slide.id).audio.clips.find((c) => c.timelineStart === 4.5)
    expect(clip).toBeDefined()
  })
})
