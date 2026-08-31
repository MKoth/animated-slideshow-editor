import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { SyncedAudioController, type AudioContextLike } from '../audio/syncedAudioController'
import { usePlaybackController } from '../stores/playbackStore'
import { useAudioPlaybackStore } from '../stores/audioPlaybackStore'

function mockAudioContextFactory() {
  let currentTime = 0
  const createdSources: Array<{ buffer: unknown | null; started: boolean; when?: number; offset?: number; duration?: number }> = []
  const mockBuffer = {
    duration: 1,
    sampleRate: 44100,
    numberOfChannels: 1,
    length: 44100,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer
  const mockCtx: AudioContextLike = {
    get currentTime() { return currentTime },
    state: 'suspended' as const,
    async resume() { (mockCtx as unknown as { state: string }).state = 'running'; return },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async decodeAudioData(_buf: ArrayBuffer) { return mockBuffer },
    createBufferSource() {
      const source: import('../audio/syncedAudioController').AudioBufferSourceNodeLike = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start(when?: number, offset?: number, duration?: number) {
          ;(source as unknown as { _started: boolean })._started = true
          createdSources.push({ buffer: source.buffer, started: true, when, offset, duration })
        },
        stop: vi.fn(),
        disconnect: vi.fn(),
      }
      return source
    },
    createGain() {
      return {
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as import('../audio/syncedAudioController').AudioBufferSourceNodeLike extends unknown ? never : import('../audio/syncedAudioController').GainNodeLike
    },
    destination: {},
  }
  return { mockCtx, createdSources, mockBuffer, advance: (dt: number) => { currentTime += dt } }
}

// minimal WAV base64 placeholder — not decoded in this test, we mock buffer
const fakeBase64 = btoa('RIFF....WAVEfake')

describe('Phase1: Audio Playback No-Sound Repro (tight loop)', () => {
  beforeEach(() => {
    usePlaybackController.setState({ currentTimes: {}, status: 'stopped', playbackSpeed: 1, loopEnabled: false } as never)
    useAudioPlaybackStore.setState({ mutedTracks: new Set(), soloTracks: new Set() } as never)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('RED-CAPABLE: Play at 0 with one voice clip should schedule audible buffer — but cache empty yields silent', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 5)
    // Embed audio asset with duration 1
    engine.embedAsset({ id: 'a1', name: 'test.wav', data: fakeBase64, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } })
    engine.createAudioClip(slide.id, { assetId: 'a1', trackId: 'voice', timelineStart: 0, sourceStart: 0, sourceEnd: 1, volume: 1 })
    // Import succeeded, clip at 0..1
    const clip = engine.getSlide(slide.id).audio.clips[0]
    expect(clip).toBeDefined()

    const { mockCtx, createdSources } = mockAudioContextFactory()
    const factory = vi.fn(() => mockCtx)
    const perfNow = 1000
    const getPerf = () => perfNow

    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: factory,
      getPerformanceNow: getPerf,
      lookahead: 0.1,
      tickMs: 25,
    })
    controller.attach()
    // Simulate user Play at time 0 — should resume context and schedule
    usePlaybackController.setState({ status: 'playing' } as never)
    usePlaybackController.getState().setCurrentTime(slide.id, 0, 5)
    // Directly invoke handlePlay (simulates PlaybackStarted event)
    await controller.handlePlay(slide.id, 0)
    // Tick was called immediately inside handlePlay; we also force another tick
    // Scheduler is interval-based, but we can call tick via advancing timers
    vi.advanceTimersByTime(30)
    // Expectations: factory should have been called, context resumed, clip scheduled
    expect(factory).toHaveBeenCalled()
    // BUG REPRO: cache is empty → source.buffer is null → silent
    // scheduledHistory will contain entry even though buffer null (silent)
    const history = controller.scheduledHistory
    // Controller thinks it scheduled, but actual audio buffer missing
    // This is the bug: length 1 but cached buffer missing → no sound
    // Tight signal: assert that audible scheduling had a real buffer
    const cacheHas = controller.cache.has('a1')
    const createdBuffer = createdSources[0]?.buffer ?? null
    // These should be truthy for audible playback; currently they are falsy → test goes RED
    // We assert RED-capable: expect cache hit and buffer assigned
    expect(cacheHas, 'cache should have decoded buffer for asset a1 before playback (bug: empty cache)').toBe(true)
    expect(createdBuffer, 'AudioBufferSource buffer should be set (bug: null buffer → silent)').not.toBeNull()
    expect(history.length, 'scheduler should have scheduled 1 clip in lookahead').toBe(1)

    controller.detach()
  })

  it('RED-CAPABLE: getAudioContext factory should be singleton, not new per call', async () => {
    // Simulate useSyncedAudio default factory bug: each call creates new AudioContext
    // Controller should memoize so handlePlay and tick share same instance even if factory is buggy
    const factory = vi.fn(() => {
      return {
        currentTime: 0,
        state: 'running',
        resume: async () => {},
        createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect: () => {}, start: () => {}, stop: () => {} } as unknown as import('../audio/syncedAudioController').AudioBufferSourceNodeLike),
        createGain: () => ({ gain: { value: 1 }, connect: () => {} } as unknown as import('../audio/syncedAudioController').GainNodeLike),
        destination: {},
      } as AudioContextLike
    })
    const engine = createEngineInternal()
    engine.createProject({ name: 'P2' })
    const slide = engine.createSlide('S2')
    engine.embedAsset({ id: 'a2', name: 'x.wav', data: fakeBase64, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } })
    engine.createAudioClip(slide.id, { assetId: 'a2', trackId: 'voice', timelineStart: 0, sourceStart: 0, sourceEnd: 1 })
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: factory,
      lookahead: 0.1,
      tickMs: 25,
    })
    // Call getCtx twice via private accessor — should return same instance due to memoization
    const ctx1 = (controller as unknown as { getCtx: () => AudioContextLike | null }).getCtx()
    const ctx2 = (controller as unknown as { getCtx: () => AudioContextLike | null }).getCtx()
    expect(ctx1, 'Controller should memoize AudioContext — bug returns new each call').toBe(ctx2)
    // Factory should have been called only once due to memoization
    expect(factory).toHaveBeenCalledTimes(1)
    // Also verify handlePlay does not create second context
    usePlaybackController.setState({ status: 'playing' } as never)
    await controller.handlePlay(slide.id, 0)
    expect(factory).toHaveBeenCalledTimes(1)
    controller.detach()
  })
})
