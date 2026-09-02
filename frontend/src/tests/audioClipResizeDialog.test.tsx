import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackController } from '../stores/playbackStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { AudioClipResizeDialog } from '../components/audio/AudioClipResizeDialog'
import { useAudioResizePreferenceStore } from '../stores/audioResizePreferenceStore'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { EngineContext } from '../app/engineContext'
import { toReadOnly } from '../engine/internal'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { noopPersistence } from './contextHarness'

function renderDialog(props: Partial<Parameters<typeof AudioClipResizeDialog>[0]> = {}) {
  const onChoice = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <AudioClipResizeDialog trackId="voice" onChoice={onChoice} onClose={onClose} {...props} />,
  )
  return { onChoice, onClose, ...utils }
}

describe('AudioClipResizeDialog — same copy as recording flow, Trim vs Stretch', () => {
  beforeEach(() => {
    localStorage.clear()
    useAudioResizePreferenceStore.setState({ preferences: { voice: null, sfx: null, music: null } })
    useAudioResizePreferenceStore.persist.clearStorage()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders Trim vs Time-stretch with correct copy', async () => {
    renderDialog({ trackId: 'voice' })
    expect(screen.getByTestId('audio-resize-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('audio-resize-trim')).toBeInTheDocument()
    expect(screen.getByTestId('audio-resize-stretch')).toBeInTheDocument()
    // Trim button copy hard cut
    expect(screen.getByTestId('audio-resize-trim')).toHaveTextContent(/Trim/i)
    expect(screen.getByTestId('audio-resize-trim')).toHaveTextContent(/sourceStart/i)
    // Stretch copy RubberBand and playbackRate
    expect(screen.getByTestId('audio-resize-stretch')).toHaveTextContent(/Time-stretch/i)
    expect(screen.getByTestId('audio-resize-stretch')).toHaveTextContent(/playbackRate/i)
    expect(screen.getByTestId('audio-resize-stretch')).toHaveTextContent(/RubberBand/i)
    // Original asset preserved copy — same as recording flow
    expect(screen.getByText(/Original WAV preserved/)).toBeInTheDocument()
    expect(screen.getByText(/AudioAsset bytes never rewritten/)).toBeInTheDocument()
    // Don't ask checkbox
    expect(screen.getByTestId('audio-resize-dont-ask')).toBeInTheDocument()
    expect(screen.getByLabelText(/Don't ask again for voice/)).toBeInTheDocument()
    // modifier hints
    expect(screen.getByText(/Alt-drag = stretch/)).toBeInTheDocument()
    expect(screen.getByText(/Shift-drag = trim/)).toBeInTheDocument()
  })

  it('Trim choice calls onChoice with trim and stores preference when checked', async () => {
    const { onChoice } = renderDialog({ trackId: 'sfx' })
    const checkbox = screen.getByTestId('audio-resize-dont-ask')
    fireEvent.click(checkbox)
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByTestId('audio-resize-trim'))
    expect(onChoice).toHaveBeenCalledWith('trim', true)
    expect(useAudioResizePreferenceStore.getState().getPreference('sfx')).toBe('trim')
  })

  it('Stretch choice with Dont ask stores stretch per-track', async () => {
    const { onChoice } = renderDialog({ trackId: 'music' })
    fireEvent.click(screen.getByTestId('audio-resize-dont-ask'))
    fireEvent.click(screen.getByTestId('audio-resize-stretch'))
    expect(onChoice).toHaveBeenCalledWith('stretch', true)
    expect(useAudioResizePreferenceStore.getState().getPreference('music')).toBe('stretch')
    // other tracks unaffected
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBeNull()
  })

  it("without Don't ask does not persist", async () => {
    const { onChoice } = renderDialog({ trackId: 'voice' })
    fireEvent.click(screen.getByTestId('audio-resize-stretch'))
    expect(onChoice).toHaveBeenCalledWith('stretch', false)
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBeNull()
  })

  it('Cancel calls onClose without persisting', async () => {
    const { onClose } = renderDialog({ trackId: 'voice' })
    fireEvent.click(screen.getByTestId('audio-resize-dont-ask'))
    fireEvent.click(screen.getByTestId('audio-resize-close'))
    expect(onClose).toHaveBeenCalled()
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBeNull()
  })
})

describe('AudioTimelineBody — resize modifiers and settings', () => {
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

  it('plain drag shows prompt, Alt forces stretch, Shift forces trim, pref bypasses prompt', async () => {
    const { engine } = renderAudioTimeline()
    const audioTab = await screen.findByTestId('timeline-tab-audio')
    fireEvent.click(audioTab)

    fireEvent.click(screen.getByTestId('audio-resize-settings'))
    expect(screen.getByTestId('audio-resize-settings-panel')).toBeInTheDocument()
    expect(screen.getByTestId('audio-resize-pref-voice')).toHaveTextContent('ask')
    useAudioResizePreferenceStore.getState().setPreference('voice', 'stretch')
    await waitFor(() => {
      expect(screen.getByTestId('audio-resize-pref-voice')).toHaveTextContent('stretch')
    })
    const resetBtn = screen.getByTestId('audio-resize-reset')
    expect(resetBtn).toBeEnabled()
    fireEvent.click(resetBtn)
    await waitFor(() => {
      expect(screen.getByTestId('audio-resize-pref-voice')).toHaveTextContent('ask')
    })
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBeNull()

    // plain drag should show dialog
    const handle = await screen.findByTestId('audio-clip-handle-right')
    // pointerDown at x 100, move to 150 => dt 0.5s (pps 100)
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: false, shiftKey: false }),
    )
    await waitFor(() => {
      expect(screen.getByTestId('audio-resize-dialog')).toBeInTheDocument()
    })
    // cancel dialog
    fireEvent.click(screen.getByTestId('audio-resize-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('audio-resize-dialog')).not.toBeInTheDocument()
    })
    // Alt-drag forces stretch without prompt
    expect(engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].playbackRate).toBe(1)
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: true, shiftKey: false }),
    )
    await waitFor(() => {
      expect(screen.queryByTestId('audio-resize-dialog')).not.toBeInTheDocument()
    })
    expect(engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].playbackRate).not.toBe(1)
    expect(engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].sourceEnd).toBe(2) // source preserved
    // reset for next
    engine.setAudioClipPlaybackRate(
      engine.getActiveSlide()!.id,
      engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].id,
      1,
    )

    // Shift-drag forces trim without prompt
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: false, shiftKey: true }),
    )
    await waitFor(() => {
      expect(screen.queryByTestId('audio-resize-dialog')).not.toBeInTheDocument()
    })
    expect(engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].sourceEnd).toBeCloseTo(
      2.5,
      5,
    )
    expect(engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].playbackRate).toBe(1)
    // reset trim
    engine.trimAudioClip(
      engine.getActiveSlide()!.id,
      engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].id,
      {
        sourceEnd: 2,
      },
    )

    // pref bypasses prompt: set pref to trim, plain drag should apply trim without dialog
    useAudioResizePreferenceStore.getState().setPreference('voice', 'trim')
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }))
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 150, altKey: false, shiftKey: false }),
    )
    await waitFor(() => {
      expect(screen.queryByTestId('audio-resize-dialog')).not.toBeInTheDocument()
    })
    expect(engine.getSlide(engine.getActiveSlide()!.id).audio.clips[0].sourceEnd).toBeCloseTo(
      2.5,
      5,
    )
    useAudioResizePreferenceStore.getState().clearAll()
  })

  it('per-track settings clear single track', async () => {
    const { engine } = renderAudioTimeline()
    void engine
    const audioTab = await screen.findByTestId('timeline-tab-audio')
    fireEvent.click(audioTab)
    fireEvent.click(screen.getByTestId('audio-resize-settings'))
    useAudioResizePreferenceStore.getState().setPreference('sfx', 'trim')
    useAudioResizePreferenceStore.getState().setPreference('music', 'stretch')
    await waitFor(() => {
      expect(screen.getByTestId('audio-resize-pref-sfx')).toHaveTextContent('trim')
      expect(screen.getByTestId('audio-resize-pref-music')).toHaveTextContent('stretch')
    })
    fireEvent.click(screen.getByTestId('audio-resize-clear-sfx'))
    await waitFor(() => {
      expect(screen.getByTestId('audio-resize-pref-sfx')).toHaveTextContent('ask')
      expect(screen.getByTestId('audio-resize-pref-music')).toHaveTextContent('stretch')
    })
    expect(useAudioResizePreferenceStore.getState().getPreference('sfx')).toBeNull()
  })
})
