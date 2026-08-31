import { act } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { deserialize, serialize } from '../engine/lessonSerializer'
import { vi } from 'vitest'

function renderPanel(): {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
  logger: ReturnType<typeof vi.fn>
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const logger = vi.fn()
  const dispatcher = new CommandDispatcher(engine, undoStack, logger)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <TimelinePanel height={400} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher, logger }
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
})

describe('Audio Tab Shell', () => {
  it('renders Animation|Audio tabs and shares ruler', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    // initial is Animation tab
    expect(await screen.findByTestId('timeline-tab-animation')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-tab-audio')).toBeInTheDocument()
    // ruler exists in animation mode
    expect(screen.getByRole('slider', { name: 'Playhead' })).toBeInTheDocument()
    // zoom level preserved after tab switch (keep playhead inside viewport to avoid auto-scroll)
    const slideId = engine.getActiveSlide()!.id
    usePlaybackController.getState().setCurrentTime(slideId, 2, 10)
    useTimelineViewStore.setState({ zoomLevel: 2, scrollTime: 1.5 })
    fireEvent.click(screen.getByTestId('timeline-tab-audio'))
    // audio ruler should exist with same ticks (0.2 step at zoom 2 => pps 200, step 0.2)
    expect(screen.getByTestId('audio-ruler')).toBeInTheDocument()
    await waitFor(() => expect(useTimelineViewStore.getState().zoomLevel).toBe(2))
    expect(useTimelineViewStore.getState().scrollTime).toBe(1.5)
    // switch back preserves
    fireEvent.click(screen.getByTestId('timeline-tab-animation'))
    await waitFor(() => expect(useTimelineViewStore.getState().zoomLevel).toBe(2))
    expect(useTimelineViewStore.getState().scrollTime).toBe(1.5)
  })

  it('shows empty state per lane when no audio', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    expect(await screen.findByTestId('audio-prompter-strip')).toBeInTheDocument()
    expect(screen.getByTestId('audio-lane-voice')).toBeInTheDocument()
    expect(screen.getByTestId('audio-lane-sfx')).toBeInTheDocument()
    expect(screen.getByTestId('audio-lane-music')).toBeInTheDocument()
    // empty CTA per lane
    expect(screen.getByTestId('audio-empty-voice')).toHaveTextContent(
      'No audio — drag an audio asset or record',
    )
    expect(screen.getByTestId('audio-empty-sfx')).toHaveTextContent(
      'No audio — drag an audio asset or record',
    )
    expect(screen.getByTestId('audio-empty-music')).toHaveTextContent(
      'No audio — drag an audio asset or record',
    )
    // single playhead overlay spanning lanes
    expect(screen.getByTestId('audio-playhead')).toBeInTheDocument()
  })

  it('positions clip via timelineStart * pps', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    // pps 100 default, timelineStart 2.5 => left 250px
    engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 2.5,
      sourceStart: 0,
      sourceEnd: 1,
    })
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    const clip = await screen.findByTestId('audio-clip')
    expect(clip).toHaveStyle({ left: '250px' })
    // width should be (1 * 100) = 100px
    expect(clip).toHaveStyle({ width: '100px' })
  })

  it('clips overflow past duration with indicator', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.setSlideDuration(slide.id, 5)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    // clip at 4 with 2s source => extends to 6 > 5 => overflow
    engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'music',
      timelineStart: 4,
      sourceStart: 0,
      sourceEnd: 2,
    })
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    const clip = await screen.findByTestId('audio-clip')
    expect(clip.className).toContain('audio-clip--overflow')
    // visible width should be (5-4)*pps = 100
    expect(clip).toHaveStyle({ left: '400px' })
    expect(clip).toHaveStyle({ width: '100px' })
  })

  it('preserves per-slide 0..duration axis (no global concat)', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const s1 = engine.createSlide('Slide 1')
    engine.createNode(s1.scene.id, s1.scene.root.id, 'Boy')
    engine.setSlideDuration(s1.id, 5)
    const s2 = engine.createSlide('Slide 2')
    engine.createNode(s2.scene.id, s2.scene.root.id, 'Boy2')
    engine.setSlideDuration(s2.id, 10)
    engine.setActiveSlide(s1.id)
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    // ruler max should be 5 for slide 1
    expect(screen.getByTestId('audio-ruler')).toHaveAttribute('aria-valuemax', '5')
    act(() => engine.setActiveSlide(s2.id))
    await waitFor(() =>
      expect(screen.getByTestId('audio-ruler')).toHaveAttribute('aria-valuemax', '10'),
    )
  })

  it('round-trip LessonJSON tolerates missing audio/prompter', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const json = JSON.parse(serialize(engine.project!))
    expect(json.slides[0].audio).toBeUndefined()
    expect(json.slides[0].prompter).toBeUndefined()
    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides[0].audio.clips).toEqual([])
    expect(restored.slides[0].prompter).toBeNull()
    // serialize again identical (no audio/prompter added)
    const json2 = JSON.parse(serialize(restored))
    expect(json2.slides[0].audio).toBeUndefined()
    expect(json2.slides[0].prompter).toBeUndefined()
  })
})
