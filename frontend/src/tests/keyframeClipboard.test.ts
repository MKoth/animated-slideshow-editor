import { beforeEach, describe, expect, it } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AddKeyframeCommand, CreateProjectCommand, CreateSlideCommand } from '../engine/commands'
import { copyKeyframes, pasteKeyframes, duplicateKeyframes } from '../app/keyframeSelectionActions'
import { openProjectInEditor } from '../app/openProjectActions'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import { useKeyframeClipboardStore } from '../stores/keyframeClipboardStore'
import { usePlaybackController } from '../stores/playbackStore'

beforeEach(() => {
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
  useKeyframeClipboardStore.setState({ targets: [], originTime: 0 })
  usePlaybackController.setState({ currentTimes: {} })
})

function setup(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  nodeId: string
  slideId: string
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  const okProject = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  const okSlide = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!okProject.ok || !okSlide.ok || !slide) {
    throw new Error('expected setup commands to succeed')
  }
  engine.setActiveSlide(slide.id)
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
  return { engine, dispatcher, undoStack, nodeId: node.id, slideId: slide.id }
}

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: 'positionX' | 'positionY',
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

function selectKeyframes(keyframeIds: readonly string[]): void {
  const store = useTimelineSelectionStore.getState()
  store.clearSelection()
  for (const id of keyframeIds) {
    store.toggleKeyframe(id)
  }
}

function setPlayheadTime(slideId: string, time: number): void {
  usePlaybackController.setState((state) => ({
    currentTimes: { ...state.currentTimes, [slideId]: time },
  }))
}

describe('copyKeyframes', () => {
  it('is a no-op with no selection', () => {
    const { engine } = setup()

    copyKeyframes(toReadOnly(engine))

    expect(useKeyframeClipboardStore.getState().targets).toEqual([])
  })

  it('captures relative times, values, interpolation, and tangents against the earliest keyframe', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 3, 30)
    const third = addKeyframe(dispatcher, nodeId, 'positionX', 5, 50)
    selectKeyframes([first, second, third])

    copyKeyframes(toReadOnly(engine))

    const { targets, originTime } = useKeyframeClipboardStore.getState()
    expect(originTime).toBe(1)
    expect(targets).toHaveLength(1)
    expect(targets[0].target).toEqual({ kind: 'node', nodeId, property: 'positionX' })
    expect(targets[0].payload.keyframes).toHaveLength(3)
    expect(targets[0].payload.keyframes[0].time).toBe(0)
    expect(targets[0].payload.keyframes[1].time).toBe(2)
    expect(targets[0].payload.keyframes[2].time).toBe(4)
    expect(targets[0].payload.keyframes[0].value).toBe(10)
    expect(targets[0].payload.keyframes[1].value).toBe(30)
    expect(targets[0].payload.keyframes[2].value).toBe(50)
  })

  it('copies interpolation and tangents for each keyframe', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 0)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 1, 100)
    selectKeyframes([first, second])

    copyKeyframes(toReadOnly(engine))

    const { targets } = useKeyframeClipboardStore.getState()
    const keyframes = targets[0].payload.keyframes
    for (const kf of keyframes) {
      expect(kf.interpolation).toBeDefined()
      expect(kf.tangentIn).toBeDefined()
      expect(kf.tangentOut).toBeDefined()
    }
  })

  it('groups keyframes by target when selection spans multiple properties', () => {
    const { engine, dispatcher, nodeId } = setup()
    const px = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const py = addKeyframe(dispatcher, nodeId, 'positionY', 2, 20)
    selectKeyframes([px, py])

    copyKeyframes(toReadOnly(engine))

    const { targets } = useKeyframeClipboardStore.getState()
    expect(targets).toHaveLength(2)
    const props = targets.map((t) => ('property' in t.target ? t.target.property : '')).sort()
    expect(props).toEqual(['positionX', 'positionY'])
  })

  it('replaces previous clipboard contents', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 0)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))
    expect(useKeyframeClipboardStore.getState().targets).toHaveLength(1)

    const second = addKeyframe(dispatcher, nodeId, 'positionY', 1, 1)
    selectKeyframes([second])
    copyKeyframes(toReadOnly(engine))

    const { targets } = useKeyframeClipboardStore.getState()
    expect(targets).toHaveLength(1)
    expect(targets[0].target).toEqual({ kind: 'node', nodeId, property: 'positionY' })
  })
})

describe('pasteKeyframes', () => {
  it('is a no-op with an empty clipboard', () => {
    const { engine, dispatcher, undoStack } = setup()
    const before = undoStack.entries.length

    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(undoStack.entries).toHaveLength(before)
  })

  it('pastes keyframes at the playhead position with relative offsets', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 3, 30)
    selectKeyframes([first, second])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    setPlayheadTime(slideId, 5)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes).toHaveLength(4)
    const times = keyframes.map((kf) => kf.time).sort((a, b) => a - b)
    expect(times).toEqual([1, 3, 5, 7])
  })

  it('preserves values, interpolation, and tangents from clipboard', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 42)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    setPlayheadTime(slideId, 2)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    const pasted = keyframes.find((kf) => kf.time === 2)
    expect(pasted).toBeDefined()
    expect(pasted!.value).toBe(42)
  })

  it('clamps pasted keyframes to [0, slide.duration]', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    // Paste at the very end of the slide (duration=5) so the keyframe
    // lands at exactly 5, which is at the boundary
    setPlayheadTime(slideId, 5)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    const pasted = keyframes.find((kf) => kf.time !== 0)
    expect(pasted).toBeDefined()
    expect(pasted!.time).toBeLessThanOrEqual(5)
  })

  it('pastes onto the source target by default', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    setPlayheadTime(slideId, 2)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(2)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(0)
  })

  it('pastes onto a different property when exactly one other property is selected', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    // Select a keyframe on positionY to indicate target override
    const pyKf = addKeyframe(dispatcher, nodeId, 'positionY', 0, 0)
    selectKeyframes([pyKf])
    setPlayheadTime(slideId, 2)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(2)
  })

  it('clears the selection after paste', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    setPlayheadTime(slideId, 2)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])
  })

  it('creates new keyframe ids (no reuse)', () => {
    const { engine, dispatcher, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    setPlayheadTime(slideId, 2)
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    const ids = keyframes.map((kf) => kf.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('undoes as one entry (TransactionCommand)', () => {
    const { engine, dispatcher, undoStack, nodeId, slideId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 0, 0)
    selectKeyframes([first, second])
    copyKeyframes(toReadOnly(engine))

    selectKeyframes([])
    setPlayheadTime(slideId, 2)
    const before = undoStack.entries.length
    pasteKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })
})

describe('duplicateKeyframes', () => {
  it('is a no-op with no selection', () => {
    const { engine, dispatcher, undoStack } = setup()
    const before = undoStack.entries.length

    duplicateKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(undoStack.entries).toHaveLength(before)
  })

  it('places copies immediately after the last keyframe', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 3, 30)
    selectKeyframes([first, second])

    duplicateKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes).toHaveLength(4)
    const times = keyframes.map((kf) => kf.time).sort((a, b) => a - b)
    expect(times[2]).toBeGreaterThan(3)
  })

  it('preserves relative spacing of duplicated keyframes', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 3, 30)
    selectKeyframes([first, second])

    duplicateKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    const sorted = [...keyframes].sort((a, b) => a.time - b.time)
    const originalSpacing = sorted[1].time - sorted[0].time
    const dupSpacing = sorted[3].time - sorted[2].time
    expect(dupSpacing).toBe(originalSpacing)
  })

  it('preserves values, interpolation, and tangents', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 42)
    selectKeyframes([first])

    duplicateKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes).toHaveLength(2)
    expect(keyframes[0].value).toBe(keyframes[1].value)
    expect(keyframes[0].interpolation).toBe(keyframes[1].interpolation)
  })

  it('creates new keyframe ids', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])

    duplicateKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    const ids = keyframes.map((kf) => kf.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('undoes as one entry (TransactionCommand)', () => {
    const { engine, dispatcher, undoStack, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 0, 0)
    selectKeyframes([first, second])
    const before = undoStack.entries.length

    duplicateKeyframes(toReadOnly(engine), (cmd) => dispatcher.dispatch(cmd))

    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })
})

describe('keyframe clipboard — session lifecycle', () => {
  it('clears on project open', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))
    expect(useKeyframeClipboardStore.getState().targets).toHaveLength(1)

    const engine2 = createEngineInternal()
    engine2.createProject({ name: 'New' })
    engine2.createSlide()
    const project2 = engine2.project
    if (!project2) {
      throw new Error('expected project')
    }
    openProjectInEditor(toReadOnly(engine2), project2)

    expect(useKeyframeClipboardStore.getState().targets).toEqual([])
  })

  it('survives editing context switches', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    selectKeyframes([first])
    copyKeyframes(toReadOnly(engine))

    // Switch to clip-edit context
    useTimelineSelectionStore.getState().setEditingContext('clip-edit')
    expect(useKeyframeClipboardStore.getState().targets).toHaveLength(1)

    // Switch back to slide context
    useTimelineSelectionStore.getState().setEditingContext('slide')
    expect(useKeyframeClipboardStore.getState().targets).toHaveLength(1)
  })
})
