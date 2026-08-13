import { act } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'

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

function createSceneWithNode(engine: Engine) {
  const slide = createProjectAndSlide(engine)
  return { slide, node: createNode(engine, 'Boy') }
}

function createNode(engine: Engine, name: string, parent?: string) {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return engine.createNode(slide.scene.id, parent ?? slide.scene.root.id, name)
}

function track(name: string) {
  return screen.getByRole('track', { name })
}

function setCurrentTime(engine: Engine, time: number): void {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  act(() => {
    usePlaybackController.getState().setCurrentTime(slide.id, time, slide.duration)
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
})

describe('TimelinePanel empty states', () => {
  it('shows an empty state when there is no project', () => {
    renderPanel()

    expect(screen.getByText('No project. Create one to get started.')).toBeInTheDocument()
  })

  it('shows an empty state when the project has no slides', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })

    expect(await screen.findByText('No slides created.')).toBeInTheDocument()
  })

  it('shows the empty state when the active slide scene has no objects', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)

    expect(
      await screen.findByText(
        'No objects in the scene. Drag assets into the scene to begin animating.',
      ),
    ).toBeInTheDocument()
  })
})

describe('TimelinePanel tracks', () => {
  it('renders one track per scene node, camera included, camera last', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    const parent = createNode(engine, 'Parent')
    createNode(engine, 'Child', parent.id)

    expect(await screen.findByRole('track', { name: 'Root' })).toBeInTheDocument()
    expect(track('Parent')).toBeInTheDocument()
    expect(track('Child')).toBeInTheDocument()
    expect(track('Boy')).toBeInTheDocument()
    const cameraRow = track(slide.scene.camera.name)
    expect(cameraRow).toBeInTheDocument()

    const rows = screen.getAllByRole('track')
    expect(rows[rows.length - 1]).toBe(cameraRow)
  })

  it('mirrors the scene hierarchy with indentation per depth', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    const parent = createNode(engine, 'Parent')
    const child = createNode(engine, 'Child', parent.id)
    createNode(engine, 'Grandchild', child.id)

    expect(await screen.findByRole('track', { name: 'Parent' })).toHaveAttribute('data-depth', '1')
    expect(track('Child')).toHaveAttribute('data-depth', '2')
    expect(track('Grandchild')).toHaveAttribute('data-depth', '3')
    expect(track('Root')).toHaveAttribute('data-depth', '0')
  })

  it('renders an icon, name and visibility/lock placeholders per track', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')
    createNode(engine, 'Hidden', undefined)

    const boyRow = await screen.findByRole('track', { name: 'Boy' })
    expect(boyRow.querySelector('[data-icon="folder"]')).not.toBeNull()
    expect(within(boyRow).getByTitle('Visible')).toBeInTheDocument()
    expect(within(boyRow).getByTitle('Locked')).toBeInTheDocument()
  })

  it('adds a track when a node is created and removes it when deleted', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')

    expect(await screen.findByRole('track', { name: 'Boy' })).toBeInTheDocument()

    act(() => {
      engine.removeNode(node.id)
    })

    await waitFor(() => {
      expect(screen.queryByRole('track', { name: 'Boy' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('track', { name: slide.scene.camera.name })).not.toBeInTheDocument()
    expect(
      screen.getByText('No objects in the scene. Drag assets into the scene to begin animating.'),
    ).toBeInTheDocument()
  })

  it('renames a track when its node is renamed', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')

    expect(await screen.findByRole('track', { name: 'Boy' })).toBeInTheDocument()

    act(() => {
      engine.renameNode(node.id, 'Girl')
    })

    await waitFor(() => {
      expect(screen.getByRole('track', { name: 'Girl' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('track', { name: 'Boy' })).not.toBeInTheDocument()
  })
})

describe('TimelinePanel selection sync', () => {
  it('selects the node when its track is clicked', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')

    fireEvent.click(await screen.findByRole('track', { name: 'Boy' }))

    expect(useSelectionStore.getState().selectedIds).toEqual([node.id])
  })

  it('toggles with ctrl-click and extends with shift-click', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    const a = createNode(engine, 'A')
    const b = createNode(engine, 'B')
    await screen.findByRole('track', { name: 'A' })

    fireEvent.click(track('A'), { ctrlKey: true })
    fireEvent.click(track('B'), { ctrlKey: true })
    expect(new Set(useSelectionStore.getState().selectedIds)).toEqual(new Set([a.id, b.id]))

    fireEvent.click(track('A'), { shiftKey: true })
    expect(useSelectionStore.getState().selectedIds).toContain(a.id)
  })

  it('selects the camera from its track', async () => {
    const { engine } = renderPanel()
    const { slide } = createSceneWithNode(engine)

    fireEvent.click(await screen.findByRole('track', { name: slide.scene.camera.name }))

    expect(useSelectionStore.getState().selectedIds).toEqual([slide.scene.camera.id])
  })

  it('highlights the track of the node selected elsewhere', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const row = await screen.findByRole('track', { name: 'Boy' })
    expect(row).toHaveAttribute('aria-selected', 'false')

    act(() => {
      useSelectionStore.getState().select(node.id)
    })

    await waitFor(() => {
      expect(row).toHaveAttribute('aria-selected', 'true')
    })
  })
})

describe('TimelinePanel current time and playhead', () => {
  it('shows the current time as MM:SS.mmm and updates with the playhead', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const display = screen.getByLabelText('Current time')
    expect(display).toHaveTextContent('00:00.000')

    setCurrentTime(engine, 3.5)
    await waitFor(() => {
      expect(display).toHaveTextContent('00:03.500')
    })
  })

  it('positions the playhead at the current time in pixels', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const playhead = screen.getByTestId('timeline-playhead')
    expect(playhead).toHaveStyle({ left: '0px' })

    setCurrentTime(engine, 3.5)
    await waitFor(() => {
      expect(playhead).toHaveStyle({ left: '350px' })
    })
  })

  it('drags the ruler to scrub with grid snapping', async () => {
    const { engine } = renderPanel()
    const { slide } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const slider = screen.getByRole('slider', { name: 'Playhead' })
    fireEvent.pointerDown(slider, { clientX: 25 })
    fireEvent.pointerMove(window, { clientX: 360 })
    fireEvent.pointerUp(window)

    expect(usePlaybackController.getState().getTime(slide.id)).toBe(3.5)

    fireEvent.pointerDown(slider, { clientX: 1250 })
    fireEvent.pointerUp(window)
    expect(usePlaybackController.getState().getTime(slide.id)).toBe(10)
  })

  it('updates the current time continuously during the drag', async () => {
    const { engine } = renderPanel()
    const { slide } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const slider = screen.getByRole('slider', { name: 'Playhead' })
    fireEvent.pointerDown(slider, { clientX: 100 })
    fireEvent.pointerMove(window, { clientX: 155 })
    expect(usePlaybackController.getState().getTime(slide.id)).toBe(1.5)
    fireEvent.pointerMove(window, { clientX: 260 })
    expect(usePlaybackController.getState().getTime(slide.id)).toBe(2.5)
    fireEvent.pointerUp(window)
  })
})

describe('TimelinePanel ruler', () => {
  it('ticks at 0.0/0.5/1.0 spacing at the default zoom', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const ruler = screen.getByRole('slider', { name: 'Playhead' })
    expect(within(ruler).getByText('0.0')).toBeInTheDocument()
    expect(within(ruler).getByText('0.5')).toBeInTheDocument()
    expect(within(ruler).getByText('1.0')).toBeInTheDocument()
    expect(within(ruler).getByText('5.0')).toBeInTheDocument()
  })
})

describe('TimelinePanel view state', () => {
  it('zooms in and out with the toolbar buttons centered on the viewport', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }))
    expect(useTimelineViewStore.getState().zoomLevel).toBe(2)
    expect(useTimelineViewStore.getState().scrollTime).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom Out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom Out' }))
    expect(useTimelineViewStore.getState().zoomLevel).toBe(0.5)
  })

  it('zooms with the toolbar buttons anchored at the last cursor position', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const scroller = screen.getByTestId('timeline-scroller')
    fireEvent.pointerMove(scroller, { clientX: 300 })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }))

    const state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(2)
    expect(state.scrollTime).toBeCloseTo(1.5)
  })

  it('fits the full duration into view', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    fireEvent.click(screen.getByRole('button', { name: 'Fit Timeline' }))

    expect(useTimelineViewStore.getState().zoomLevel).toBeCloseTo(0.8)
    expect(useTimelineViewStore.getState().scrollTime).toBe(0)
  })

  it('zooms with ctrl+wheel centered on the mouse cursor', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const scroller = screen.getByTestId('timeline-scroller')
    fireEvent.wheel(scroller, { ctrlKey: true, deltaY: -120, clientX: 250 })

    const state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(2)
    expect(state.scrollTime).toBeCloseTo(1.25)
  })

  it('scrolls horizontally into scroll time, extending past the duration', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const scroller = screen.getByTestId('timeline-scroller') as HTMLElement
    scroller.scrollLeft = 100
    fireEvent.scroll(scroller)
    expect(useTimelineViewStore.getState().scrollTime).toBe(1)

    scroller.scrollLeft = 4000
    fireEvent.scroll(scroller)
    expect(useTimelineViewStore.getState().scrollTime).toBeCloseTo(2.8)
  })

  it('creates no execution-log entries for scrubbing, zoom or scroll', async () => {
    const { engine, logger } = renderPanel()
    const { slide } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Root' })

    const slider = screen.getByRole('slider', { name: 'Playhead' })
    fireEvent.pointerDown(slider, { clientX: 200 })
    fireEvent.pointerMove(window, { clientX: 260 })
    fireEvent.pointerUp(window)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit Timeline' }))
    const scroller = screen.getByTestId('timeline-scroller') as HTMLElement
    scroller.scrollLeft = 50
    fireEvent.scroll(scroller)

    expect(usePlaybackController.getState().getTime(slide.id)).toBe(2.5)
    expect(logger).not.toHaveBeenCalled()
  })
})
