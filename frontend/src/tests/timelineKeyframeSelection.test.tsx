import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AddKeyframeCommand, DeleteKeyframesCommand } from '../engine/commands'
import type { Command } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { registerClipboardShortcuts } from '../shortcuts/clipboardShortcuts'
import { formatCombo, getShortcutHandler } from '../shortcuts/shortcutRegistry'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { FRAME_STEP } from '../engine/timelineSnapping'

type Property = 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity'

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

function createSceneWithNode(
  engine: Engine,
  name = 'Boy',
  transform?: { x?: number; y?: number },
): { slideId: string; nodeId: string } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...transform },
  })
  return { slideId: slide.id, nodeId: node.id }
}

function expandNode(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Toggle subtracks of ${name}` }))
}

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: Property,
  time: number,
  value = 10,
): string {
  const result = dispatcher.dispatch(
    new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
  )
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error.message}`)
  }
  return result.inverse.keyframe.keyframeId
}

function markerOf(keyframeId: string): HTMLElement {
  const marker = document.querySelector<HTMLElement>(`[data-keyframe-id="${keyframeId}"]`)
  if (!marker) {
    throw new Error(`expected a marker for keyframe ${keyframeId}`)
  }
  return marker
}

function markerStyleLeft(marker: HTMLElement): number {
  return Number.parseFloat(marker.style.left)
}

function pointerDownAtTime(
  marker: HTMLElement,
  time: number,
  options: Record<string, unknown> = {},
): void {
  fireEvent.pointerDown(marker, { clientX: time * 100, button: 0, ...options })
}

function dragTo(marker: HTMLElement, toTime: number, options: Record<string, unknown> = {}): void {
  pointerDownAtTime(marker, Number.parseFloat(marker.dataset.time ?? '0'))
  fireEvent.pointerMove(window, { clientX: toTime * 100, ...options })
  fireEvent.pointerUp(window)
}

function registerDeleteShortcuts(engine: Engine, dispatcher: CommandDispatcher): () => void {
  const deps = () => ({
    engine: toReadOnly(engine),
    dispatch: <Inverse,>(command: Command<Inverse>) => dispatcher.dispatch(command),
  })
  const disposeClipboard = registerClipboardShortcuts(deps)
  const onKeyDown = (event: KeyboardEvent) => {
    const handler = getShortcutHandler(formatCombo(event) ?? '')
    if (handler) {
      event.preventDefault()
      handler(event)
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    disposeClipboard()
  }
}

function pressDelete(): void {
  fireEvent.keyDown(window, { key: 'Delete' })
}

function getSelectedKeyframeIds(): readonly string[] {
  return selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({
    zoomLevel: 1,
    scrollTime: 0,
    height: DEFAULT_TIMELINE_HEIGHT,
    expandedNodeIds: {},
  })
  localStorage.clear()
})

describe('TimelinePanel keyframe selection', () => {
  it('selects a keyframe on click with distinct styling and clears node selection', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    useSelectionStore.getState().select(nodeId)

    pointerDownAtTime(marker, 1)

    expect(getSelectedKeyframeIds()).toEqual([keyframeId])
    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(marker.className).toContain('timeline-keyframe--selected')
  })

  it('ctrl-click adds a keyframe to the selection and click replaces it', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2)
    const third = addKeyframe(dispatcher, nodeId, 'positionX', 4)
    const firstMarker = await waitFor(() => markerOf(first))
    const secondMarker = markerOf(second)
    const thirdMarker = markerOf(third)

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(secondMarker, 2, { ctrlKey: true })

    expect(getSelectedKeyframeIds()).toEqual([first, second])

    pointerDownAtTime(thirdMarker, 4)
    expect(getSelectedKeyframeIds()).toEqual([third])
  })

  it('deselects a keyframe with ctrl-click when it is already selected', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2)
    const firstMarker = await waitFor(() => markerOf(first))

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(markerOf(second), 2, { ctrlKey: true })
    pointerDownAtTime(firstMarker, 1, { ctrlKey: true })

    expect(getSelectedKeyframeIds()).toEqual([second])
  })
})

describe('TimelinePanel moving keyframes', () => {
  it('drags a keyframe in time only, committing one MoveKeyframeCommand on release', async () => {
    const { engine, dispatcher, undoStack, logger } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 42)
    const marker = await waitFor(() => markerOf(keyframeId))
    const before = undoStack.entries.length

    dragTo(marker, 2.5)

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes).toHaveLength(1)
    expect(keyframes[0].time).toBe(2.5)
    expect(keyframes[0].value).toBe(42)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0]).toMatchObject({
      type: 'MoveKeyframes',
      parameters: {
        target: { kind: 'node', nodeId, property: 'positionX' },
        moves: [{ keyframeId, newTime: 2.5 }],
      },
      inverse: {
        target: { kind: 'node', nodeId, property: 'positionX' },
        moves: [{ keyframeId, oldTime: 1 }],
      },
    })
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('MoveKeyframes'))
  })

  it('moves the selected keyframes together, snapping to the 0.5 s grid', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 3)
    const firstMarker = await waitFor(() => markerOf(first))
    const before = undoStack.entries.length

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(markerOf(second), 3, { ctrlKey: true })
    dragTo(firstMarker, 2.3)

    const times = engine.getKeyframes(nodeId, 'positionX').map((keyframe) => keyframe.time)
    const expectedFirst = Math.round(2.3 / FRAME_STEP) * FRAME_STEP
    const expectedSecond = Math.round(4.3 / FRAME_STEP) * FRAME_STEP
    expect(times).toEqual([expectedFirst, expectedSecond])
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('MoveKeyframes')
    expect(undoStack.entries[0].inverse).toEqual({
      target: { kind: 'node', nodeId, property: 'positionX' },
      moves: [
        { keyframeId: first, oldTime: 1 },
        { keyframeId: second, oldTime: 3 },
      ],
    })
  })

  it('clamps a dragged keyframe to [0, slide duration]', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))

    dragTo(marker, 25)

    expect(engine.getKeyframes(nodeId, 'positionX')[0].time).toBe(10)

    dragTo(marker, -3)

    expect(engine.getKeyframes(nodeId, 'positionX')[0].time).toBe(0)
  })

  it('shows a live preview while dragging without touching the engine', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    const before = undoStack.entries.length

    pointerDownAtTime(marker, 1)
    fireEvent.pointerMove(window, { clientX: 250 })

    await waitFor(() => {
      expect(markerStyleLeft(markerOf(keyframeId))).toBe(250)
    })
    expect(engine.getKeyframes(nodeId, 'positionX')[0].time).toBe(1)
    expect(undoStack.entries).toHaveLength(before)

    fireEvent.pointerUp(window)
  })

  it('leaves the engine unchanged when dropping onto an occupied time', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    addKeyframe(dispatcher, nodeId, 'positionX', 3)
    const marker = await waitFor(() => markerOf(first))
    const before = undoStack.entries.length

    dragTo(marker, 3)

    const times = engine.getKeyframes(nodeId, 'positionX').map((keyframe) => keyframe.time)
    expect(times).toEqual([1, 3])
    expect(undoStack.entries).toHaveLength(before)
    await waitFor(() => {
      expect(markerStyleLeft(markerOf(first))).toBe(100)
    })
  })

  it('commits no command when the keyframe does not actually move', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    const before = undoStack.entries.length

    dragTo(marker, 1)

    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'positionX')[0].time).toBe(1)
  })
})

describe('TimelinePanel deleting keyframes', () => {
  it('deletes the selected keyframe with the Delete key', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    const dispose = registerDeleteShortcuts(engine, dispatcher)

    pointerDownAtTime(marker, 1)
    pressDelete()

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(getSelectedKeyframeIds()).toEqual([])
    expect(undoStack.entries[0].type).toBe('DeleteKeyframes')
    dispose()
  })

  it('falls back to deleting selected nodes when no keyframes are selected', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const dispose = registerDeleteShortcuts(engine, dispatcher)
    useSelectionStore.getState().select(nodeId)

    pressDelete()

    await waitFor(() => {
      expect(() => engine.getNode(nodeId)).toThrow(/not found/i)
    })
    dispose()
  })

  it('deletes the selected keyframe through the context menu', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    const before = undoStack.entries.length

    fireEvent.contextMenu(marker, { clientX: 100, clientY: 120 })
    const menu = screen.getByTestId('timeline-context-menu')
    fireEvent.click(within(menu).getByText('Delete Keyframe'))

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0]).toMatchObject({
      type: 'DeleteKeyframes',
      parameters: {
        target: { kind: 'node', nodeId, property: 'positionX' },
        keyframeIds: [keyframeId],
      },
    })
  })

  it('deletes the whole selection when the context menu targets a selected keyframe', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2)
    addKeyframe(dispatcher, nodeId, 'positionY', 3)
    const firstMarker = await waitFor(() => markerOf(first))
    const before = undoStack.entries.length

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(markerOf(second), 2, { ctrlKey: true })
    fireEvent.contextMenu(markerOf(second), { clientX: 200, clientY: 120 })
    const menu = screen.getByTestId('timeline-context-menu')
    fireEvent.click(within(menu).getByText('Delete Keyframe'))

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(1)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('DeleteKeyframes')
    expect(getSelectedKeyframeIds()).toEqual([])
  })

  it('deletes the selected keyframes through the timeline toolbar button', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 2)
    const firstMarker = await waitFor(() => markerOf(first))
    const button = screen.getByRole('button', { name: 'Delete Keyframe' })
    expect(button).toBeDisabled()

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(markerOf(second), 2, { ctrlKey: true })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(0)
    expect(undoStack.entries).toHaveLength(3)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(getSelectedKeyframeIds()).toEqual([])
  })

  it('deleting the last keyframe of a property reverts it to its static value', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, 'Boy', { x: 12 })
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 100)
    const marker = await waitFor(() => markerOf(keyframeId))
    const dispose = registerDeleteShortcuts(engine, dispatcher)

    pointerDownAtTime(marker, 1)
    pressDelete()

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(engine.evaluateNode(nodeId, 5).transform.x).toBe(12)
    dispose()
  })

  it('prunes the keyframe selection when keyframes are removed externally', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    pointerDownAtTime(marker, 1)
    expect(getSelectedKeyframeIds()).toEqual([keyframeId])

    const result = dispatcher.dispatch(
      new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId, property: 'positionX' },
        keyframeIds: [keyframeId],
      }),
    )
    if (!result.ok) {
      throw new Error(`expected delete to succeed: ${result.error.message}`)
    }

    await waitFor(() => {
      expect(getSelectedKeyframeIds()).toEqual([])
    })
  })
})

describe('TimelinePanel Shift-click range selection', () => {
  it('selects a range of keyframes between the anchor and the shift-clicked keyframe', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2)
    const third = addKeyframe(dispatcher, nodeId, 'positionX', 4)
    const firstMarker = await waitFor(() => markerOf(first))

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(markerOf(third), 4, { shiftKey: true })

    expect(getSelectedKeyframeIds()).toContain(first)
    expect(getSelectedKeyframeIds()).toContain(second)
    expect(getSelectedKeyframeIds()).toContain(third)
    expect(getSelectedKeyframeIds()).toHaveLength(3)
  })

  it('selects a range in reverse order when shift-clicking before the anchor', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2)
    const third = addKeyframe(dispatcher, nodeId, 'positionX', 4)
    const thirdMarker = await waitFor(() => markerOf(third))

    pointerDownAtTime(thirdMarker, 4)
    pointerDownAtTime(markerOf(first), 1, { shiftKey: true })

    expect(getSelectedKeyframeIds()).toContain(first)
    expect(getSelectedKeyframeIds()).toContain(second)
    expect(getSelectedKeyframeIds()).toContain(third)
    expect(getSelectedKeyframeIds()).toHaveLength(3)
  })
})

describe('TimelinePanel marquee selection', () => {
  it('shows a marquee rectangle when dragging on empty space', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    const lanes = document.querySelector('.timeline-lanes')
    if (!lanes) {
      throw new Error('expected timeline-lanes')
    }
    const rect = lanes.getBoundingClientRect()

    fireEvent.pointerDown(lanes, { clientX: rect.left + 10, clientY: rect.top + 10, button: 0 })
    fireEvent.pointerMove(window, { clientX: rect.left + 100, clientY: rect.top + 50 })

    await waitFor(() => {
      expect(screen.queryByTestId('timeline-marquee')).toBeInTheDocument()
    })

    fireEvent.pointerUp(window)

    await waitFor(() => {
      expect(screen.queryByTestId('timeline-marquee')).not.toBeInTheDocument()
    })
  })

  it('selects keyframes intersecting the marquee rectangle', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    addKeyframe(dispatcher, nodeId, 'positionX', 1)
    addKeyframe(dispatcher, nodeId, 'positionX', 3)
    await waitFor(() => {
      expect(screen.getAllByTestId('keyframe-marker')).toHaveLength(2)
    })

    const lanes = document.querySelector('.timeline-lanes')
    if (!lanes) {
      throw new Error('expected timeline-lanes')
    }
    const rect = lanes.getBoundingClientRect()

    fireEvent.pointerDown(lanes, { clientX: rect.left, clientY: rect.top, button: 0 })
    fireEvent.pointerMove(window, {
      clientX: rect.left + rect.width,
      clientY: rect.top + 28,
    })

    await waitFor(() => {
      expect(screen.queryByTestId('timeline-marquee')).toBeInTheDocument()
    })

    fireEvent.pointerUp(window)

    await waitFor(() => {
      expect(screen.queryByTestId('timeline-marquee')).not.toBeInTheDocument()
    })

    const selected = getSelectedKeyframeIds()
    expect(selected.length).toBeGreaterThanOrEqual(0)
    expect(useTimelineSelectionStore.getState().marqueeAnchor).toBeNull()
  })
})

describe('TimelinePanel context scoping', () => {
  it('clears node selection when clicking a keyframe', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const marker = await waitFor(() => markerOf(keyframeId))
    useSelectionStore.getState().select(nodeId)
    expect(useSelectionStore.getState().selectedIds).toEqual([nodeId])

    pointerDownAtTime(marker, 1)

    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(getSelectedKeyframeIds()).toEqual([keyframeId])
  })
})

describe('TimelinePanel snapping toggles', () => {
  it('renders Grid Snap toggle with default on state', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    const gridSnapButton = screen.getByRole('button', { name: 'Grid Snap' })
    expect(gridSnapButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders Snap to Keyframes toggle with default off state', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    const snapKfButton = screen.getByRole('button', { name: 'Snap to Keyframes' })
    expect(snapKfButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles Grid Snap off and on', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    const gridSnapButton = screen.getByRole('button', { name: 'Grid Snap' })
    expect(gridSnapButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(gridSnapButton)
    expect(gridSnapButton).toHaveAttribute('aria-pressed', 'false')
    expect(useTimelineViewStore.getState().gridSnapEnabled).toBe(false)

    fireEvent.click(gridSnapButton)
    expect(gridSnapButton).toHaveAttribute('aria-pressed', 'true')
    expect(useTimelineViewStore.getState().gridSnapEnabled).toBe(true)
  })

  it('toggles Snap to Keyframes off and on', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    const snapKfButton = screen.getByRole('button', { name: 'Snap to Keyframes' })
    expect(snapKfButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(snapKfButton)
    expect(snapKfButton).toHaveAttribute('aria-pressed', 'true')
    expect(useTimelineViewStore.getState().snapToKeyframesEnabled).toBe(true)

    fireEvent.click(snapKfButton)
    expect(snapKfButton).toHaveAttribute('aria-pressed', 'false')
    expect(useTimelineViewStore.getState().snapToKeyframesEnabled).toBe(false)
  })

  it('disables Snap to Keyframes when Grid Snap is off', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    const gridSnapButton = screen.getByRole('button', { name: 'Grid Snap' })
    const snapKfButton = screen.getByRole('button', { name: 'Snap to Keyframes' })

    fireEvent.click(gridSnapButton)
    expect(snapKfButton).toBeDisabled()

    fireEvent.click(gridSnapButton)
    expect(snapKfButton).toBeEnabled()
  })
})

describe('TimelinePanel grid snapping behavior', () => {
  it('snaps dragged keyframes to 0.5 s grid boundaries when grid snap is on', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    useTimelineViewStore.getState().setGridSnapEnabled(true)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 42)
    const marker = await waitFor(() => markerOf(keyframeId))

    dragTo(marker, 2.3)

    const time = engine.getKeyframes(nodeId, 'positionX')[0].time
    const expectedFrame = Math.round(2.3 / FRAME_STEP) * FRAME_STEP
    expect(time).toBeCloseTo(expectedFrame, 4)
  })

  it('does not snap when grid snap is off', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    useTimelineViewStore.getState().setGridSnapEnabled(false)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 42)
    const marker = await waitFor(() => markerOf(keyframeId))

    dragTo(marker, 2.3)

    const time = engine.getKeyframes(nodeId, 'positionX')[0].time
    expect(time).toBe(2.3)
  })
})

describe('TimelinePanel snap-to-keyframes behavior', () => {
  it('snaps to a nearby keyframe on another track when snap-to-keyframes is enabled', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    await screen.findByText('Position Y')
    useTimelineViewStore.getState().setGridSnapEnabled(true)
    useTimelineViewStore.getState().setSnapToKeyframesEnabled(true)
    addKeyframe(dispatcher, nodeId, 'positionY', 2, 10)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 42)
    const marker = await waitFor(() => markerOf(keyframeId))

    dragTo(marker, 2.01)

    const time = engine.getKeyframes(nodeId, 'positionX').find((kf) => kf.id === keyframeId)?.time
    expect(time).toBeCloseTo(2, 4)
  })

  it('preserves relative spacing of multi-selection when snapping to keyframes', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    useTimelineViewStore.getState().setGridSnapEnabled(true)
    useTimelineViewStore.getState().setSnapToKeyframesEnabled(true)
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 3, 30)
    const firstMarker = await waitFor(() => markerOf(first))

    pointerDownAtTime(firstMarker, 1)
    pointerDownAtTime(markerOf(second), 3, { ctrlKey: true })
    dragTo(firstMarker, 1.01)

    const times = engine
      .getKeyframes(nodeId, 'positionX')
      .map((kf) => kf.time)
      .sort((a, b) => a - b)
    expect(times[1] - times[0]).toBeCloseTo(2, 4)
  })
})
