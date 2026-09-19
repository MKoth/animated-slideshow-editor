import { describe, expect, it, vi } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngineInternal } from '../engine/internal'
import type { Slide } from '../engine'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  TransactionCommand,
  UndoStack,
} from '../engine/commands'
import type { KeyframeTarget } from '../engine'
import {
  buildRangeMoveCommands,
  countPlannedMoves,
  planRangeMove,
  remapRangeTime,
} from '../app/moveKeyframesInRange'
import { snapshotRangeNodes } from '../app/rangeKeyframes'

function setup(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  slide: Slide
  parentId: string
  childId: string
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  const okProject = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  const okSlide = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!okProject.ok || !okSlide.ok || !slide) {
    throw new Error('expected setup commands to succeed')
  }
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
  const child = engine.createNode(slide.scene.id, parent.id, 'Child')
  return { engine, dispatcher, undoStack, slide, parentId: parent.id, childId: child.id }
}

function seed(engine: Engine, parentId: string, childId: string): void {
  engine.addKeyframe({ kind: 'node', nodeId: parentId, property: 'positionX' }, 1, 10)
  engine.addKeyframe({ kind: 'node', nodeId: parentId, property: 'positionX' }, 3, 20)
  engine.addKeyframe({ kind: 'node', nodeId: parentId, property: 'positionY' }, 2, 30)
  engine.addKeyframe({ kind: 'zIndex', nodeId: parentId }, 2, 5)
  engine.addKeyframe({ kind: 'morph', nodeId: parentId }, 1, 0.5)
  engine.addKeyframe({ kind: 'visible', nodeId: parentId }, 0, true)
  engine.addKeyframe({ kind: 'node', nodeId: childId, property: 'positionX' }, 2, 4)
}

function snapshotsOf(engine: Engine, slide: Slide, parentId: string) {
  return snapshotRangeNodes(slide.scene.getNode(parentId)!, slide, engine.materialDefinitions)
}

function targetKey(target: KeyframeTarget): string {
  if (target.kind === 'clip') {
    return `clip:${target.clipId}:${target.channel}`
  }
  if (target.kind === 'node' && 'property' in target) {
    return `${target.nodeId}:property:${target.property}`
  }
  if (target.kind === 'node' && 'parameter' in target) {
    return `${target.nodeId}:material:${target.parameter}`
  }
  return `${target.nodeId}:${target.kind}`
}

function timesOf(engine: Engine, nodeId: string, property: 'positionX' | 'positionY'): number[] {
  return engine
    .getKeyframes(nodeId, property)
    .map((keyframe) => keyframe.time)
    .sort((a, b) => a - b)
}

describe('moveKeyframesInRange helpers', () => {
  it('remaps times proportionally onto the target section', () => {
    expect(remapRangeTime(2, 0, 4, 0, 8)).toBe(4)
    expect(remapRangeTime(1, 0, 4, 10, 20)).toBeCloseTo(12.5)
    expect(remapRangeTime(3, 2, 4, 0, 1)).toBeCloseTo(0.5)
  })

  it('plans proportional moves for every checked track and skips identity moves', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeMove(snapshotsOf(engine, slide, parentId), 0, 4, 0, 8, slide.duration)
    expect(countPlannedMoves(plan)).toBe(6)
    const byTarget = new Map(plan.map((entry) => [targetKey(entry.target), entry.moves]))
    expect(byTarget.get(`${parentId}:property:positionX`)?.map((move) => move.newTime)).toEqual([
      2, 6,
    ])
    expect(byTarget.get(`${parentId}:property:positionY`)?.map((move) => move.newTime)).toEqual([4])
    expect(byTarget.get(`${parentId}:zIndex`)?.map((move) => move.newTime)).toEqual([4])
    expect(byTarget.get(`${parentId}:morph`)?.map((move) => move.newTime)).toEqual([2])
    expect(byTarget.get(`${childId}:property:positionX`)?.map((move) => move.newTime)).toEqual([4])
    // The keyframe at 0 maps to 0 — an identity no-op is not planned.
    expect(byTarget.has(`${parentId}:visible`)).toBe(false)
  })

  it('filters keyframes outside the source section', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeMove(snapshotsOf(engine, slide, parentId), 1, 2, 5, 5.5, slide.duration)
    expect(countPlannedMoves(plan)).toBe(5)
    const byTarget = new Map(plan.map((entry) => [targetKey(entry.target), entry.moves]))
    // Only the keyframe at 1 is inside the source; the one at 3 stays put.
    expect(byTarget.get(`${parentId}:property:positionX`)?.map((move) => move.newTime)).toEqual([5])
    expect(byTarget.get(`${parentId}:property:positionY`)?.map((move) => move.newTime)).toEqual([
      5.5,
    ])
    expect(byTarget.get(`${parentId}:zIndex`)?.map((move) => move.newTime)).toEqual([5.5])
    expect(byTarget.get(`${parentId}:morph`)?.map((move) => move.newTime)).toEqual([5])
    expect(byTarget.get(`${childId}:property:positionX`)?.map((move) => move.newTime)).toEqual([
      5.5,
    ])
    expect(byTarget.has(`${parentId}:visible`)).toBe(false)
  })

  it('skips unchecked tracks', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeMove(
      snapshotsOf(engine, slide, parentId),
      0,
      4,
      0,
      8,
      slide.duration,
      (nodeId, track) =>
        !(nodeId === parentId && track.trackKey === 'property:positionX') &&
        !(nodeId === parentId && track.trackKey === 'morph'),
    )
    expect(countPlannedMoves(plan)).toBe(3)
    const keys = new Set(plan.map((entry) => targetKey(entry.target)))
    expect(keys.has(`${parentId}:property:positionX`)).toBe(false)
    expect(keys.has(`${parentId}:morph`)).toBe(false)
    expect(keys.has(`${parentId}:property:positionY`)).toBe(true)
    expect(keys.has(`${parentId}:zIndex`)).toBe(true)
    expect(keys.has(`${childId}:property:positionX`)).toBe(true)
  })

  it('produces an empty plan for an identity mapping', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeMove(snapshotsOf(engine, slide, parentId), 0, 10, 0, 10, slide.duration)
    expect(plan).toEqual([])
  })

  it('moves every family as a single undo step via a transaction', () => {
    const { engine, dispatcher, undoStack, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeMove(snapshotsOf(engine, slide, parentId), 0, 4, 0, 8, slide.duration)
    const commands = buildRangeMoveCommands(plan)
    expect(commands).toHaveLength(5)

    const depthBefore = undoStack.entries.length
    const result = dispatcher.dispatch(new TransactionCommand(commands))
    expect(result.ok).toBe(true)
    expect(undoStack.entries.length).toBe(depthBefore + 1)
    expect(timesOf(engine, parentId, 'positionX')).toEqual([2, 6])
    expect(timesOf(engine, parentId, 'positionY')).toEqual([4])
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parentId })[0]!.time).toBe(4)
    expect(engine.getKeyframesOf({ kind: 'morph', nodeId: parentId })[0]!.time).toBe(2)
    expect(engine.getKeyframesOf({ kind: 'visible', nodeId: parentId })[0]!.time).toBe(0)
    expect(timesOf(engine, childId, 'positionX')).toEqual([4])
    // Values travel with the keyframes.
    const moved = engine
      .getKeyframes(parentId, 'positionX')
      .slice()
      .sort((a, b) => a.time - b.time)
    expect(moved.map((keyframe) => keyframe.value)).toEqual([10, 20])

    undoStack.undo(engine)
    expect(timesOf(engine, parentId, 'positionX')).toEqual([1, 3])
    expect(timesOf(engine, parentId, 'positionY')).toEqual([2])
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parentId })[0]!.time).toBe(2)
    expect(engine.getKeyframesOf({ kind: 'morph', nodeId: parentId })[0]!.time).toBe(1)
    expect(timesOf(engine, childId, 'positionX')).toEqual([2])
  })

  it('aborts the whole move when a destination time is occupied', () => {
    const { engine, dispatcher, undoStack, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    // Source [1, 2] -> target [3, 4]: the keyframe at 1 lands on the
    // stationary keyframe at 3 on positionX.
    const plan = planRangeMove(snapshotsOf(engine, slide, parentId), 1, 2, 3, 4, slide.duration)
    const depthBefore = undoStack.entries.length
    const result = dispatcher.dispatch(new TransactionCommand(buildRangeMoveCommands(plan)))
    expect(result.ok).toBe(false)
    expect(undoStack.entries.length).toBe(depthBefore)
    expect(timesOf(engine, parentId, 'positionX')).toEqual([1, 3])
    expect(timesOf(engine, parentId, 'positionY')).toEqual([2])
    expect(timesOf(engine, childId, 'positionX')).toEqual([2])
  })
})
