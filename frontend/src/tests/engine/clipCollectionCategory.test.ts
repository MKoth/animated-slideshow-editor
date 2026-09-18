import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  CreateClipCollectionCommand,
  SetClipCollectionCategoryCommand,
  CopyCollectionCommand,
  ReverseCollectionCommand,
} from '../../engine/commands'
import { ClipCollection } from '../../engine/clipCollection'
import { validate } from '../../engine/lessonSerializer'

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

function makeClip(dispatcher: CommandDispatcher, name: string): string {
  return expectOk(dispatcher.dispatch(new CreateClipCommand({ name, duration: 1, category: '' })))
    .clipId
}

describe('ClipCollection category model', () => {
  it('defaults to Uncategorized and trims', () => {
    const col = new ClipCollection('id1', 'Rig', { hand: 'clip1' })
    expect(col.category).toBe('')
    const trimmed = new ClipCollection('id2', 'Rig', {}, undefined, '  Walk  ')
    expect(trimmed.category).toBe('Walk')
    trimmed.category = '  Run '
    expect(trimmed.category).toBe('Run')
    trimmed.category = '   '
    expect(trimmed.category).toBe('')
  })

  it('toJSON omits empty category and round-trips non-empty', () => {
    const plain = new ClipCollection('id1', 'Rig', { hand: 'clip1' })
    expect(plain.toJSON()).not.toHaveProperty('category')
    expect(ClipCollection.fromJSON(plain.toJSON()).category).toBe('')

    const cat = new ClipCollection('id2', 'Rig', { hand: 'clip1' }, undefined, 'Dance')
    expect(cat.toJSON().category).toBe('Dance')
    expect(ClipCollection.fromJSON(cat.toJSON()).category).toBe('Dance')
  })

  it('fromJSON defaults missing category and rejects non-string', () => {
    const legacy = ClipCollection.fromJSON({ id: 'id', name: 'n', bindings: { h: 'c' } })
    expect(legacy.category).toBe('')
    expect(() =>
      ClipCollection.fromJSON({ id: 'id', name: 'n', bindings: { h: 'c' }, category: 42 }),
    ).toThrow()
  })

  it('copy preserves category', () => {
    const col = new ClipCollection('id', 'Rig', { hand: 'clip1' }, 'node1', 'Walk')
    const copy = col.copy()
    expect(copy.category).toBe('Walk')
    expect(copy.sourceNodeId).toBe('node1')
  })
})

describe('ClipCollection category commands', () => {
  it('create with category, set category, undo/redo', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const clipId = makeClip(dispatcher, 'C')
    const collectionId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Rig',
          bindings: { hand: clipId },
          category: '  Walk ',
        }),
      ),
    ).collectionId
    expect(engine.getClipCollection(collectionId).category).toBe('Walk')

    expectOk(
      dispatcher.dispatch(new SetClipCollectionCategoryCommand({ collectionId, category: 'Run' })),
    )
    expect(engine.getClipCollection(collectionId).category).toBe('Run')

    undoStack.undo(engine)
    expect(engine.getClipCollection(collectionId).category).toBe('Walk')
    undoStack.redo(engine)
    expect(engine.getClipCollection(collectionId).category).toBe('Run')
  })

  it('create without category stays Uncategorized; blank clears', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const clipId = makeClip(dispatcher, 'C')
    const collectionId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Rig', bindings: { h: clipId } }),
      ),
    ).collectionId
    expect(engine.getClipCollection(collectionId).category).toBe('')

    expectOk(
      dispatcher.dispatch(
        new SetClipCollectionCategoryCommand({ collectionId, category: '  Walk ' }),
      ),
    )
    expect(engine.getClipCollection(collectionId).category).toBe('Walk')
    expectOk(
      dispatcher.dispatch(new SetClipCollectionCategoryCommand({ collectionId, category: '   ' })),
    )
    expect(engine.getClipCollection(collectionId).category).toBe('')
    void undoStack
  })

  it('copy/reverse preserve the collection category', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(dispatcher, 'C')
    const sourceId = engine.createClipCollection('Gesture', { hand: clipId }, undefined, 'Dance').id

    const copied = engine.createCopiedCollection(sourceId, 'Gesture Copy')
    expect(copied.collection.category).toBe('Dance')

    const reversed = engine.createReversedCollection(sourceId, 'Gesture Reversed')
    expect(reversed.collection.category).toBe('Dance')

    const copyRes = expectOk(
      dispatcher.dispatch(
        new CopyCollectionCommand({ sourceCollectionId: sourceId, newName: 'ViaCmd' }),
      ),
    )
    expect(engine.getClipCollection(copyRes.newCollectionId).category).toBe('Dance')

    const revRes = expectOk(
      dispatcher.dispatch(
        new ReverseCollectionCommand({ sourceCollectionId: sourceId, newName: 'ViaCmdR' }),
      ),
    )
    expect(engine.getClipCollection(revRes.newCollectionId).category).toBe('Dance')
  })

  it('setBindings preserves category', () => {
    const { engine, dispatcher } = setupEngine()
    const a = makeClip(dispatcher, 'A')
    const b = makeClip(dispatcher, 'B')
    const id = engine.createClipCollection('Rig', { h: a }, undefined, 'Walk').id
    engine.setClipCollectionBindings(id, { h: b })
    expect(engine.getClipCollection(id).category).toBe('Walk')
  })

  it('lesson validate accepts category and serializes it', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(dispatcher, 'C')
    engine.createClipCollection('Rig', { h: clipId }, undefined, 'Walk')
    const json = engine.toJSON()
    const stored = (json.clipCollections ?? [])[0] as unknown as Record<string, unknown>
    expect(stored['category']).toBe('Walk')
    expect(validate(json as unknown as Record<string, unknown>)).toEqual([])
  })
})
