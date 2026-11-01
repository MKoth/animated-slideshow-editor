import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { SetAudioClipPlaybackRateCommand } from '../engine/commands/setAudioClipPlaybackRateCommand'
import {
  computeAudioClipStretchPlaybackRate,
  getAudioClipPlaybackDuration,
} from '../engine/audioClip'
import { SyncedAudioController, type AudioContextLike } from '../audio/syncedAudioController'
import { __setMockStretch } from '../audio/timeStretch'
import { usePlaybackController } from '../stores/playbackStore'
import { useAudioPlaybackStore } from '../stores/audioPlaybackStore'

const fakeBase64 = btoa('RIFF....WAVEfake')

function mockAudioContextFactory() {
  const currentTime = 0
  const createdSources: Array<{ buffer: unknown | null; offset?: number; duration?: number }> = []
  const mockBuffer = {
    duration: 4,
    sampleRate: 44100,
    numberOfChannels: 1,
    length: 44100 * 4,
    getChannelData: () => new Float32Array(44100 * 4),
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
      return mockBuffer
    },
    createBufferSource() {
      const source: import('../audio/syncedAudioController').AudioBufferSourceNodeLike = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start(_when?: number, offset?: number, duration?: number) {
          createdSources.push({ buffer: source.buffer, offset, duration })
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
  return { mockCtx, createdSources }
}

describe('voice lane stretch slows preview without pitch change', () => {
  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    } as never)
    useAudioPlaybackStore.setState({ mutedTracks: new Set(), soloTracks: new Set() } as never)
    __setMockStretch(async (buffer, timeRatio) => {
      // Pitch-preserving mock: wall duration scales, rate stays 1.
      return { ...buffer, duration: buffer.duration * timeRatio } as AudioBuffer
    })
    vi.useFakeTimers()
  })
  afterEach(() => {
    __setMockStretch(null)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('lane stretch +2s on a 4s voice clip schedules a 6s slowed wall slice', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 30)
    engine.embedAsset({
      id: 'a1',
      name: 'voice.wav',
      data: fakeBase64,
      mimeType: 'audio/wav',
      metadata: { duration: 4, sampleRate: 44100, channels: 1 },
    })
    const clip = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 4,
      playbackRate: 1,
    })

    // Exactly what AudioTimelineBody.applyStretch dispatches.
    const newRate = computeAudioClipStretchPlaybackRate(clip, 'right', 2)
    expect(newRate).toBeCloseTo(4 / 6, 6)
    const dispatcher = new CommandDispatcher(engine, new UndoStack(), () => {})
    const res = dispatcher.dispatch(
      new SetAudioClipPlaybackRateCommand({
        slideId: slide.id,
        clipId: clip.id,
        playbackRate: newRate!,
      }),
    )
    expect(res.ok).toBe(true)
    const after = engine.getSlide(slide.id).audio.clips.find((c) => c.id === clip.id)!
    expect(getAudioClipPlaybackDuration(after)).toBeCloseTo(6, 6)

    const { mockCtx } = mockAudioContextFactory()
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: () => mockCtx,
      lookahead: 0.1,
      tickMs: 25,
    })
    controller.attach()
    usePlaybackController.setState({ status: 'playing' } as never)
    usePlaybackController.getState().setCurrentTime(slide.id, 0, 30)
    await controller.handlePlay(slide.id, 0)
    for (let i = 0; i < 50; i++) await Promise.resolve()

    // The slowed voice must occupy 6 wall seconds at rate 1 (stretched buffer).
    expect(controller.scheduledHistory).toHaveLength(1)
    const scheduled = controller.scheduledHistory[0]!
    expect(scheduled.duration).toBeCloseTo(6, 4)
    expect(scheduled.playbackRate).toBe(1)
    controller.detach()
  })
})
