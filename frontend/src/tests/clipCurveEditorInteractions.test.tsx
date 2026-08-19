import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CurveEditorPanel } from '../components/panels/CurveEditorPanel'
import {
  CommandDispatcher,
  UndoStack,
  MoveClipKeyframesCommand,
  SetClipKeyframeTangentsCommand,
  SetClipKeyframeInterpolationCommand,
  DeleteClipKeyframesCommand,
  AddClipKeyframeCommand,
} from '../engine/commands'
import type { Command } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import { useClipLibraryStore } from '../stores/clipLibraryStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { useCurveEditorViewStore } from '../stores/curveEditorViewStore'
import { useKeyframeClipboardStore } from '../stores/keyframeClipboardStore'
import { registerClipboardShortcuts } from '../shortcuts/clipboardShortcuts'
import { formatCombo, getShortcutHandler } from '../shortcuts/shortcutRegistry'
import type { AnimationProperty } from '../engine'

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

function createNode(engine: Engine, name: string) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('expected a slide')
  return engine.createNode(slide.scene.id, slide.scene.root.id, name)
}

function createClipWithChannels(engine: Engine, name: string, channels: AnimationProperty[]) {
  return engine.createClip(
    name,
    2,
    'motion',
    [],
    channels.map((ch) => ({ property: ch })),
  )
}

function enterClipEditMode(_engine: Engine, clipId: string) {
  useClipLibraryStore.getState().selectClip(clipId)
  useKeyframeClipboardStore.getState().setClipEditContext(clipId)
  useTimelineSelectionStore.getState().setEditingContext('clip-edit')
  useTimelineSelectionStore.getState().clearSelection()
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

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
  useClipLibraryStore.setState({ selectedId: null })
  useKeyframeClipboardStore.setState({ clipEditClipId: null })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: 200 })
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

function getSelectedKeyframeIds(): readonly string[] {
  return selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
}

function selectClipKeyframe(keyframeId: string, time: number) {
  useTimelineSelectionStore.getState().selectKeyframe(keyframeId, { time, rowIndex: 0 })
}

describe('Clip curve editor — renders clip curves', () => {
  it('renders clip channel curves in the track list', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX', 'positionY'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 1, 100)
    engine.addClipChannelKeyframe(clip.id, 'positionY', 0, 50)
    engine.addClipChannelKeyframe(clip.id, 'positionY', 1, 150)

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    const clipDef = engine.getClip(clip.id)
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
          duration={1}
          scene={slide.scene}
          viewportWidth={800}
          clip={clipDef}
        />
      </EngineContext.Provider>,
    )

    expect(container.querySelector('.curve-editor-panel')).toBeInTheDocument()
    expect(screen.getByText('Position X')).toBeInTheDocument()
    expect(screen.getByText('Position Y')).toBeInTheDocument()
  })

  it('clip keyframes use normalized time [0, 1]', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.25, 25)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 50)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 1, 100)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    expect(keyframes.map((kf) => kf.time).sort((a, b) => a - b)).toEqual([0, 0.25, 0.5, 1])
  })
})

describe('Clip curve editor — selection', () => {
  it('selects clip keyframes in clip-edit context', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    selectClipKeyframe(keyframes[0].id, 0)

    expect(getSelectedKeyframeIds()).toContain(keyframes[0].id)
    expect(useTimelineSelectionStore.getState().editingContext).toBe('clip-edit')
  })

  it('toggles clip keyframe selection', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    selectClipKeyframe(keyframes[0].id, 0)
    useTimelineSelectionStore.getState().toggleKeyframe(keyframes[1].id, { time: 0.5, rowIndex: 1 })

    expect(getSelectedKeyframeIds()).toHaveLength(2)
    expect(getSelectedKeyframeIds()).toContain(keyframes[0].id)
    expect(getSelectedKeyframeIds()).toContain(keyframes[1].id)
  })

  it('clears clip keyframe selection', async () => {
    const { engine } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    selectClipKeyframe(keyframes[0].id, 0)
    expect(getSelectedKeyframeIds()).toHaveLength(1)

    useTimelineSelectionStore.getState().clearSelection()
    expect(getSelectedKeyframeIds()).toHaveLength(0)
  })
})

describe('Clip curve editor — delete keyframes', () => {
  it('deletes selected clip keyframes via keyboard shortcut', async () => {
    const { engine, dispatcher, undoStack } = renderTimeline()
    createProjectAndSlide(engine)
    createNode(engine, 'Boy')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    enterClipEditMode(engine, clip.id)

    await waitFor(() => {
      expect(screen.getByText('Clip Edit')).toBeInTheDocument()
    })

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    selectClipKeyframe(keyframes[0].id, 0)

    // Verify selection is correct
    const selectedIds = getSelectedKeyframeIds()
    expect(selectedIds).toHaveLength(1)
    expect(selectedIds[0]).toBe(keyframes[0].id)

    const before = undoStack.entries.length
    const dispose = registerDeleteShortcuts(engine, dispatcher)

    fireEvent.keyDown(window, { key: 'Delete' })

    const remaining = engine.getClipChannelKeyframes(clip.id, 'positionX')
    expect(remaining).toHaveLength(1)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('DeleteClipKeyframes')
    dispose()
  })

  it('deletes selected clip keyframes via direct dispatch', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    expect(keyframes.length).toBe(2)

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())

    const result = dispatcher.dispatch(
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        keyframeIds: [keyframes[0].id],
      }),
    )

    expect(result.ok).toBe(true)
    const remaining = engine.getClipChannelKeyframes(clip.id, 'positionX')
    expect(remaining.length).toBe(1)
    expect(undoStack.entries[0].type).toBe('DeleteClipKeyframes')
  })

  it('undo restores clip keyframe via inverse command', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())

    dispatcher.dispatch(
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        keyframeIds: [keyframes[0].id],
      }),
    )

    expect(engine.getClipChannelKeyframes(clip.id, 'positionX')).toHaveLength(1)

    // Simulate undo by replaying the inverse
    const inverse = undoStack.entries[0].inverse as {
      target: { kind: 'clip'; clipId: string; channel: AnimationProperty }
      keyframes: {
        keyframeId: string
        time: number
        value: number
        interpolation: string
        tangentIn: { time: number; value: number }
        tangentOut: { time: number; value: number }
      }[]
    }
    for (const kf of inverse.keyframes) {
      dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: inverse.target,
          time: kf.time,
          value: kf.value,
        }),
      )
    }

    const restored = engine.getClipChannelKeyframes(clip.id, 'positionX')
    expect(restored).toHaveLength(2)
  })
})

describe('Clip curve editor — double-click tangent reset', () => {
  it('double-click resets clip keyframe tangents to zero', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 50)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    const kf = keyframes[0]

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())

    dispatcher.dispatch(
      new SetClipKeyframeTangentsCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        keyframeId: kf.id,
        tangentIn: { time: -0.5, value: -20 },
        tangentOut: { time: 0.5, value: 20 },
      }),
    )

    const updated = engine.getClipChannelKeyframes(clip.id, 'positionX')[0]
    expect(updated.tangentIn.time).toBe(-0.5)
    expect(updated.tangentOut.time).toBe(0.5)

    const ZERO_TANGENT = { time: 0, value: 0 }
    dispatcher.dispatch(
      new SetClipKeyframeTangentsCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        keyframeId: kf.id,
        tangentIn: ZERO_TANGENT,
        tangentOut: ZERO_TANGENT,
      }),
    )

    const reset = engine.getClipChannelKeyframes(clip.id, 'positionX')[0]
    expect(reset.tangentIn.time).toBe(0)
    expect(reset.tangentIn.value).toBe(0)
    expect(reset.tangentOut.time).toBe(0)
    expect(reset.tangentOut.value).toBe(0)
  })
})

describe('Clip curve editor — interpolation change', () => {
  it('dispatches SetClipKeyframeInterpolationCommand', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 50)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    const kf = keyframes[0]
    expect(kf.interpolation).toBe('linear')

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    const result = dispatcher.dispatch(
      new SetClipKeyframeInterpolationCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        keyframeId: kf.id,
        interpolation: 'bezier',
      }),
    )

    expect(result.ok).toBe(true)
    const updated = engine.getClipChannelKeyframes(clip.id, 'positionX')[0]
    expect(updated.interpolation).toBe('bezier')
    expect(undoStack.entries[0].type).toBe('SetClipKeyframeInterpolation')
  })
})

describe('Clip curve editor — marquee selection', () => {
  it('marquee selects clip keyframes via store', () => {
    useTimelineSelectionStore.getState().setEditingContext('clip-edit')

    useTimelineSelectionStore.getState().marqueeEnd(
      ['kf-1', 'kf-2', 'kf-3'],
      [
        { keyframeId: 'kf-1', time: 0, rowIndex: 0 },
        { keyframeId: 'kf-2', time: 0.5, rowIndex: 0 },
        { keyframeId: 'kf-3', time: 1, rowIndex: 0 },
      ],
    )

    const selected = useTimelineSelectionStore.getState().selections['clip-edit']
    expect(selected).toHaveLength(3)
    expect(selected.map((s) => s.keyframeId)).toEqual(['kf-1', 'kf-2', 'kf-3'])
  })
})

describe('Clip curve editor — time clamping', () => {
  it('MoveClipKeyframesCommand rejects time > 1', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 50)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    const kf = keyframes[0]

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())

    const result = dispatcher.dispatch(
      new MoveClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        moves: [{ keyframeId: kf.id, newTime: 1.5 }],
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('MoveClipKeyframesCommand accepts time within [0, 1]', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.2, 50)

    const keyframes = engine.getClipChannelKeyframes(clip.id, 'positionX')
    const kf = keyframes[0]

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())

    const result = dispatcher.dispatch(
      new MoveClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        moves: [{ keyframeId: kf.id, newTime: 0.8 }],
      }),
    )

    expect(result.ok).toBe(true)
    const moved = engine.getClipChannelKeyframes(clip.id, 'positionX')[0]
    expect(moved.time).toBe(0.8)
  })
})

describe('Clip curve editor — undo', () => {
  it('undo restores clip keyframes via inverse command replay', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    const clip = createClipWithChannels(engine, 'Test Clip', ['positionX'])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 100)

    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())

    // Delete one keyframe
    dispatcher.dispatch(
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: 'positionX' },
        keyframeIds: [engine.getClipChannelKeyframes(clip.id, 'positionX')[0].id],
      }),
    )

    expect(engine.getClipChannelKeyframes(clip.id, 'positionX')).toHaveLength(1)

    // Replay inverse to undo
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('DeleteClipKeyframes')
    const inverse = entry.inverse as {
      target: { kind: 'clip'; clipId: string; channel: AnimationProperty }
      keyframes: { time: number; value: number }[]
    }
    for (const kf of inverse.keyframes) {
      dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: inverse.target,
          time: kf.time,
          value: kf.value,
        }),
      )
    }

    expect(engine.getClipChannelKeyframes(clip.id, 'positionX')).toHaveLength(2)
  })
})
