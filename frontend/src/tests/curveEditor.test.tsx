import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CurveEditorPanel } from '../components/panels/CurveEditorPanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { useCurveEditorViewStore } from '../stores/curveEditorViewStore'
import { useTimelineSelectionStore } from '../stores/timelineSelectionStore'
import { AddKeyframeCommand } from '../engine/commands'
import type { AnimationProperty } from '../engine'

function renderPanel(): {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
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
  return { engine, undoStack, dispatcher }
}

function createProjectAndSlide(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  return engine.createSlide('Slide 1')
}

function createNode(engine: Engine, name: string, parent?: string) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('expected a slide')
  return engine.createNode(slide.scene.id, parent ?? slide.scene.root.id, name)
}

function addKeyframe(
  engine: Engine,
  nodeId: string,
  property: AnimationProperty,
  time: number,
  value: number,
) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('expected a slide')
  const dispatcher = new CommandDispatcher(engine, new UndoStack(), vi.fn())
  dispatcher.dispatch(
    new AddKeyframeCommand({
      target: { kind: 'node', nodeId, property },
      time,
      value,
    }),
  )
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: 200 })
  useCurveEditorViewStore.persist.clearStorage()
  useCurveEditorViewStore.setState({
    zoomLevel: 1,
    scrollX: 0,
    scrollY: 0,
    filter: 'all',
    viewMode: 'dopeSheet',
    fitPending: false,
    frameSelectedPending: false,
  })
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
  localStorage.clear()
})

describe('TimelinePanel view toggle', () => {
  it('renders Dope Sheet and Curve Editor toggle buttons', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    expect(await screen.findByText('Dope Sheet')).toBeInTheDocument()
    expect(screen.getByText('Curve Editor')).toBeInTheDocument()
  })

  it('defaults to dope sheet view', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    await screen.findByRole('track', { name: 'Boy' })
    expect(useCurveEditorViewStore.getState().viewMode).toBe('dopeSheet')
  })

  it('switches to curve editor when clicking Curve Editor button', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    await screen.findByRole('track', { name: 'Boy' })

    act(() => {
      fireEvent.click(screen.getByText('Curve Editor'))
    })

    expect(useCurveEditorViewStore.getState().viewMode).toBe('curveEditor')
  })

  it('switches back to dope sheet when clicking Dope Sheet button', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    await screen.findByRole('track', { name: 'Boy' })

    act(() => {
      fireEvent.click(screen.getByText('Curve Editor'))
    })
    act(() => {
      fireEvent.click(screen.getByText('Dope Sheet'))
    })

    expect(useCurveEditorViewStore.getState().viewMode).toBe('dopeSheet')
  })

  it('shows Fit Curves and Frame Selected buttons in curve editor mode', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    await screen.findByRole('track', { name: 'Boy' })

    act(() => {
      fireEvent.click(screen.getByText('Curve Editor'))
    })

    expect(screen.getByText('Fit Curves')).toBeInTheDocument()
    expect(screen.getByText('Frame Selected')).toBeInTheDocument()
  })

  it('persists view mode to localStorage', async () => {
    const { engine } = renderPanel()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    await screen.findByRole('track', { name: 'Boy' })

    act(() => {
      fireEvent.click(screen.getByText('Curve Editor'))
    })

    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.viewMode).toBe('curveEditor')
  })
})

describe('CurveEditorPanel', () => {
  it('renders with a scene that has nodes', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    addKeyframe(engine, node.id, 'positionX', 0, 0)
    addKeyframe(engine, node.id, 'positionX', 1, 100)

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    }

    const { container } = render(
      <EngineContext.Provider value={value}>
        <CurveEditorPanel
          slideId={slide.id}
          duration={slide.duration}
          scene={slide.scene}
          viewportWidth={800}
        />
      </EngineContext.Provider>,
    )

    expect(container.querySelector('.curve-editor-panel')).toBeInTheDocument()
    expect(container.querySelector('.curve-editor-canvas')).toBeInTheDocument()
  })

  it('shows track list with property curves', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    addKeyframe(engine, node.id, 'positionX', 0, 0)
    addKeyframe(engine, node.id, 'positionX', 1, 100)

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    }

    render(
      <EngineContext.Provider value={value}>
        <CurveEditorPanel
          slideId={slide.id}
          duration={slide.duration}
          scene={slide.scene}
          viewportWidth={800}
        />
      </EngineContext.Provider>,
    )

    expect(screen.getByText('Position X')).toBeInTheDocument()
  })

  it('responds to filter changes', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    addKeyframe(engine, node.id, 'positionX', 0, 0)
    addKeyframe(engine, node.id, 'positionX', 1, 100)
    addKeyframe(engine, node.id, 'opacity', 0, 1)
    addKeyframe(engine, node.id, 'opacity', 1, 0)

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    }

    render(
      <EngineContext.Provider value={value}>
        <CurveEditorPanel
          slideId={slide.id}
          duration={slide.duration}
          scene={slide.scene}
          viewportWidth={800}
        />
      </EngineContext.Provider>,
    )

    expect(screen.getByText('Position X')).toBeInTheDocument()
    expect(screen.getByText('Opacity')).toBeInTheDocument()

    act(() => {
      useCurveEditorViewStore.getState().setFilter('position')
    })

    expect(screen.getByText('Position X')).toBeInTheDocument()
    expect(screen.queryByText('Opacity')).not.toBeInTheDocument()
  })
})

describe('Curve editor selection', () => {
  it('selects keyframe via timeline selection store', () => {
    const store = useTimelineSelectionStore.getState()
    store.selectKeyframe('kf-1', { time: 0, rowIndex: 0 })
    expect(useTimelineSelectionStore.getState().selections.slide).toHaveLength(1)
    expect(useTimelineSelectionStore.getState().selections.slide[0].keyframeId).toBe('kf-1')
  })

  it('toggles keyframe selection', () => {
    const store = useTimelineSelectionStore.getState()
    store.selectKeyframe('kf-1', { time: 0, rowIndex: 0 })
    store.toggleKeyframe('kf-2', { time: 1, rowIndex: 1 })
    expect(useTimelineSelectionStore.getState().selections.slide).toHaveLength(2)

    store.toggleKeyframe('kf-1')
    expect(useTimelineSelectionStore.getState().selections.slide).toHaveLength(1)
    expect(useTimelineSelectionStore.getState().selections.slide[0].keyframeId).toBe('kf-2')
  })

  it('clears selection', () => {
    const store = useTimelineSelectionStore.getState()
    store.selectKeyframe('kf-1', { time: 0, rowIndex: 0 })
    store.clearSelection()
    expect(useTimelineSelectionStore.getState().selections.slide).toHaveLength(0)
  })
})

describe('Curve editor view state persistence', () => {
  it('persists zoom and scroll to localStorage', () => {
    useCurveEditorViewStore.getState().setZoom(3, 0, 800)
    useCurveEditorViewStore.getState().setScroll(100, 50)

    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.zoomLevel).toBe(3)
    expect(stored.state.scrollX).toBe(100)
    expect(stored.state.scrollY).toBe(50)
  })

  it('persists filter to localStorage', () => {
    useCurveEditorViewStore.getState().setFilter('rotation')

    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.filter).toBe('rotation')
  })
})
