import { describe, it, expect } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  CreateClipCommand,
  AssignClipCommand,
  SetSemanticNameCommand,
  CreateClipCollectionCommand,
  DeleteClipCommand,
} from '../engine/commands'
import { executeDeleteClipCollection } from '../app/deleteClipCollectionAction'
import { executeSegmentToCollection } from '../engine/timeSegmentExtraction'
import type { ExtractableKeyframe } from '../engine/clipExtraction'

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

function setupRig(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  nodeId: string
  clipA: string
  clipB: string
} {
  const { engine, dispatcher, undoStack } = setupEngine()
  const slide = engine.getActiveSlide()!
  const nodeId = expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Hand',
      }),
    ),
  ).nodeId
  dispatcher.dispatch(new SetSemanticNameCommand({ nodeId, semanticName: 'hand' }))
  const clipA = expectOk(
    dispatcher.dispatch(new CreateClipCommand({ name: 'A', duration: 1, category: '' })),
  ).clipId
  const clipB = expectOk(
    dispatcher.dispatch(new CreateClipCommand({ name: 'B', duration: 1, category: '' })),
  ).clipId
  return { engine, dispatcher, undoStack, nodeId, clipA, clipB }
}

describe('executeDeleteClipCollection', () => {
  it('deletes the collection, its exclusive clips, and their placements in one undo step', () => {
    const { engine, dispatcher, undoStack, nodeId, clipA, clipB } = setupRig()
    expectOk(
      dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId: clipA, startTime: 0, speed: 1 })),
    )
    const collectionId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Rig', bindings: { a: clipA, b: clipB } }),
      ),
    ).collectionId
    const baseline = undoStack.entries.length

    const result = executeDeleteClipCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      collectionId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.deletedClipCount).toBe(2)
    expect(result.message).toMatch(/2 clip\(s\) also deleted/)

    expect(engine.clips).toHaveLength(0)
    expect(() => engine.getClipCollection(collectionId)).toThrow()
    expect(engine.getNode(nodeId).clipInstances).toHaveLength(0)
    expect(undoStack.entries.length).toBe(baseline + 1)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.clips).toHaveLength(2)
    expect(engine.getClipCollection(collectionId).name).toBe('Rig')
    expect(engine.getNode(nodeId).clipInstances).toHaveLength(1)
    expect(dispatcher.redo()).toBe(true)
    expect(engine.clips).toHaveLength(0)
    expect(() => engine.getClipCollection(collectionId)).toThrow()
  })

  it('keeps clips shared with another collection', () => {
    const { engine, dispatcher, undoStack, clipA, clipB } = setupRig()
    const col1 = expectOk(
      dispatcher.dispatch(new CreateClipCollectionCommand({ name: 'One', bindings: { a: clipA } })),
    ).collectionId
    const col2 = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Two', bindings: { x: clipA, y: clipB } }),
      ),
    ).collectionId

    const result = executeDeleteClipCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      col1,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.deletedClipCount).toBe(0)
    expect(result.message).toMatch(/shared/)

    expect(() => engine.getClipCollection(col1)).toThrow()
    // shared clip survives and the other collection still binds it
    expect(engine.getClip(clipA).name).toBe('A')
    expect(engine.getClipCollection(col2).getBinding('x')).toBe(clipA)
  })

  it('fails for an unknown collection id', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const result = executeDeleteClipCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      'missing',
    )
    expect(result.ok).toBe(false)
  })

  it('still deletes the collection when a bound clip is already gone', () => {
    const { engine, dispatcher, undoStack, clipA } = setupRig()
    const collectionId = expectOk(
      dispatcher.dispatch(new CreateClipCollectionCommand({ name: 'Rig', bindings: { a: clipA } })),
    ).collectionId
    expectOk(dispatcher.dispatch(new DeleteClipCommand({ clipId: clipA })))
    const result = executeDeleteClipCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      collectionId,
    )
    expect(result.ok).toBe(true)
    expect(() => engine.getClipCollection(collectionId)).toThrow()
  })

  it('deletes a wizard-minted collection and its baked clips (segment flow)', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
    engine.setSemanticName(left.id, 'left_hand')
    const target = { kind: 'node', nodeId: left.id, property: 'positionX' } as const
    for (const t of [1, 2, 3]) engine.addKeyframe(target, t, t * 10)
    const kfs: ExtractableKeyframe[] = engine.getKeyframes(left.id, 'positionX').map((kf) => ({
      target: {
        kind: 'node',
        nodeId: left.id,
        property: 'positionX',
      } as ExtractableKeyframe['target'],
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const created = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parent.id,
        from: 1,
        to: 3,
        objects: [
          {
            nodeId: left.id,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'LeftHand Clip 1',
            category: 'left_hand',
            keyframes: kfs,
          },
        ],
        collectionName: 'Rig 1.00-3.00s',
        deleteOrphans: false,
        keepFirst: false,
        keepLast: false,
        bakeStart: true,
      },
    )
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok')
    expect(engine.clips.length).toBeGreaterThan(0)

    const result = executeDeleteClipCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      created.collectionId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.deletedClipCount).toBe(created.clips.length)
    expect(engine.clips).toHaveLength(0)
    expect(() => engine.getClipCollection(created.collectionId)).toThrow()
  })
})
