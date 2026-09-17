import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  ReverseCollectionCommand,
  MirrorCollectionCommand,
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

function setupSource(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  collectionId: string
  leftClip: string
  rightClip: string
} {
  const { engine, dispatcher, undoStack } = setupEngine()
  const leftClip = expectOk(
    dispatcher.dispatch(new CreateClipCommand({ name: 'LeftWave', duration: 2, category: '' })),
  ).clipId
  const rightClip = expectOk(
    dispatcher.dispatch(new CreateClipCommand({ name: 'RightWave', duration: 2, category: '' })),
  ).clipId
  const collectionId = engine.createClipCollection('Gesture', {
    left_hand: leftClip,
    right_hand: rightClip,
  }).id
  return { engine, dispatcher, undoStack, collectionId, leftClip, rightClip }
}

describe('reverse/mirror collection copy naming', () => {
  it('reverse with user-edited name: clips take the collection name, categories take semantics', () => {
    const { engine, collectionId } = setupSource()
    const { collection, clipIdMap } = engine.createReversedCollection(collectionId, 'MyWalk')
    expect(collection.name).toBe('MyWalk')
    expect(clipIdMap.size).toBe(2)
    for (const [semantic, clipId] of collection.bindings) {
      const clip = engine.getClip(clipId)
      expect(clip.name).toBe('MyWalk')
      expect(clip.category).toBe(semantic)
    }
  })

  it('reverse with default name: clips take "<collection> Reversed", categories take semantics', () => {
    const { engine, collectionId } = setupSource()
    const { collection } = engine.createReversedCollection(collectionId)
    expect(collection.name).toBe('Gesture Reversed')
    for (const [semantic, clipId] of collection.bindings) {
      const clip = engine.getClip(clipId)
      expect(clip.name).toBe('Gesture Reversed')
      expect(clip.category).toBe(semantic)
    }
  })

  it('mirror with user-edited name: clips take the collection name, categories take swapped bindings', () => {
    const { engine, collectionId } = setupSource()
    const { collection } = engine.createMirroredCollection(collectionId, 'X', 'MyMirror')
    expect(collection.name).toBe('MyMirror')
    const bindings = collection.getBindingsObject()
    // lateral swap still holds
    expect(Object.keys(bindings).sort()).toEqual(['left_hand', 'right_hand'])
    for (const [semantic, clipId] of Object.entries(bindings)) {
      const clip = engine.getClip(clipId)
      expect(clip.name).toBe('MyMirror')
      expect(clip.category).toBe(semantic)
    }
  })

  it('shared source clip is still minted once (first semantic wins the category)', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const shared = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Shared', duration: 2, category: '' })),
    ).clipId
    const sourceId = engine.createClipCollection('SharedCol', {
      left_hand: shared,
      right_hand: shared,
    }).id
    const { collection, clipIdMap } = engine.createMirroredCollection(sourceId, 'X', 'SharedMirror')
    expect(clipIdMap.size).toBe(1)
    const bindings = collection.getBindingsObject()
    expect(bindings['left_hand']).toBe(bindings['right_hand'])
    const clip = engine.getClip(bindings['left_hand']!)
    expect(clip.name).toBe('SharedMirror')
    expect(['left_hand', 'right_hand']).toContain(clip.category)
    void undoStack
  })

  it('ReverseCollectionCommand with edited name propagates to clips (dialog path)', () => {
    const { engine, dispatcher, collectionId } = setupSource()
    const res = dispatcher.dispatch(
      new ReverseCollectionCommand({ sourceCollectionId: collectionId, newName: 'CustomName' }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('reverse failed')
    const col = engine.getClipCollection(res.inverse.newCollectionId)
    expect(col.name).toBe('CustomName')
    for (const [semantic, clipId] of col.bindings) {
      expect(engine.getClip(clipId).name).toBe('CustomName')
      expect(engine.getClip(clipId).category).toBe(semantic)
    }
  })

  it('MirrorCollectionCommand with edited name propagates to clips (dialog path)', () => {
    const { engine, dispatcher, collectionId } = setupSource()
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: collectionId,
        newName: 'CustomMirror',
        axis: 'X',
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    const col = engine.getClipCollection(res.inverse.newCollectionId)
    expect(col.name).toBe('CustomMirror')
    for (const [semantic, clipId] of col.bindings) {
      expect(engine.getClip(clipId).name).toBe('CustomMirror')
      expect(engine.getClip(clipId).category).toBe(semantic)
    }
  })
})
