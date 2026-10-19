import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { SyncedAudioController, type AudioContextLike } from '../audio/syncedAudioController'
import { usePlaybackController } from '../stores/playbackStore'
import { useAudioPlaybackStore } from '../stores/audioPlaybackStore'

const fakeBase64 = btoa('RIFF....WAVEfake')

interface MockCtx {
  mockCtx: AudioContextLike
  createdSources: Array<{
    buffer: unknown | null
    when?: number
    offset?: number
    duration?: number
  }>
  advance: (dt: number) => void
}

/** Mock AudioContext whose decode can simulate wall-clock progress during preload. */
function mockAudioContextFactory(onDecode?: () => void): MockCtx {
  let currentTime = 0
  const createdSources: MockCtx['createdSources'] = []
  const mockBuffer = {
    duration: 1,
    sampleRate: 44100,
    numberOfChannels: 1,
    length: 44100,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer
  const mockCtx: AudioContextLike = {
    get currentTime() {
      return currentTime
    },
    state: 'suspended' as const,
    async resume() {
      ;(mockCtx as unknown as { state: string }).state = 'running'
    },
    async decodeAudioData() {
      onDecode?.()
      return mockBuffer
    },
    createBufferSource() {
      const source: import('../audio/syncedAudioController').AudioBufferSourceNodeLike = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start(when?: number, offset?: number, duration?: number) {
          createdSources.push({
            buffer: source.buffer,
            started: true,
            when,
            offset,
            duration,
          } as unknown as MockCtx['createdSources'][number])
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
      } as unknown as import('../audio/syncedAudioController').GainNodeLike
    },
    destination: {},
  }
  return {
    mockCtx,
    createdSources,
    advance: (dt: number) => {
      currentTime += dt
    },
  }
}

describe('SyncedAudioController effect-audio sync (Spanish gender follow-up)', () => {
  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    } as never)
    useAudioPlaybackStore.setState({ mutedTracks: new Set(), soloTracks: new Set() } as never)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('re-anchors the audio base to the live playhead after a slow preload', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 5)
    engine.embedAsset({
      id: 'a1',
      name: 'sfx.wav',
      data: fakeBase64,
      mimeType: 'audio/wav',
      metadata: { duration: 1, sampleRate: 44100, channels: 1 },
    })
    // A 1s effect SFX starting at 0, like a script reveal sound.
    engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'sfx',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
      volume: 1,
    })

    // Both clocks advance 0.3s while the preload decode is in flight, exactly
    // like the playback store rAF advancing visuals during a real fetch+decode.
    const { mockCtx, advance } = mockAudioContextFactory(() => {
      advance(0.3)
      const state = usePlaybackController.getState()
      usePlaybackController.setState({ currentTimes: { ...state.currentTimes, [slide.id]: 0.3 } })
    })
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: () => mockCtx,
      lookahead: 0.1,
      tickMs: 25,
    })
    controller.attach()
    usePlaybackController.setState({ status: 'playing' } as never)
    usePlaybackController.getState().setCurrentTime(slide.id, 0, 5)

    // PlaybackStarted carries the event-time playhead (0), now stale.
    await controller.handlePlay(slide.id, 0)

    // Audio must anchor to the live visual playhead (0.3), not the stale event
    // time: the overlapped clip resumes mid-slice in sync instead of replaying
    // its head 0.3s behind the visible effect.
    expect(controller.getBaseTimes()?.basePlayhead).toBeCloseTo(0.3, 6)
    expect(controller.scheduledHistory).toHaveLength(1)
    const scheduled = controller.scheduledHistory[0]!
    expect(scheduled.when).toBeCloseTo(0.3, 6)
    expect(scheduled.offset).toBeCloseTo(0.3, 6)
    expect(scheduled.duration).toBeCloseTo(0.7, 6)
    controller.detach()
  })

  it('keeps an already-warm Play anchored to the event playhead', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 5)
    engine.embedAsset({
      id: 'a1',
      name: 'sfx.wav',
      data: fakeBase64,
      mimeType: 'audio/wav',
      metadata: { duration: 1, sampleRate: 44100, channels: 1 },
    })
    engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'sfx',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
      volume: 1,
    })

    const { mockCtx } = mockAudioContextFactory()
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: () => mockCtx,
      lookahead: 0.1,
      tickMs: 25,
    })
    controller.attach()
    usePlaybackController.setState({ status: 'playing' } as never)
    usePlaybackController.getState().setCurrentTime(slide.id, 0, 5)

    await controller.handlePlay(slide.id, 0)

    // No preload gap: live playhead still equals the event time, full slice.
    expect(controller.getBaseTimes()?.basePlayhead).toBeCloseTo(0, 6)
    expect(controller.scheduledHistory).toHaveLength(1)
    expect(controller.scheduledHistory[0]!.offset).toBeCloseTo(0, 6)
    expect(controller.scheduledHistory[0]!.duration).toBeCloseTo(1, 6)
    controller.detach()
  })

  it('warms the incoming slide buffers on slide switch', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slideA = engine.createSlide('SA')
    const slideB = engine.createSlide('SB')
    engine.embedAsset({
      id: 'a2',
      name: 'sfx.wav',
      data: fakeBase64,
      mimeType: 'audio/wav',
      metadata: { duration: 1, sampleRate: 44100, channels: 1 },
    })
    engine.createAudioClip(slideB.id, {
      assetId: 'a2',
      trackId: 'sfx',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
      volume: 1,
    })

    const { mockCtx } = mockAudioContextFactory()
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: () => mockCtx,
      lookahead: 0.1,
      tickMs: 25,
    })
    controller.attach()
    expect(controller.cache.has('a2')).toBe(false)

    controller.handleSlideSwitch(slideB.id)
    // Flush the fire-and-forget warm-decode microtask chain.
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(controller.cache.has('a2')).toBe(true)
    expect(slideA.id).toBeTruthy()
    controller.detach()
  })
})
