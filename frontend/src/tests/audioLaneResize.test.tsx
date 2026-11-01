import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackController } from '../stores/playbackStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useAudioResizePreferenceStore } from '../stores/audioResizePreferenceStore'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { EngineContext } from '../app/engineContext'
import { toReadOnly } from '../engine/internal'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { noopPersistence } from './contextHarness'

describe('AudioTimelineBody — lane drags always time-stretch', () => {
  beforeEach(() => {
    localStorage.clear()
    useAudioResizePreferenceStore.setState({ preferences: { voice: null, sfx: null, music: null } })
    useAudioResizePreferenceStore.persist.clearStorage()
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    } as never)
    useTimelineViewStore.setState({
      zoomLevel: 1,
      scrollTime: 0,
      height: DEFAULT_TIMELINE_HEIGHT,
    })
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    useAudioResizePreferenceStore.setState({ preferences: { voice: null, sfx: null, music: null } })
    useAudioResizePreferenceStore.persist.clearStorage()
    // ensure next file's beforeEach sees clean state
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    } as never)
  })

  function renderAudioTimeline() {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const logger = vi.fn()
    const dispatcher = new CommandDispatcher(engine, undo, logger)
    const value = {
      engine: toReadOnly(engine),
      undoStack: undo,
      dispatch: (command: never) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    } as unknown as import('../app/engineContext').EngineContextValue
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'N')
    engine.embedAsset({
      id: 'a1',
      name: 'test.wav',
      data: 'data:audio/wav;base64,AAA=',
      mimeType: 'audio/wav',
      metadata: { duration: 4, sampleRate: 44100, channels: 1 },
    })
    engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
      playbackRate: 1,
    })
    render(
      <EngineContext.Provider value={value}>
        <TimelinePanel height={400} />
      </EngineContext.Provider>,
    )
    return { engine, undo, dispatcher }
  }

  function clipOf(engine: ReturnType<typeof createEngineInternal>) {
    return engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0]
  }

  it('plain drag stretches without any prompt, even with a saved trim default', async () => {
    const { engine } = renderAudioTimeline()
    const audioTab = await screen.findByTestId('timeline-tab-audio')
    fireEvent.click(audioTab)
    // A stale saved trim default (e.g. from a mismatch flow) must not hijack lane drags.
    useAudioResizePreferenceStore.getState().setPreference('voice', 'trim')

    const handle = await screen.findByTestId('audio-clip-handle-right')
    // pointerDown at x 100, move to 150 => dt 0.5s (pps 100)
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: false, shiftKey: false }),
    )
    await waitFor(() => {
      expect(clipOf(engine).playbackRate).not.toBe(1)
    })
    expect(clipOf(engine).playbackRate).toBeCloseTo(2 / 2.5, 6)
    expect(clipOf(engine).sourceEnd).toBe(2) // source preserved
    expect(screen.queryByTestId('audio-resize-dialog')).not.toBeInTheDocument()
  })

  it('Alt-drag stretches and Shift-drag trims without prompts', async () => {
    const { engine } = renderAudioTimeline()
    const audioTab = await screen.findByTestId('timeline-tab-audio')
    fireEvent.click(audioTab)
    const handle = await screen.findByTestId('audio-clip-handle-right')

    // Alt-drag forces stretch without prompt
    expect(clipOf(engine).playbackRate).toBe(1)
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: true, shiftKey: false }),
    )
    await waitFor(() => {
      expect(clipOf(engine).playbackRate).not.toBe(1)
    })
    expect(clipOf(engine).sourceEnd).toBe(2) // source preserved
    // reset for next
    engine.setAudioClipPlaybackRate(engine.getActiveSlide()!.id, clipOf(engine).id, 1)

    // Shift-drag is the explicit trim override
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: false, shiftKey: true }),
    )
    await waitFor(() => {
      expect(clipOf(engine).sourceEnd).toBeCloseTo(2.5, 5)
    })
    expect(clipOf(engine).playbackRate).toBe(1)
    expect(screen.queryByTestId('audio-resize-dialog')).not.toBeInTheDocument()
  })
})
