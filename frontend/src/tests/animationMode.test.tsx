import { act } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { useUiStore } from '../stores/uiStore'

const PERSIST_KEY = 'editor-ui-prefs'

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

function scrub(slideId: string, time: number): void {
  act(() => {
    usePlaybackController.getState().setCurrentTime(slideId, time, 10)
  })
}

async function renderWithScene(): Promise<{
  engine: Engine
  logger: ReturnType<typeof vi.fn>
  slideId: string
  nodeId: string
}> {
  const { engine, logger } = renderPanel()
  const { slideId, nodeId } = createSceneWithNode(engine, 'Boy', { x: 12 })
  await screen.findByRole('track', { name: 'Boy' })
  return { engine, logger, slideId, nodeId }
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
  useUiStore.setState({ animationMode: false, cameraAnimationMode: false })
})

describe('Animation Mode toggle', () => {
  it('sits in the timeline toolbar, off by default', async () => {
    await renderWithScene()

    const toggle = screen.getByRole('button', { name: 'Animation Mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('turns on when clicked and persists to localStorage', async () => {
    await renderWithScene()
    const toggle = screen.getByRole('button', { name: 'Animation Mode' })

    fireEvent.click(toggle)

    expect(useUiStore.getState().animationMode).toBe(true)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}') as {
      state?: { animationMode?: boolean }
    }
    expect(stored.state?.animationMode).toBe(true)
  })

  it('turns off again on a second click', async () => {
    await renderWithScene()
    const toggle = screen.getByRole('button', { name: 'Animation Mode' })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(useUiStore.getState().animationMode).toBe(false)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('restores the persisted mode on reload', async () => {
    useUiStore.setState({ animationMode: false })
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ state: { animationMode: true } }))

    await useUiStore.persist.rehydrate()

    expect(useUiStore.getState().animationMode).toBe(true)
  })

  it('creates no execution-log entries when toggling', async () => {
    const { logger } = await renderWithScene()
    const toggle = screen.getByRole('button', { name: 'Animation Mode' })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(logger).not.toHaveBeenCalled()
  })
})

describe('Camera Animation Mode toggle', () => {
  it('sits in the timeline toolbar next to Animation Mode, off by default', async () => {
    await renderWithScene()

    const toggle = screen.getByRole('button', { name: 'Camera Animation Mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('turns on when clicked and persists to localStorage', async () => {
    await renderWithScene()
    const toggle = screen.getByRole('button', { name: 'Camera Animation Mode' })

    fireEvent.click(toggle)

    expect(useUiStore.getState().cameraAnimationMode).toBe(true)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}') as {
      state?: { cameraAnimationMode?: boolean }
    }
    expect(stored.state?.cameraAnimationMode).toBe(true)
  })

  it('turns off again on a second click', async () => {
    await renderWithScene()
    const toggle = screen.getByRole('button', { name: 'Camera Animation Mode' })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(useUiStore.getState().cameraAnimationMode).toBe(false)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('disables Animation Mode when enabled', async () => {
    await renderWithScene()
    const animationToggle = screen.getByRole('button', { name: 'Animation Mode' })
    const cameraToggle = screen.getByRole('button', { name: 'Camera Animation Mode' })
    fireEvent.click(animationToggle)
    expect(animationToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(cameraToggle)

    expect(useUiStore.getState().cameraAnimationMode).toBe(true)
    expect(useUiStore.getState().animationMode).toBe(false)
    expect(animationToggle).toHaveAttribute('aria-pressed', 'false')
    expect(cameraToggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('is disabled when Animation Mode gets enabled', async () => {
    await renderWithScene()
    const animationToggle = screen.getByRole('button', { name: 'Animation Mode' })
    const cameraToggle = screen.getByRole('button', { name: 'Camera Animation Mode' })
    fireEvent.click(cameraToggle)
    expect(cameraToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(animationToggle)

    expect(useUiStore.getState().animationMode).toBe(true)
    expect(useUiStore.getState().cameraAnimationMode).toBe(false)
    expect(animationToggle).toHaveAttribute('aria-pressed', 'true')
    expect(cameraToggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('turning camera mode off does not re-enable animation mode', async () => {
    await renderWithScene()
    const cameraToggle = screen.getByRole('button', { name: 'Camera Animation Mode' })

    fireEvent.click(cameraToggle)
    fireEvent.click(cameraToggle)

    expect(useUiStore.getState().cameraAnimationMode).toBe(false)
    expect(useUiStore.getState().animationMode).toBe(false)
  })

  it('creates no execution-log entries when toggling', async () => {
    const { logger } = await renderWithScene()
    const toggle = screen.getByRole('button', { name: 'Camera Animation Mode' })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(logger).not.toHaveBeenCalled()
  })
})

describe('Timeline keyframe actions create keyframes in both modes', () => {
  it('creates a keyframe via the + button with the mode off', async () => {
    const { engine, logger, slideId, nodeId } = await renderWithScene()
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
  })

  it('creates a keyframe via the + button with the mode on', async () => {
    useUiStore.setState({ animationMode: true })
    const { engine, logger, slideId, nodeId } = await renderWithScene()
    expandNode('Boy')
    await screen.findByText('Position X')
    scrub(slideId, 2)

    fireEvent.click(subtrackAddButton('Boy', 'Position X'))

    await waitFor(() => {
      expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    })
    expect(engine.getKeyframes(nodeId, 'positionX')[0].time).toBe(2)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('AddKeyframe'))
  })

  it('creates a keyframe via right-click Add Keyframe with the mode off', async () => {
    const { engine, logger, slideId, nodeId } = await renderWithScene()
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

  it('creates pose keyframes via right-click on the node track with the mode off', async () => {
    const { engine, logger, slideId, nodeId } = await renderWithScene()
    const row = screen.getByRole('track', { name: 'Boy' })
    const li = row.closest('li')
    if (!li) {
      throw new Error('expected a track row')
    }
    scrub(slideId, 2)

    fireEvent.contextMenu(li as HTMLElement, { clientX: 100, clientY: 120 })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Keyframe' }))

    await waitFor(() => {
      expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(1)
    })
    expect(engine.getKeyframes(nodeId, 'positionX')[0].time).toBe(2)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Transaction'))
  })
})
