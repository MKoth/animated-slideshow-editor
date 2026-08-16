import { describe, expect, it, vi } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AddKeyframeCommand, CreateProjectCommand, CreateSlideCommand } from '../engine/commands'
import {
  deleteSelectedKeyframes,
  pruneKeyframeSelection,
  selectedKeyframeRefs,
} from '../app/keyframeSelectionActions'
import { useSelectionStore } from '../stores/selectionStore'

function setup(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  nodeId: string
  cameraId: string
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const logger = vi.fn()
  const dispatcher = new CommandDispatcher(engine, undoStack, logger)
  const okProject = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  const okSlide = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!okProject.ok || !okSlide.ok || !slide) {
    throw new Error('expected setup commands to succeed')
  }
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
  return { engine, dispatcher, undoStack, nodeId: node.id, cameraId: slide.scene.camera.id }
}

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: 'positionX' | 'positionY',
  time: number,
): string {
  const result = dispatcher.dispatch(
    new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value: 10 }),
  )
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error.message}`)
  }
  return result.inverse.keyframe.keyframeId
}

describe('selectedKeyframeRefs', () => {
  it('resolves selected keyframe ids to their node, property, id, and time', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 2)
    useSelectionStore.getState().selectKeyframes([first, second])

    const refs = selectedKeyframeRefs(toReadOnly(engine))

    expect(refs).toEqual([
      { nodeId, property: 'positionX', keyframeId: first, time: 1 },
      { nodeId, property: 'positionY', keyframeId: second, time: 2 },
    ])
  })

  it('resolves keyframes on the camera node', () => {
    const { engine, dispatcher, cameraId } = setup()
    const keyframeId = addKeyframe(dispatcher, cameraId, 'positionX', 1)
    useSelectionStore.getState().selectKeyframes([keyframeId])

    const refs = selectedKeyframeRefs(toReadOnly(engine))

    expect(refs).toEqual([{ nodeId: cameraId, property: 'positionX', keyframeId, time: 1 }])
  })

  it('drops ids that no longer exist in the engine', () => {
    const { engine, dispatcher, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    useSelectionStore.getState().selectKeyframes([first, 'ghost'])

    const refs = selectedKeyframeRefs(toReadOnly(engine))

    expect(refs).toEqual([{ nodeId, property: 'positionX', keyframeId: first, time: 1 }])
  })

  it('returns an empty list when no keyframes are selected', () => {
    const { engine } = setup()

    expect(selectedKeyframeRefs(toReadOnly(engine))).toEqual([])
  })
})

describe('deleteSelectedKeyframes', () => {
  it('deletes every selected keyframe as one history entry and clears the selection', () => {
    const { engine, dispatcher, undoStack, nodeId } = setup()
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 2)
    useSelectionStore.getState().selectKeyframes([first, second])
    const before = undoStack.entries.length

    const deleted = deleteSelectedKeyframes(toReadOnly(engine), (command) =>
      dispatcher.dispatch(command),
    )

    expect(deleted).toBe(true)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(0)
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })

  it('deleting the final keyframe of a property reverts it to its static value', () => {
    const { engine, dispatcher, nodeId } = setup()
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    useSelectionStore.getState().selectKeyframes([keyframeId])

    deleteSelectedKeyframes(toReadOnly(engine), (command) => dispatcher.dispatch(command))

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    const evaluated = engine.evaluateNode(nodeId, 5)
    expect(evaluated.transform.x).toBe(0)
  })

  it('returns false and dispatches nothing when nothing is selected', () => {
    const { engine, dispatcher, undoStack } = setup()
    const before = undoStack.entries.length

    const deleted = deleteSelectedKeyframes(toReadOnly(engine), (command) =>
      dispatcher.dispatch(command),
    )

    expect(deleted).toBe(false)
    expect(undoStack.entries).toHaveLength(before)
  })
})

describe('pruneKeyframeSelection', () => {
  it('removes keyframe selection entries that no longer exist in the engine', () => {
    const { engine, dispatcher, nodeId } = setup()
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1)
    useSelectionStore.getState().selectKeyframes([keyframeId, 'ghost'])

    pruneKeyframeSelection(toReadOnly(engine))

    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([keyframeId])
  })
})
