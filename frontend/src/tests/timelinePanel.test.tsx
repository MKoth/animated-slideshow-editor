import { act } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { TRACK_HEADER_WIDTH } from '../components/panels/timelineTracks'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { MovePrompterPartCommand } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { useAiStore } from '../stores/aiStore'

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

describe('TimelinePanel Improve blocks action', () => {
  it('sends the preset prompt with the active Slide context and slide-bound conversation', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const projectId = engine.project!.id
    const conversationId = 'audio-for-slide'
    useAiStore.setState({
      assistantMode: 'audio',
      conversations: [
        {
          id: conversationId,
          projectId,
          title: 'Slide audio',
          mode: 'audio',
          modified: new Date().toISOString(),
        },
      ],
      audioConversationSlideById: { [conversationId]: slide.id },
      activeByProject: { [`${projectId}:audio:slide:${slide.id}`]: conversationId },
    })
    const sendMessage = vi.spyOn(useAiStore.getState(), 'sendMessage').mockResolvedValue()

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    fireEvent.click(await screen.findByTestId('prompter-ai-improve'))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [sentProjectId, sentConversationId, text, context, mode] = sendMessage.mock.calls[0]
    expect(sentProjectId).toBe(projectId)
    expect(sentConversationId).toBe(conversationId)
    expect(text).toContain('Improve the current slide')
    expect(text).toContain('double quotes (not parentheses)')
    expect((context as { activeSlideId?: string | null }).activeSlideId).toBe(slide.id)
    expect(mode).toBe('audio')
  })

  it('shows block/audio counts and asks before replacing existing audio', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createPrompterPart(slide.id, {
      id: 'part-with-audio',
      text: 'Hello.',
      duration: 1,
    })
    engine.setPrompterPartAudio(slide.id, 'part-with-audio', 'clip-existing', 'asset-existing')

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    expect(await screen.findByTestId('prompter-audio-count')).toHaveTextContent(
      'Blocks: 1 · Audio: 1/1',
    )
    fireEvent.click(screen.getByTestId('prompter-generate-all-tts'))
    expect(await screen.findByTestId('prompter-tts-replace-dialog')).toHaveTextContent(
      '1 of 1 blocks already have audio',
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('prompter-tts-replace-dialog')).not.toBeInTheDocument()
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

  it('keeps the track header column at its fixed width despite long names', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    const longName = 'A character with an extremely long asset name for testing purposes.png'
    const parent = createNode(engine, longName)
    createNode(engine, 'Nested child with another very long name that must not leak.png', parent.id)

    await screen.findByRole('track', { name: longName })

    const tracks = document.querySelector('.timeline-tracks') as HTMLElement
    expect(tracks).not.toBeNull()
    expect(tracks).toHaveStyle({ width: `${TRACK_HEADER_WIDTH}px` })
    expect(screen.getByRole('track', { name: longName })).toBeInTheDocument()
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

describe('TimelinePanel active slide', () => {
  it('shows tracks and duration of the active slide, switching with it', async () => {
    const { engine } = renderPanel()
    const first = createProjectAndSlide(engine)
    engine.setSlideDuration(first.id, 5)
    const second = engine.createSlide('Slide 2')
    engine.setSlideDuration(second.id, 20)
    engine.setActiveSlide(first.id)
    engine.createNode(first.scene.id, first.scene.root.id, 'Only First')
    engine.createNode(second.scene.id, second.scene.root.id, 'Only Second')

    expect(await screen.findByRole('track', { name: 'Only First' })).toBeInTheDocument()
    expect(screen.queryByRole('track', { name: 'Only Second' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuemax', '5')

    act(() => {
      engine.setActiveSlide(second.id)
    })

    await waitFor(() => {
      expect(screen.getByRole('track', { name: 'Only Second' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('track', { name: 'Only First' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuemax', '20')
  })

  it('restores the per-slide playhead when switching back', async () => {
    const { engine } = renderPanel()
    const first = createProjectAndSlide(engine)
    const second = engine.createSlide('Slide 2')
    engine.setActiveSlide(first.id)
    engine.createNode(first.scene.id, first.scene.root.id, 'Boy')
    await screen.findByRole('track', { name: 'Boy' })
    const display = screen.getByLabelText('Current time')

    act(() => {
      usePlaybackController.getState().setCurrentTime(first.id, 3.5, first.duration)
    })
    await waitFor(() => expect(display).toHaveTextContent('00:03.500'))

    act(() => {
      engine.setActiveSlide(second.id)
    })
    await waitFor(() => expect(display).toHaveTextContent('00:00.000'))

    act(() => {
      engine.setActiveSlide(first.id)
    })
    await waitFor(() => expect(display).toHaveTextContent('00:03.500'))
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

describe('TimelinePanel prompter shift-right-to-un-overlap', () => {
  function setupOverlapping(engine: Engine) {
    const slide = createProjectAndSlide(engine)
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'One.', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'Two.', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p3', text: 'Three.', duration: 2 })
    return slide
  }

  async function openMenuFor(partId: string) {
    const chips = await screen.findAllByTestId('prompter-chip')
    const chip = chips.find((c) => c.getAttribute('data-prompter-id') === partId)
    expect(chip).toBeDefined()
    fireEvent.contextMenu(chip!, { clientX: 100, clientY: 100 })
    return screen.findByTestId('prompter-shift-right-btn')
  }

  it('shifts the block and its tail right so it starts at the previous block end', async () => {
    const { engine, undoStack, dispatcher } = renderPanel()
    const slide = setupOverlapping(engine)
    expect(
      dispatcher.dispatch(
        new MovePrompterPartCommand({ slideId: slide.id, partId: 'p2', newStartTime: 1 }),
      ).ok,
    ).toBe(true)
    const before = undoStack.entries.length

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    const btn = await openMenuFor('p2')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)

    expect(
      engine.getSlide(slide.id).prompter!.parts.map((p) => [p.id, p.startTime, p.endTime]),
    ).toEqual([
      ['p1', 0, 2],
      ['p2', 2, 4],
      ['p3', 5, 7],
    ])
    expect(undoStack.entries.length).toBe(before + 1)
    expect(undoStack.entries[0]!.type).toBe('Transaction')
    expect(screen.queryByTestId('prompter-context-menu')).not.toBeInTheDocument()
  })

  it('disables the item for the first block and when nothing overlaps', async () => {
    const { engine } = renderPanel()
    setupOverlapping(engine)

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    expect(await openMenuFor('p1')).toBeDisabled()
    expect(await openMenuFor('p3')).toBeDisabled()
  })
})
