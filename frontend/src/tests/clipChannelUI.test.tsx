import { act } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
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
import { useCurveEditorViewStore } from '../stores/curveEditorViewStore'

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

function createEmptyClip(engine: Engine, name: string) {
  return engine.createClip(name, 2, 'motion', [], [])
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
  useCurveEditorViewStore.persist.clearStorage()
  useCurveEditorViewStore.setState({
    zoomX: 100,
    zoomY: 1,
    scrollX: 0,
    scrollY: 0,
    filter: 'all',
    viewMode: 'dopeSheet',
    fitPending: false,
    frameSelectedPending: false,
  })
  localStorage.clear()
})

describe('Add Channel button', () => {
  it('shows "+ Add Channel" button in clip-edit mode', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    expect(screen.getByText('+ Add Channel')).toBeInTheDocument()
  })

  it('opens parameter picker when clicking "+ Add Channel"', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('+ Add Channel'))

    await waitFor(() => {
      expect(screen.getByTestId('parameter-picker')).toBeInTheDocument()
    })
  })

  it('adds a channel when selecting a parameter from the picker', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')

    act(() => {
      useSelectionStore.getState().select(node.id)
    })

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('+ Add Channel'))

    await waitFor(() => {
      expect(screen.getByTestId('parameter-picker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('parameter-picker-item-positionX'))

    await waitFor(() => {
      expect(screen.queryByTestId('parameter-picker')).not.toBeInTheDocument()
    })

    expect(engine.getClip(clip.id).hasChannel('positionX')).toBe(true)
    expect(screen.getByText('Position X')).toBeInTheDocument()
  })

  it('disables already-linked parameters in the picker', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')
    engine.addClipChannel(clip.id, { property: 'positionX' })

    act(() => {
      useSelectionStore.getState().select(node.id)
    })

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('+ Add Channel'))

    await waitFor(() => {
      expect(screen.getByTestId('parameter-picker')).toBeInTheDocument()
    })

    const item = screen.getByTestId('parameter-picker-item-positionX')
    expect(item).toBeDisabled()
  })

  it('shows "Added" label for already-linked parameters', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')
    engine.addClipChannel(clip.id, { property: 'positionX' })

    act(() => {
      useSelectionStore.getState().select(node.id)
    })

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('+ Add Channel'))

    await waitFor(() => {
      expect(screen.getByTestId('parameter-picker')).toBeInTheDocument()
    })

    const item = screen.getByTestId('parameter-picker-item-positionX')
    expect(item.textContent).toContain('Added')
  })
})

describe('Remove Channel context menu', () => {
  it('shows "Remove Channel" option on channel right-click', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')
    engine.addClipChannel(clip.id, { property: 'positionX' })

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })

    const channelRow = screen.getByText('Position X').closest('li')!
    fireEvent.contextMenu(channelRow)

    await waitFor(() => {
      expect(screen.getByTestId('channel-context-menu')).toBeInTheDocument()
    })

    expect(screen.getByText('Remove Channel')).toBeInTheDocument()
  })

  it('removes the channel when clicking "Remove Channel"', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')
    engine.addClipChannel(clip.id, { property: 'positionX' })

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })

    const channelRow = screen.getByText('Position X').closest('li')!
    fireEvent.contextMenu(channelRow)

    await waitFor(() => {
      expect(screen.getByTestId('channel-context-menu')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Remove Channel'))

    await waitFor(() => {
      expect(screen.queryByText('Position X')).not.toBeInTheDocument()
    })

    expect(engine.getClip(clip.id).hasChannel('positionX')).toBe(false)
  })
})

describe('Add Channel in curve editor mode', () => {
  it('shows "+ Add Channel" button in curve editor track list', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    act(() => {
      fireEvent.click(screen.getByText('Curve Editor'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('curve-editor-add-channel')).toBeInTheDocument()
    })
  })

  it('adds a channel from curve editor picker', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createEmptyClip(engine, 'Test Clip')

    act(() => {
      useSelectionStore.getState().select(node.id)
    })

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    act(() => {
      fireEvent.click(screen.getByText('Curve Editor'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('curve-editor-add-channel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('curve-editor-add-channel'))

    await waitFor(() => {
      expect(screen.getByTestId('parameter-picker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('parameter-picker-item-positionX'))

    await waitFor(() => {
      expect(engine.getClip(clip.id).hasChannel('positionX')).toBe(true)
    })
  })
})
