import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  AssignClipCommand,
  PlaceCollectionCommand,
  DeleteCollectionPlacementCommand,
} from '../../engine/commands'

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
    clipA,
    clipB,
    collectionId,
    placementId,
  }
}

describe('DeleteCollectionPlacement removes member lanes', () => {
  it('removes member lanes, keeps definitions and the collection', () => {
    const { engine, dispatcher, undoStack, leftId, clipA, collectionId, placementId } =
      setupPlaced()
    expect(engine.getPlacementMembers(placementId)).toHaveLength(2)

    const result = dispatcher.dispatch(new DeleteCollectionPlacementCommand({ placementId }))
    expect(result.ok).toBe(true)

    expect(() => engine.getCollectionPlacement(placementId)).toThrow()
    expect(engine.getNode(leftId).clipInstances).toHaveLength(0)
    // definitions and the collection itself survive (reusable library entries)
    expect(engine.getClip(clipA).name).toBe('A')
    expect(engine.getClipCollection(collectionId).name).toBe('Rig')
    void undoStack
  })

  it('undo restores the placement and its lanes, redo removes them again', () => {
    const { engine, dispatcher, leftId, placementId } = setupPlaced()
    const memberIds = engine.getPlacementMembers(placementId).map((m) => m.instance.id)

    expectOk(dispatcher.dispatch(new DeleteCollectionPlacementCommand({ placementId })))
    expect(engine.getNode(leftId).clipInstances).toHaveLength(0)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(1)
    const restored = engine.getNode(leftId).clipInstances
    expect(restored).toHaveLength(1)
    expect(restored[0]!.id).toBe(memberIds[0])
    expect(restored[0]!.placementId).toBe(placementId)

    expect(dispatcher.redo()).toBe(true)
    expect(() => engine.getCollectionPlacement(placementId)).toThrow()
    expect(engine.getNode(leftId).clipInstances).toHaveLength(0)
  })

  it('keeps plain (non-member) lanes on the same node', () => {
    const { engine, dispatcher, leftId, clipA, placementId } = setupPlaced()
    const plainId = expectOk(
      dispatcher.dispatch(new AssignClipCommand({ nodeId: leftId, clipId: clipA, startTime: 5 })),
    ).instanceId

    expectOk(dispatcher.dispatch(new DeleteCollectionPlacementCommand({ placementId })))
    const remaining = engine.getNode(leftId).clipInstances
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe(plainId)
    expect(remaining[0]!.placementId).toBeUndefined()
  })

  it('engine.deleteCollectionPlacement removes members directly', () => {
    const { engine, leftId, placementId } = setupPlaced()
    engine.deleteCollectionPlacement(placementId)
    expect(() => engine.getCollectionPlacement(placementId)).toThrow()
    expect(engine.getNode(leftId).clipInstances).toHaveLength(0)
  })
})
