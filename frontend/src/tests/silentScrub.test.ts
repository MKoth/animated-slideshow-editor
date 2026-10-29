import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { SyncedAudioController, type AudioContextLike } from '../audio/syncedAudioController'
import { usePlaybackController } from '../stores/playbackStore'
import { useAudioPlaybackStore } from '../stores/audioPlaybackStore'

function mockAudioContextFactory() {
  const createdSources: Array<{ started: boolean }> = []
  const mockCtx: AudioContextLike = {
    currentTime: 0,
    state: 'running' as const,
    async resume() {},
    createBufferSource() {
      const source = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: vi.fn(() => {
          createdSources.push({ started: true })
        }),
        stop: vi.fn(),
        disconnect: vi.fn(),
      }
      return source as unknown as import('../audio/syncedAudioController').AudioBufferSourceNodeLike
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

const fakeBase64 = btoa('RIFF....WAVEfake')

function slideWithVoiceClip() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  engine.setSlideDuration(slide.id, 5)
  engine.embedAsset({
    id: 'a1',
    name: 'test.wav',
    data: fakeBase64,
    mimeType: 'audio/wav',
    metadata: { duration: 1, sampleRate: 44100, channels: 1 },
  })
  engine.createAudioClip(slide.id, {
    assetId: 'a1',
    trackId: 'voice',
    timelineStart: 0,
    sourceStart: 0,
    sourceEnd: 1,
    volume: 1,
  })
  return { engine, slide }
}

describe('silent scrub: seeking never produces sound', () => {
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

  it('manual drag across a clip schedules nothing and sets no audition state', async () => {
    const { engine, slide } = slideWithVoiceClip()
    const { mockCtx, createdSources } = mockAudioContextFactory()
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: () => mockCtx,
    })
    controller.attach()
    const auditionSpy = vi.spyOn(useAudioPlaybackStore.getState(), 'setAuditioning')

    // Drag the playhead through the clip while stopped.
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      usePlaybackController.getState().setCurrentTime(slide.id, t, 5)
      vi.advanceTimersByTime(50)
    }
    // Settle well past any debounce window.
    vi.advanceTimersByTime(5000)

    expect(createdSources).toHaveLength(0)
    expect(controller.scheduledHistory).toHaveLength(0)
    expect(auditionSpy).not.toHaveBeenCalled()
    expect(useAudioPlaybackStore.getState().auditionClipId).toBeNull()

    controller.detach()
  })

  it('rapid export-style seeking across frames stays silent', async () => {
    const { engine, slide } = slideWithVoiceClip()
    const { mockCtx, createdSources } = mockAudioContextFactory()
    const controller = new SyncedAudioController({
      engine: engine as unknown as import('../engine').EnginePublic,
      getAudioContext: () => mockCtx,
    })
    controller.attach()

    // 30 fps-style frame walk, like ExportVideoDialog capture.
    for (let i = 0; i < 30; i++) {
      usePlaybackController.getState().setCurrentTime(slide.id, i / 30, 5)
    }
    vi.advanceTimersByTime(5000)

    expect(createdSources).toHaveLength(0)
    expect(controller.scheduledHistory).toHaveLength(0)
    expect(useAudioPlaybackStore.getState().auditionClipId).toBeNull()

    controller.detach()
  })
})
