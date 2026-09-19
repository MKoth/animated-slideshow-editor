import { act, useEffect } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ObjectTimelineModal } from '../components/panels/ObjectTimelineModal'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { AddKeyframeCommand, CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { registerObjectTimelineShortcut } from '../shortcuts/objectTimelineShortcut'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'
import { useObjectTimelineStore } from '../stores/objectTimelineStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTimelineSelectionStore } from '../stores/timelineSelectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { noopPersistence } from './contextHarness'

function ShortcutHost() {
  useKeyboardShortcuts()
  useEffect(() => registerObjectTimelineShortcut(), [])
  return (
    <>
      <TimelinePanel height={200} />
      <ObjectTimelineModal />
    </>
  )
}

function renderEditor(): { engine: Engine; dispatcher: CommandDispatcher } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <ShortcutHost />
    </EngineContext.Provider>,
  )
  return { engine, dispatcher }
}

function createScene(engine: Engine, names: readonly string[]): { nodeIds: string[] } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const nodeIds = names.map(
    (name) => engine.createNode(slide.scene.id, slide.scene.root.id, name).id,
  )
  return { nodeIds }
}

function openModal(): void {
  fireEvent.keyDown(window, { key: 'l' })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
  useObjectTimelineStore.setState({ nodeId: null })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({
    zoomLevel: 1,
    scrollTime: 0,
    height: DEFAULT_TIMELINE_HEIGHT,
    expandedNodeIds: {},
    authoringModeByHost: {},
  })
  localStorage.clear()
})

describe('ObjectTimelineModal', () => {
  it('opens with L for the selected object and shows only its lanes', async () => {
    const { engine } = renderEditor()
    const { nodeIds } = createScene(engine, ['Boy', 'Girl'])
    act(() => useSelectionStore.getState().select(nodeIds[0]))
    await screen.findByRole('track', { name: 'Boy' })

    openModal()

    const overlay = await screen.findByTestId('object-timeline-overlay')
    expect(within(overlay).getByTestId('object-timeline-title')).toHaveTextContent('Boy')
    expect(within(overlay).getByText('Position X')).toBeInTheDocument()

    const laneNodeIds = new Set(
      Array.from(overlay.querySelectorAll('[data-node-id]')).map((element) =>
        element.getAttribute('data-node-id'),
      ),
    )
    expect(laneNodeIds).toEqual(new Set([nodeIds[0]]))
  })

  it('does nothing without a selection', async () => {
    const { engine } = renderEditor()
    createScene(engine, ['Boy'])
    await screen.findByRole('track', { name: 'Boy' })

    openModal()

    expect(screen.queryByTestId('object-timeline-overlay')).toBeNull()
  })

  it('hides lanes without keyframes when Animated only is checked', async () => {
    const { engine, dispatcher } = renderEditor()
    const { nodeIds } = createScene(engine, ['Boy'])
    const nodeId = nodeIds[0]
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, property: 'positionX' },
        time: 1,
        value: 5,
      }),
    )
    act(() => useSelectionStore.getState().select(nodeId))
    openModal()
    const overlay = await screen.findByTestId('object-timeline-overlay')

    expect(within(overlay).getByText('Position X')).toBeInTheDocument()
    expect(within(overlay).getByText('Position Y')).toBeInTheDocument()

    fireEvent.click(within(overlay).getByTestId('object-timeline-animated-only'))

    await waitFor(() => {
      expect(within(overlay).queryByText('Position Y')).toBeNull()
    })
    expect(within(overlay).getByText('Position X')).toBeInTheDocument()
  })

  it('replicates keyframes added in the modal to the main timeline', async () => {
    const { engine } = renderEditor()
    const { nodeIds } = createScene(engine, ['Boy'])
    const nodeId = nodeIds[0]
    act(() => useSelectionStore.getState().select(nodeId))
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle subtracks of Boy' }))

    openModal()
    const overlay = await screen.findByTestId('object-timeline-overlay')
    const slide = engine.getActiveSlide()
    if (!slide) {
      throw new Error('expected an active slide')
    }
    act(() => {
      usePlaybackController.getState().setCurrentTime(slide.id, 2, slide.duration)
    })

    fireEvent.click(within(overlay).getByRole('button', { name: 'Add Keyframe to Position X' }))

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)

    const mainScroller = screen
      .getAllByTestId('timeline-scroller')
      .find((element) => !overlay.contains(element))
    expect(mainScroller).toBeDefined()
    await waitFor(() => {
      expect(within(mainScroller as HTMLElement).getAllByTestId('keyframe-marker')).toHaveLength(1)
    })
  })

  it('keeps the object frozen when the canvas selection changes', async () => {
    const { engine } = renderEditor()
    const { nodeIds } = createScene(engine, ['Boy', 'Girl'])
    act(() => useSelectionStore.getState().select(nodeIds[0]))
    openModal()
    const overlay = await screen.findByTestId('object-timeline-overlay')

    act(() => useSelectionStore.getState().select(nodeIds[1]))

    expect(within(overlay).getByTestId('object-timeline-title')).toHaveTextContent('Boy')
  })

  it('closes on Escape and on the close button', async () => {
    const { engine } = renderEditor()
    const { nodeIds } = createScene(engine, ['Boy'])
    act(() => useSelectionStore.getState().select(nodeIds[0]))
    openModal()
    await screen.findByTestId('object-timeline-overlay')

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('object-timeline-overlay')).toBeNull()
    })

    openModal()
    const overlay = await screen.findByTestId('object-timeline-overlay')
    fireEvent.click(within(overlay).getByTestId('object-timeline-close'))

    await waitFor(() => {
      expect(screen.queryByTestId('object-timeline-overlay')).toBeNull()
    })
  })
})
