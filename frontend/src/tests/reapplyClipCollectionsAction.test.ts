import { describe, it, expect } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  PlaceCollectionCommand,
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
} from '../engine/commands'
import { executeReapplyClipCollections } from '../app/reapplyClipCollectionsAction'

function setupEngine(): { engine: Engine; dispatcher: CommandDispatcher; undoStack: UndoStack } {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  const res = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!res.ok) throw new Error('create project failed')
  const slideRes = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  if (!slideRes.ok) throw new Error('create slide failed')
  return { engine, dispatcher, undoStack }
}

function expectOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error?.message}`)
  return result.inverse as T
}

function setupPlaced(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  parentId: string
  leftId: string
  rightId: string
  clipA: string
  clipB: string
  collectionId: string
  placementId: string
} {
  const { engine, dispatcher, undoStack } = setupEngine()
  const slide = engine.getActiveSlide()!
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
  const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
  engine.setSemanticName(left.id, 'left_hand')
  const right = engine.createNode(slide.scene.id, parent.id, 'RightHand')
  engine.setSemanticName(right.id, 'right_hand')
  const clipA = expectOk(
    dispatcher.dispatch(new CreateClipCommand({ name: 'A', duration: 2, category: '' })),
  ).clipId
  const clipB = expectOk(
    dispatcher.dispatch(new CreateClipCommand({ name: 'B', duration: 2, category: '' })),
  ).clipId
  const collectionId = engine.createClipCollection(
    'Rig',
    { left_hand: clipA, right_hand: clipB },
    parent.id,
  ).id
  const placementId = expectOk(
    dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId, parentNodeId: parent.id, startTime: 1 }),
    ),
  ).placementId as string
  return {
    engine,
    dispatcher,
    undoStack,
    parentId: parent.id,
    leftId: left.id,
    rightId: right.id,
    clipA,
    clipB,
    collectionId,
    placementId,
  }
}

describe('executeReapplyClipCollections', () => {
  it('returns ok with zero when nothing is placed', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      parent.id,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.refreshedCount).toBe(0)
  })

  it('fails for an unknown parent', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      'missing',
    )
    expect(result.ok).toBe(false)
  })

  it('rebinds a re-added child with the same semantic (reported case)', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupPlaced()
    const slide = engine.getActiveSlide()!
    // Delete left child (its member lane goes with the node)
    engine.removeNode(leftId)
    expect(engine.getNode(rightId).clipInstances).toHaveLength(1)
    // Re-add with the same semantic name — fresh node has no clips
    const replacement = engine.createNode(slide.scene.id, parentId, 'LeftHand')
    engine.setSemanticName(replacement.id, 'left_hand')
    expect(replacement.clipInstances).toHaveLength(0)

    const baseline = undoStack.entries.length
    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.refreshedCount).toBe(1)
    // New child picked up the collection clip at the original startTime
    const fresh = engine.getNode(replacement.id).clipInstances
    expect(fresh).toHaveLength(1)
    expect(fresh[0]!.startTime).toBe(1)
    expect(fresh[0]!.placementId).toBeDefined()
    // Surviving child still bound
    expect(engine.getNode(rightId).clipInstances).toHaveLength(1)
    // One undo step for the whole refresh
    expect(undoStack.entries.length).toBe(baseline + 1)
  })

  it('preserves retime/respeed edits on surviving nodes, defaults for new nodes', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupPlaced()
    const slide = engine.getActiveSlide()!
    const members = engine.getPlacementMembers(engine.getNode(parentId).collectionPlacements[0]!.id)
    const leftMember = members.find((m) => m.nodeId === leftId)!
    expectOk(
      dispatcher.dispatch(
        new SetClipInstanceStartTimeCommand({
          nodeId: leftId,
          instanceId: leftMember.instance.id,
          startTime: 4,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new SetClipInstanceSpeedCommand({
          nodeId: leftId,
          instanceId: leftMember.instance.id,
          speed: 2,
        }),
      ),
    )
    // Clear history so the refresh itself must be exactly one entry
    undoStack.clear()
    // Delete + re-add right child: new node should get defaults, left keeps edits
    engine.removeNode(rightId)
    const replacement = engine.createNode(slide.scene.id, parentId, 'RightHand')
    engine.setSemanticName(replacement.id, 'right_hand')

    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.preservedEditCount).toBeGreaterThanOrEqual(2)
    const leftAfter = engine.getNode(leftId).clipInstances[0]!
    expect(leftAfter.startTime).toBe(4)
    expect(leftAfter.speed).toBe(2)
    const rightAfter = engine.getNode(replacement.id).clipInstances[0]!
    expect(rightAfter.startTime).toBe(1)
    expect(rightAfter.speed).toBe(1)
    expect(undoStack.entries.length).toBe(1)
  })

  it('keeps the old placement when nothing matches anymore', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId, placementId } = setupPlaced()
    engine.removeNode(leftId)
    engine.removeNode(rightId)
    const baseline = undoStack.entries.length
    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.refreshedCount).toBe(0)
    expect(result.skippedCount).toBe(1)
    // Old placement untouched (no delete dispatched)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(1)
    expect(undoStack.entries.length).toBe(baseline)
  })

  it('keeps the old placement when a matching bound clip is gone', () => {
    const { engine, dispatcher, undoStack, parentId, clipA, placementId } = setupPlaced()
    engine.deleteClip(clipA)
    const baseline = undoStack.entries.length
    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.refreshedCount).toBe(0)
    expect(result.skippedCount).toBe(1)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(1)
    expect(undoStack.entries.length).toBe(baseline)
  })

  it('preserves startTime layout and placement order, undo restores old placements', () => {
    const { engine, dispatcher, undoStack, parentId, collectionId } = setupPlaced()
    const secondId = expectOk(
      dispatcher.dispatch(
        new PlaceCollectionCommand({ collectionId, parentNodeId: parentId, startTime: 5 }),
      ),
    ).placementId as string
    const orderBefore = engine.getNode(parentId).collectionPlacements.map((p) => p.startTime)
    expect(orderBefore).toEqual([1, 5])
    undoStack.clear()

    const result = executeReapplyClipCollections(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.refreshedCount).toBe(2)
    const orderAfter = engine.getNode(parentId).collectionPlacements.map((p) => p.startTime)
    expect(orderAfter).toEqual([1, 5])
    expect(undoStack.entries.length).toBe(1)

    expect(dispatcher.undo()).toBe(true)
    const orderUndone = engine.getNode(parentId).collectionPlacements.map((p) => p.startTime)
    expect(orderUndone).toEqual([1, 5])
    // Old placement ids restored (second placement id matches pre-refresh)
    expect(engine.getNode(parentId).collectionPlacements.map((p) => p.id)).toContain(secondId)
    expect(dispatcher.redo()).toBe(true)
    const orderRedone = engine.getNode(parentId).collectionPlacements.map((p) => p.startTime)
    expect(orderRedone).toEqual([1, 5])
  })
})
