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
  buildRangeCopyCommands,
  mapCopyTangents,
  planRangeCopy,
  remapCopyTime,
} from '../app/copyKeyframesInRange'
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

function readerOf(engine: Engine) {
  return (target: KeyframeTarget) => engine.getKeyframesOf(target)
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

describe('copyKeyframesInRange helpers', () => {
  it('remaps times proportionally onto the target section', () => {
    expect(remapCopyTime(2, 0, 4, 0, 8, false)).toBe(4)
    expect(remapCopyTime(1, 0, 4, 10, 20, false)).toBeCloseTo(12.5)
    expect(remapCopyTime(3, 2, 4, 0, 1, false)).toBeCloseTo(0.5)
  })

  it('mirrors times inside the destination window when reversing', () => {
    // Source [0, 4] onto [10, 20]: start lands on dest end and vice versa.
    expect(remapCopyTime(0, 0, 4, 10, 20, true)).toBe(20)
    expect(remapCopyTime(4, 0, 4, 10, 20, true)).toBe(10)
    expect(remapCopyTime(1, 0, 4, 10, 20, true)).toBeCloseTo(17.5)
  })

  it('maps tangents verbatim without reverse', () => {
    const mapped = mapCopyTangents(
      { time: -0.2, value: -1 },
      { time: 0.3, value: 2 },
      'bezier',
      false,
    )
    expect(mapped.tangentIn).toEqual({ time: -0.2, value: -1 })
    expect(mapped.tangentOut).toEqual({ time: 0.3, value: 2 })
  })

  it('swaps and negates bezier tangents when reversing', () => {
    const mapped = mapCopyTangents(
      { time: -0.2, value: -1 },
      { time: 0.3, value: 2 },
      'bezier',
      true,
    )
    expect(mapped.tangentIn).toEqual({ time: -0.3, value: -2 })
    expect(mapped.tangentOut).toEqual({ time: 0.2, value: 1 })
  })

  it('zeroes non-bezier tangents when reversing', () => {
    const mapped = mapCopyTangents(
      { time: -0.2, value: -1 },
      { time: 0.3, value: 2 },
      'linear',
      true,
    )
    expect(mapped.tangentIn).toEqual({ time: 0, value: 0 })
    expect(mapped.tangentOut).toEqual({ time: 0, value: 0 })
  })

  it('plans proportional copies for every checked track and leaves sources in place', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeCopy(
      snapshotsOf(engine, slide, parentId),
      readerOf(engine),
      0,
      4,
      0,
      8,
      slide.duration,
    )
    expect(plan.copied).toBe(6)
    // The visible key at 0 remaps onto itself and is skipped as occupied.
    expect(plan.skipped).toBe(1)
    const byTarget = new Map(plan.entries.map((entry) => [targetKey(entry.target), entry.copies]))
    expect(byTarget.get(`${parentId}:property:positionX`)?.map((copy) => copy.newTime)).toEqual([
      2, 6,
    ])
    expect(byTarget.get(`${parentId}:property:positionY`)?.map((copy) => copy.newTime)).toEqual([4])
    // Values travel with the copies.
    expect(byTarget.get(`${parentId}:property:positionX`)?.map((copy) => copy.value)).toEqual([
      10, 20,
    ])
    // Sources are untouched by planning.
    expect(timesOf(engine, parentId, 'positionX')).toEqual([1, 3])
  })

  it('reverses the copy order so the section end lands on the destination start', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeCopy(
      snapshotsOf(engine, slide, parentId),
      readerOf(engine),
      0,
      4,
      4,
      8,
      slide.duration,
      () => true,
      true,
    )
    const byTarget = new Map(plan.entries.map((entry) => [targetKey(entry.target), entry.copies]))
    const copies = byTarget.get(`${parentId}:property:positionX`)!
    expect(copies.map((copy) => copy.newTime)).toEqual([5, 7])
    // The first source key (value 10) lands on the later destination time.
    expect(copies.map((copy) => copy.value)).toEqual([20, 10])
  })

  it('skips copies that would land on occupied destination times', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    // Source [0, 2] onto [2, 4]: parent positionX at 1 remaps onto the
    // stationary keyframe at 3, which stays outside the source section.
    const plan = planRangeCopy(
      snapshotsOf(engine, slide, parentId),
      readerOf(engine),
      0,
      2,
      2,
      4,
      slide.duration,
    )
    expect(plan.skipped).toBe(1)
    expect(plan.copied).toBe(5)
    const keys = new Set(plan.entries.map((entry) => targetKey(entry.target)))
    expect(keys.has(`${parentId}:property:positionX`)).toBe(false)
    expect(keys.has(`${parentId}:property:positionY`)).toBe(true)
    expect(keys.has(`${childId}:property:positionX`)).toBe(true)
  })

  it('plans nothing and reports skips for an identity copy', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeCopy(
      snapshotsOf(engine, slide, parentId),
      readerOf(engine),
      0,
      10,
      0,
      10,
      slide.duration,
    )
    expect(plan.entries).toEqual([])
    expect(plan.copied).toBe(0)
    expect(plan.skipped).toBe(7)
  })

  it('skips unchecked tracks', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeCopy(
      snapshotsOf(engine, slide, parentId),
      readerOf(engine),
      0,
      4,
      0,
      8,
      slide.duration,
      (nodeId, track) =>
        !(nodeId === parentId && track.trackKey === 'property:positionX') &&
        !(nodeId === parentId && track.trackKey === 'morph'),
    )
    expect(plan.copied).toBe(3)
    const keys = new Set(plan.entries.map((entry) => targetKey(entry.target)))
    expect(keys.has(`${parentId}:property:positionX`)).toBe(false)
    expect(keys.has(`${parentId}:morph`)).toBe(false)
    expect(keys.has(`${parentId}:property:positionY`)).toBe(true)
  })

  it('copies every family as a single undo step via a transaction', () => {
    const { engine, dispatcher, undoStack, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const plan = planRangeCopy(
      snapshotsOf(engine, slide, parentId),
      readerOf(engine),
      0,
      4,
      4,
      8,
      slide.duration,
    )
    expect(plan.copied).toBe(7)
    const commands = buildRangeCopyCommands(plan.entries)
    expect(commands).toHaveLength(6)

    const depthBefore = undoStack.entries.length
    const result = dispatcher.dispatch(new TransactionCommand(commands))
    expect(result.ok).toBe(true)
    expect(undoStack.entries.length).toBe(depthBefore + 1)
    // Sources stay; copies land scaled onto [4, 8].
    expect(timesOf(engine, parentId, 'positionX')).toEqual([1, 3, 5, 7])
    expect(timesOf(engine, parentId, 'positionY')).toEqual([2, 6])
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parentId }).map((k) => k.time)).toEqual([
      2, 6,
    ])
    expect(engine.getKeyframesOf({ kind: 'visible', nodeId: parentId }).map((k) => k.time)).toEqual(
      [0, 4],
    )
    expect(timesOf(engine, childId, 'positionX')).toEqual([2, 6])
    const copies = engine
      .getKeyframes(parentId, 'positionX')
      .filter((keyframe) => keyframe.time >= 4)
      .sort((a, b) => a.time - b.time)
    expect(copies.map((keyframe) => keyframe.value)).toEqual([10, 20])

    undoStack.undo(engine)
    expect(timesOf(engine, parentId, 'positionX')).toEqual([1, 3])
    expect(timesOf(engine, parentId, 'positionY')).toEqual([2])
    expect(timesOf(engine, childId, 'positionX')).toEqual([2])
  })
})
