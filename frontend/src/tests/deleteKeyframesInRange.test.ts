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
  buildRangeDeleteCommands,
  countPlannedDeletes,
  countTrackInRange,
  planRangeDelete,
  snapshotRangeNodes,
} from '../app/deleteKeyframesInRange'

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
  engine.addKeyframe({ kind: 'node', nodeId: parentId, property: 'positionX' }, 3, 10)
  engine.addKeyframe({ kind: 'node', nodeId: parentId, property: 'positionY' }, 2, 10)
  engine.addKeyframe({ kind: 'zIndex', nodeId: parentId }, 2, 5)
  engine.addKeyframe({ kind: 'morph', nodeId: parentId }, 1, 0.5)
  engine.addKeyframe({ kind: 'visible', nodeId: parentId }, 0, true)
  engine.addKeyframe({ kind: 'node', nodeId: childId, property: 'positionX' }, 2, 4)
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

describe('deleteKeyframesInRange helpers', () => {
  it('snapshots the subtree root-first with every track family', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const snapshots = snapshotRangeNodes(
      slide.scene.getNode(parentId)!,
      slide,
      engine.materialDefinitions,
    )
    expect(snapshots.map((snapshot) => snapshot.nodeId)).toEqual([parentId, childId])

    const parent = snapshots[0]!
    const keys = parent.tracks.map((track) => track.trackKey)
    expect(keys).toContain('property:positionX')
    expect(keys).toContain('property:positionY')
    expect(keys).toContain('zIndex')
    expect(keys).toContain('morph')
    expect(keys).toContain('visible')
    const labels = new Map(parent.tracks.map((track) => [track.trackKey, track.label]))
    expect(labels.get('property:positionX')).toBe('Position X')
    expect(labels.get('zIndex')).toBe('Z-Index')
    expect(labels.get('morph')).toBe('Morph')
    expect(labels.get('visible')).toBe('Visible')

    const child = snapshots[1]!
    expect(child.tracks.map((track) => track.trackKey)).toEqual(['property:positionX'])
  })

  it('plans every checked track across the whole range', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const snapshots = snapshotRangeNodes(
      slide.scene.getNode(parentId)!,
      slide,
      engine.materialDefinitions,
    )
    const plan = planRangeDelete(snapshots, 0, 10)
    expect(countPlannedDeletes(plan)).toBe(7)
    const keys = new Set(plan.map((entry) => targetKey(entry.target)))
    expect(keys.has(`${parentId}:property:positionX`)).toBe(true)
    expect(keys.has(`${parentId}:zIndex`)).toBe(true)
    expect(keys.has(`${parentId}:morph`)).toBe(true)
    expect(keys.has(`${parentId}:visible`)).toBe(true)
    expect(keys.has(`${childId}:property:positionX`)).toBe(true)
  })

  it('filters keyframes outside the from-to window', () => {
    const { engine, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const snapshots = snapshotRangeNodes(
      slide.scene.getNode(parentId)!,
      slide,
      engine.materialDefinitions,
    )
    const plan = planRangeDelete(snapshots, 1.5, 2.5)
    expect(countPlannedDeletes(plan)).toBe(3)
    const keys = new Set(plan.map((entry) => targetKey(entry.target)))
    expect(keys.has(`${parentId}:property:positionY`)).toBe(true)
    expect(keys.has(`${parentId}:zIndex`)).toBe(true)
    expect(keys.has(`${childId}:property:positionX`)).toBe(true)
    expect(keys.has(`${parentId}:morph`)).toBe(false)
  })

  it('skips unchecked tracks', () => {
    const { engine, slide, parentId } = setup()
    seed(engine, parentId, engine.getNode(parentId).children[0]!.id)
    const snapshots = snapshotRangeNodes(
      slide.scene.getNode(parentId)!,
      slide,
      engine.materialDefinitions,
    )
    const plan = planRangeDelete(
      snapshots,
      0,
      10,
      (nodeId, track) => !(nodeId === parentId && track.trackKey === 'morph'),
    )
    expect(countPlannedDeletes(plan)).toBe(6)
    expect(plan.some((entry) => targetKey(entry.target) === `${parentId}:morph`)).toBe(false)
  })

  it('counts keyframes in range per track', () => {
    const { engine, slide, parentId } = setup()
    seed(engine, parentId, engine.getNode(parentId).children[0]!.id)
    const snapshots = snapshotRangeNodes(
      slide.scene.getNode(parentId)!,
      slide,
      engine.materialDefinitions,
    )
    const byKey = new Map(snapshots[0]!.tracks.map((track) => [track.trackKey, track]))
    expect(countTrackInRange(byKey.get('property:positionX')!, 0, 10)).toBe(2)
    expect(countTrackInRange(byKey.get('property:positionX')!, 1.5, 2.5)).toBe(0)
    expect(countTrackInRange(byKey.get('morph')!, 0, 10)).toBe(1)
  })

  it('deletes every family as a single undo step via a transaction', () => {
    const { engine, dispatcher, undoStack, slide, parentId, childId } = setup()
    seed(engine, parentId, childId)
    const snapshots = snapshotRangeNodes(
      slide.scene.getNode(parentId)!,
      slide,
      engine.materialDefinitions,
    )
    const plan = planRangeDelete(snapshots, 0, 10)
    const commands = buildRangeDeleteCommands(plan)
    expect(commands).toHaveLength(6)

    const depthBefore = undoStack.entries.length
    const result = dispatcher.dispatch(new TransactionCommand(commands))
    expect(result.ok).toBe(true)
    expect(undoStack.entries.length).toBe(depthBefore + 1)
    expect(engine.getKeyframes(parentId, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parentId })).toHaveLength(0)
    expect(engine.getKeyframesOf({ kind: 'morph', nodeId: parentId })).toHaveLength(0)
    expect(engine.getKeyframesOf({ kind: 'visible', nodeId: parentId })).toHaveLength(0)
    expect(engine.getKeyframes(childId, 'positionX')).toHaveLength(0)

    undoStack.undo(engine)
    expect(engine.getKeyframes(parentId, 'positionX')).toHaveLength(2)
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parentId })).toHaveLength(1)
    expect(engine.getKeyframesOf({ kind: 'morph', nodeId: parentId })).toHaveLength(1)
    expect(engine.getKeyframesOf({ kind: 'visible', nodeId: parentId })).toHaveLength(1)
    expect(engine.getKeyframes(childId, 'positionX')).toHaveLength(1)
  })
})
