import { act } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AddKeyframeCommand } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'

const SUBTRACK_LABELS = ['Position X', 'Position Y', 'Rotation', 'Scale X', 'Scale Y', 'Opacity']

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
  transform?: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number },
): { slideId: string; nodeId: string } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...transform },
  })
  return { slideId: slide.id, nodeId: node.id }
}

function track(name: string) {
  return screen.getByRole('track', { name })
}

function expandNode(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Toggle subtracks of ${name}` }))
}

function subtrackAddButton(nodeName: string, label: string): HTMLElement {
  const trackRow = track(nodeName).closest('li')
  if (!trackRow) {
    throw new Error('expected a track row')
  }
  const list = trackRow.parentElement
  if (!list) {
    throw new Error('expected a track list')
  }
  const subtrack = Array.from(list.children).find(
    (li) =>
      li.hasAttribute('data-property') && within(li as HTMLElement).queryByText(label) !== null,
  )
  if (!subtrack) {
    throw new Error(`expected a subtrack row for ${label}`)
  }
  return within(subtrack as HTMLElement).getByRole('button', { name: `Add Keyframe to ${label}` })
}

function keyframeMarkers(): HTMLElement[] {
  return screen.queryAllByTestId('keyframe-marker')
}

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity',
  time: number,
  value: number,
): void {
  const result = dispatcher.dispatch(new AddKeyframeCommand({ nodeId, property, time, value }))
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error?.message}`)
  }
}

function scrub(slideId: string, time: number): void {
  act(() => {
    usePlaybackController.getState().setCurrentTime(slideId, time, 10)
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
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

describe('TimelinePanel property subtracks', () => {
  it('hides subtracks by default and expands a node into its six properties', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    expect(screen.queryByText('Position X')).not.toBeInTheDocument()

    expandNode('Boy')

    await waitFor(() => {
      for (const label of SUBTRACK_LABELS) {
        expect(screen.getByText(label)).toBeInTheDocument()
      }
    })
  })

  it('expands the camera into five subtracks without Rotation', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    const cameraName = engine.project?.slides[0]?.scene.camera.name
    if (!cameraName) {
      throw new Error('expected a camera')
    }
    await screen.findByRole('track', { name: cameraName })

    expandNode(cameraName)

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
      expect(screen.queryByText('Rotation')).not.toBeInTheDocument()
      expect(screen.getAllByText('Opacity')).toHaveLength(1)
    })
  })

  it('indents subtracks below their node track', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')

    const subtrack = await screen.findByText('Position X')
    const li = subtrack.closest('li')
    expect(li).toHaveAttribute('data-depth', '2')
    expect(track('Boy')).toHaveAttribute('data-depth', '1')
  })

  it('collapses the subtracks again on a second chevron click', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')

    expandNode('Boy')

    await waitFor(() => {
      expect(screen.queryByText('Position X')).not.toBeInTheDocument()
    })
  })
})

describe('TimelinePanel keyframe markers', () => {
  it('renders a marker per keyframe at the keyframe time on its subtrack', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')

    addKeyframe(dispatcher, nodeId, 'positionX', 1, 5)
    addKeyframe(dispatcher, nodeId, 'positionX', 2.5, 8)
    addKeyframe(dispatcher, nodeId, 'opacity', 1.5, 0.5)

    const markers = await screen.findAllByTestId('keyframe-marker')
    expect(markers).toHaveLength(3)

    const positionMarkers = markers.filter((marker) => marker.dataset.property === 'positionX')
    expect(positionMarkers).toHaveLength(2)
    expect(positionMarkers[0]).toHaveStyle({ left: '100px' })
    expect(positionMarkers[1]).toHaveStyle({ left: '250px' })
    expect(positionMarkers[0]).toHaveAttribute('data-time', '1')
    expect(positionMarkers[1]).toHaveAttribute('data-time', '2.5')
    expect(markers.some((marker) => marker.dataset.property === 'opacity')).toBe(true)
  })

  it('renders no markers while the track is collapsed', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    addKeyframe(dispatcher, nodeId, 'positionX', 1, 5)

    expect(keyframeMarkers()).toHaveLength(0)
  })
})

describe('TimelinePanel creating keyframes', () => {
  it('adds a keyframe at the playhead via the + button with the evaluated value', async () => {
    const { engine, logger } = renderPanel()
    const { slideId, nodeId } = createSceneWithNode(engine, 'Boy', { x: 12 })
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    scrub(slideId, 3)

    fireEvent.click(subtrackAddButton('Boy', 'Position X'))

    await waitFor(() => {
      expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    })
    const keyframe = engine.getKeyframes(nodeId, 'positionX')[0]
    expect(keyframe.time).toBe(3)
    expect(keyframe.value).toBe(12)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('AddKeyframe'))
    expect(usePlaybackController.getState().getTime(slideId)).toBe(3)
  })

  it('does nothing when a keyframe already sits exactly at the playhead', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { slideId, nodeId } = createSceneWithNode(engine, 'Boy', { x: 12 })
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    await screen.findByText('Position X')
    addKeyframe(dispatcher, nodeId, 'positionX', 2, 12)
    scrub(slideId, 2)
    const before = undoStack.entries.length

    fireEvent.click(subtrackAddButton('Boy', 'Position X'))

    await waitFor(() => {
      expect(screen.getByText('Position X')).toBeInTheDocument()
    })
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(undoStack.entries).toHaveLength(before)
  })

  it('right-clicking a subtrack offers Add Keyframe which pins the evaluated value', async () => {
    const { engine, logger } = renderPanel()
    const { slideId, nodeId } = createSceneWithNode(engine, 'Boy', { x: 12 })
    await screen.findByRole('track', { name: 'Boy' })
    expandNode('Boy')
    const subtrack = await screen.findByText('Position X')
    const li = subtrack.closest('li')
    if (!li) {
      throw new Error('expected a subtrack row')
    }
    scrub(slideId, 1.5)

    fireEvent.contextMenu(li as HTMLElement, { clientX: 100, clientY: 120 })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Keyframe' }))

    await waitFor(() => {
      expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    })
    const keyframe = engine.getKeyframes(nodeId, 'positionX')[0]
    expect(keyframe.time).toBe(1.5)
    expect(keyframe.value).toBe(12)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('AddKeyframe'))
  })

  it('right-clicking a node track creates pose keyframes for every animatable property', async () => {
    const { engine, undoStack, logger } = renderPanel()
    const { slideId, nodeId } = createSceneWithNode(engine, 'Boy', { x: 12, y: -4 })
    const row = await screen.findByRole('track', { name: 'Boy' })
    const li = row.closest('li')
    if (!li) {
      throw new Error('expected a track row')
    }
    scrub(slideId, 2)

    fireEvent.contextMenu(li as HTMLElement, { clientX: 100, clientY: 120 })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Keyframe' }))

    await waitFor(() => {
      expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    })
    for (const property of [
      'positionX',
      'positionY',
      'rotation',
      'scaleX',
      'scaleY',
      'opacity',
    ] as const) {
      const keyframe = engine.getKeyframes(nodeId, property)[0]
      expect(keyframe.time).toBe(2)
    }
    expect(engine.getKeyframes(nodeId, 'positionX')[0].value).toBe(12)
    expect(engine.getKeyframes(nodeId, 'positionY')[0].value).toBe(-4)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Transaction'))
  })

  it('closes the context menu when clicking elsewhere', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    const row = await screen.findByRole('track', { name: 'Boy' })
    const li = row.closest('li')
    if (!li) {
      throw new Error('expected a track row')
    }

    fireEvent.contextMenu(li as HTMLElement, { clientX: 100, clientY: 120 })
    expect(await screen.findByRole('button', { name: 'Add Keyframe' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('timeline-context-menu-backdrop'))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Add Keyframe' })).not.toBeInTheDocument()
    })
  })
})
