import { act } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useTimelineSelectionStore } from '../stores/timelineSelectionStore'
import { useClipLibraryStore } from '../stores/clipLibraryStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import type { AnimationProperty } from '../engine'

function renderPanels(): {
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
      <TimelinePanel height={200} />
      <InspectorPanel width={300} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher, logger }
}

function renderTimeline(): {
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
      <TimelinePanel height={200} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher, logger }
}

function createProjectAndSlide(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  return engine.createSlide('Slide 1')
}

function createNode(engine: Engine, name: string, parent?: string) {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return engine.createNode(slide.scene.id, parent ?? slide.scene.root.id, name)
}

function createClipWithChannels(engine: Engine, name: string, channels: AnimationProperty[]) {
  const clip = engine.createClip(
    name,
    2,
    'motion',
    [],
    channels.map((ch) => ({ property: ch })),
  )
  return clip
}

function enterClipEditMode(_engine: Engine, clipId: string) {
  useClipLibraryStore.getState().selectClip(clipId)
  useTimelineSelectionStore.getState().setEditingContext('clip-edit')
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  useTimelineSelectionStore.setState({ editingContext: 'slide' })
  useClipLibraryStore.setState({ selectedId: null })
  localStorage.clear()
})

describe('Clip-edit mode', () => {
  it('shows clip-edit timeline when editing context is clip-edit', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX', 'positionY'])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })
    expect(screen.getByText('Test Clip')).toBeInTheDocument()
    expect(screen.getByText('Exit')).toBeInTheDocument()
  })

  it('shows clip channels as tracks in clip-edit mode', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX', 'positionY'])

    // Add keyframes to the clip
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)
    engine.addClipChannelKeyframe(clip.id, 'positionY', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionY', 1, 200)

    enterClipEditMode(engine, clip.id)

    // Should show channel tracks
    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
      expect(screen.getByText('Position Y')).toBeInTheDocument()
    })
  })

  it('disables playback controls in clip-edit mode', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    // Playback controls should be hidden
    expect(screen.queryByLabelText('Play (timeline)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Pause (timeline)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Stop (timeline)')).not.toBeInTheDocument()

    // Scrubbing hint should be shown
    expect(screen.getByText('Scrubbing only — playback disabled')).toBeInTheDocument()
  })

  it('exits clip-edit mode when Exit button is clicked', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    // Click Exit
    fireEvent.click(screen.getByText('Exit'))

    // Should return to slide mode
    await waitFor(() => {
      expect(useTimelineSelectionStore.getState().editingContext).toBe('slide')
    })
  })

  it('shows clip playhead with clip duration range', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = engine.createClip('Test Clip', 3, 'motion', [], [{ property: 'positionX' }])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      const playhead = screen.getByTestId('clip-edit-playhead')
      expect(playhead).toBeInTheDocument()
    })

    // Ruler should show clip duration
    const slider = screen.getByRole('slider', { name: 'Clip Playhead' })
    expect(slider).toHaveAttribute('aria-valuemax', '3')
  })

  it('scrubs the clip playhead', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    const slider = screen.getByRole('slider', { name: 'Clip Playhead' })
    fireEvent.pointerDown(slider, { clientX: 250 })
    fireEvent.pointerMove(window, { clientX: 500 })
    fireEvent.pointerUp(window)

    // Playhead should have moved
    const playhead = screen.getByTestId('clip-edit-playhead')
    expect(playhead).not.toHaveStyle({ left: '0px' })
  })

  it('does not modify slide timeline or current time', async () => {
    const { engine } = renderTimeline()
    const slide = createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    // Set slide playhead to a known time
    act(() => {
      usePlaybackController.getState().setCurrentTime(slide.id, 5, slide.duration)
    })

    const slideTimeBefore = usePlaybackController.getState().getTime(slide.id)

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    // Slide playhead should be unchanged
    const slideTimeAfter = usePlaybackController.getState().getTime(slide.id)
    expect(slideTimeAfter).toBe(slideTimeBefore)
  })

  it('preserves selection when switching contexts', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')

    // Select the node in slide mode
    act(() => {
      useSelectionStore.getState().select(node.id)
    })
    expect(useSelectionStore.getState().selectedIds).toContain(node.id)

    // Create a clip
    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    // Enter clip-edit mode
    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    // Exit clip-edit mode
    fireEvent.click(screen.getByText('Exit'))

    await waitFor(() => {
      expect(useTimelineSelectionStore.getState().editingContext).toBe('slide')
    })

    // Node selection should still be intact
    expect(useSelectionStore.getState().selectedIds).toContain(node.id)
  })
})

describe('Clip-edit auto-key', () => {
  it('creates keyframes when adding to clip channels', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })

    // Click add button on Position X
    const addButton = screen.getByLabelText('Add Keyframe to Position X')
    fireEvent.click(addButton)

    // Should have created a keyframe
    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    expect(keyframes.length).toBe(1)
  })
})

describe('Clip-edit selection', () => {
  it('selects keyframes in clip-edit mode', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    // Add keyframes
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })

    // Should show keyframe markers
    const markers = document.querySelectorAll('[data-keyframe-id]')
    expect(markers.length).toBe(2)

    // Click on a keyframe marker
    fireEvent.pointerDown(markers[0])

    // Should be selected
    const selectedIds = useTimelineSelectionStore.getState().selections['clip-edit']
    expect(selectedIds.length).toBe(1)
  })
})

describe('Clip-edit inspector', () => {
  it('shows clip fields in inspector during clip-edit', async () => {
    const { engine } = renderPanels()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip')).toBeInTheDocument()
    })

    // Should show clip name field
    expect(screen.getByText('Test Clip')).toBeInTheDocument()
    // Should show duration field
    expect(screen.getByText('Duration')).toBeInTheDocument()
  })
})
