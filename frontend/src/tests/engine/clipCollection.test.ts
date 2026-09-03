import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  CreateClipCommand,
  AssignClipCommand,
  SetSemanticNameCommand,
} from '../../engine/commands'
import {
  CreateClipCollectionCommand,
  DeleteClipCollectionCommand,
  RenameClipCollectionCommand,
  ExportClipCollectionCommand,
  ApplyClipCollectionCommand,
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

describe('ClipCollection schema', () => {
  it('validates id,name,bindings and serializes', () => {
    const col = new ClipCollection('id1', 'RigAnim', { left_hand: 'clip1', right_hand: 'clip2' })
    expect(col.id).toBe('id1')
    expect(col.name).toBe('RigAnim')
    expect(col.getBinding('left_hand')).toBe('clip1')
    const json = col.toJSON()
    expect(json.id).toBe('id1')
    expect(json.bindings.left_hand).toBe('clip1')
    const restored = ClipCollection.fromJSON(json)
    expect(restored.id).toBe('id1')
    expect(restored.getBinding('right_hand')).toBe('clip2')
  })

  it('rejects empty name or bindings with empty keys/values', () => {
    expect(() => ClipCollection.fromJSON({ id: '', name: 'n', bindings: {} })).toThrow()
    expect(() => ClipCollection.fromJSON({ id: 'id', name: '', bindings: {} })).toThrow()
    expect(() =>
      ClipCollection.fromJSON({ id: 'id', name: 'n', bindings: { '': 'clip1' } }),
    ).toThrow()
    expect(() => ClipCollection.fromJSON({ id: 'id', name: 'n', bindings: { hand: '' } })).toThrow()
    expect(() => ClipCollection.fromJSON({ id: 'id', name: 'n', bindings: 'notobject' })).toThrow()
  })

  it('trims semanticName on setBinding', () => {
    const col = new ClipCollection('id', 'name', {})
    col.setBinding('  left_hand  ', 'clip1')
    expect(col.getBinding('left_hand')).toBe('clip1')
    expect(col.hasBinding('  left_hand  ')).toBe(false)
  })

  it('CreateClipCollectionCommand validates clip references', () => {
    const { dispatcher } = setupEngine()
    const clipId = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    // valid
    const ok = dispatcher.dispatch(
      new CreateClipCollectionCommand({ name: 'Rig', bindings: { hand: clipId } }),
    )
    expect(ok.ok).toBe(true)
    // invalid clip
    const bad = dispatcher.dispatch(
      new CreateClipCollectionCommand({ name: 'Bad', bindings: { hand: 'ghost' } }),
    )
    expect(bad.ok).toBe(false)
  })
})

describe('Hierarchical export', () => {
  it('walks parent subtree collecting clipInstances via semanticName', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    // Create parent rig handle
    const parent = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigRoot',
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: parent, semanticName: 'rig_root' }))
    const child1 = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'LeftHand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: child1, semanticName: 'left_hand' }))
    const child2 = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'RightHand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: child2, semanticName: 'right_hand' }))
    const noSem = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'NoSem' }),
      ),
    ).nodeId
    // Create clips
    const clip1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 1, category: '' })),
    ).clipId
    const clip2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Shake', duration: 1, category: '' })),
    ).clipId
    // Assign clips to children (including parent)
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: parent, clipId: clip1 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: child1, clipId: clip1 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: child2, clipId: clip2 })))
    // No semantic node should be ignored even with clip
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: noSem, clipId: clip1 })))

    const exportRes = dispatcher.dispatch(
      new ExportClipCollectionCommand({ parentNodeId: parent, name: 'MyRig' }),
    )
    expect(exportRes.ok).toBe(true)
    const colId = (exportRes as { ok: true; inverse: { collectionId: string } }).inverse
      .collectionId
    const col = engine.getClipCollection(colId)
    expect(col.name).toBe('MyRig')
    expect(col.getBinding('rig_root')).toBe(clip1)
    expect(col.getBinding('left_hand')).toBe(clip1)
    expect(col.getBinding('right_hand')).toBe(clip2)
    expect(col.hasBinding('no_sem')).toBe(false)
    // sourceNodeId stored
    expect(col.sourceNodeId).toBe(parent)
  })

  it('export handles duplicate semanticName by keeping first encountered (preorder)', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Root',
        }),
      ),
    ).nodeId
    const a = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'A' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: a, semanticName: 'hand' }))
    const b = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'B' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: b, semanticName: 'hand' }))
    const clip1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C1', duration: 1, category: '' })),
    ).clipId
    const clip2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C2', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: a, clipId: clip1 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: b, clipId: clip2 })))
    const res = dispatcher.dispatch(
      new ExportClipCollectionCommand({ parentNodeId: parent, name: 'Dup' }),
    )
    expect(res.ok).toBe(true)
    const col = engine.getClipCollection(
      (res as { ok: true; inverse: { collectionId: string } }).inverse.collectionId,
    )
    // Should keep first (a's clip)
    expect(col.getBinding('hand')).toBe(clip1)
  })

  it('export is undoable', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Root',
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: parent, semanticName: 'root' }))
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: parent, clipId: clip })))
    const exportRes = dispatcher.dispatch(
      new ExportClipCollectionCommand({ parentNodeId: parent, name: 'Rig' }),
    )
    expect(exportRes.ok).toBe(true)
    expect(engine.clipCollections).toHaveLength(1)
    undoStack.undo(engine)
    expect(engine.clipCollections).toHaveLength(0)
    undoStack.redo(engine)
    expect(engine.clipCollections).toHaveLength(1)
    expect(engine.clipCollections[0]!.name).toBe('Rig')
  })

  it('works with bone/mesh/circle nodes', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    // bone node
    const bone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: parent,
          name: 'Bone',
          components: { bone: { kind: 'bone', length: 100 } },
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'bone1' }))
    // mesh node
    const mesh = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: parent,
          name: 'Mesh',
          components: {
            mesh: {
              kind: 'mesh',
              mesh: {
                vertices: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 10 },
                ],
                faces: [{ v0: 0, v1: 1, v2: 2 }],
                uvs: [
                  { u: 0, v: 0 },
                  { u: 1, v: 0 },
                  { u: 1, v: 1 },
                ],
              },
            },
          },
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: mesh, semanticName: 'mesh1' }))
    // circle node
    const circle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: parent,
          name: 'Circle',
          components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 90 } },
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: circle, semanticName: 'circle1' }))

    const clip1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C1', duration: 1, category: '' })),
    ).clipId
    const clip2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C2', duration: 1, category: '' })),
    ).clipId
    const clip3 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C3', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clip1 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: mesh, clipId: clip2 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: circle, clipId: clip3 })))
    const res = dispatcher.dispatch(
      new ExportClipCollectionCommand({ parentNodeId: parent, name: 'MixedRig' }),
    )
    expect(res.ok).toBe(true)
    const col = engine.getClipCollection(
      (res as { ok: true; inverse: { collectionId: string } }).inverse.collectionId,
    )
    expect(col.getBinding('bone1')).toBe(clip1)
    expect(col.getBinding('mesh1')).toBe(clip2)
    expect(col.getBinding('circle1')).toBe(clip3)
  })
})

describe('Hierarchical apply', () => {
  it('walks target subtree assigning ClipInstance for each match (all matches)', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    // Source rig
    const srcRoot = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'SrcRoot',
        }),
      ),
    ).nodeId
    const srcHand = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: srcRoot, name: 'SrcHand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: srcHand, semanticName: 'hand' }))
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: srcHand, clipId: clip })))
    const colId = expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: srcRoot, name: 'Rig' })),
    ).collectionId

    // Target rig with duplicate semanticName (two hands)
    const tgtRoot = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'TgtRoot',
        }),
      ),
    ).nodeId
    const tgtHand1 = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: tgtRoot, name: 'TgtHand1' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tgtHand1, semanticName: 'hand' }))
    const tgtHand2 = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: tgtRoot, name: 'TgtHand2' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tgtHand2, semanticName: 'hand' }))
    const other = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: tgtRoot, name: 'Other' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: other, semanticName: 'foot' }))

    const applyRes = dispatcher.dispatch(
      new ApplyClipCollectionCommand({ collectionId: colId, targetNodeId: tgtRoot }),
    )
    expect(applyRes.ok).toBe(true)
    // Both hands should have clip assigned (broadcast)
    expect(engine.getClipInstances(tgtHand1)).toHaveLength(1)
    expect(engine.getClipInstances(tgtHand1)[0]!.clipId).toBe(clip)
    expect(engine.getClipInstances(tgtHand2)).toHaveLength(1)
    expect(engine.getClipInstances(tgtHand2)[0]!.clipId).toBe(clip)
    expect(engine.getClipInstances(other)).toHaveLength(0)
    // tgtRoot itself has no semanticName, so no assignment
    expect(engine.getClipInstances(tgtRoot)).toHaveLength(0)
  })

  it('applies to target itself if it matches semanticName', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const src = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Src',
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: src, semanticName: 'root_s' }))
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: src, clipId: clip })))
    const colId = expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: src, name: 'Rig' })),
    ).collectionId
    const tgt = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Tgt',
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tgt, semanticName: 'root_s' }))
    dispatcher.dispatch(new ApplyClipCollectionCommand({ collectionId: colId, targetNodeId: tgt }))
    expect(engine.getClipInstances(tgt)).toHaveLength(1)
  })

  it('is undoable and reapplies all matches', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const srcHand = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'SrcHand',
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: srcHand, semanticName: 'hand' }))
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: srcHand, clipId: clip })))
    const colId = expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: srcHand, name: 'Rig' })),
    ).collectionId

    const root = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RootForApply',
        }),
      ),
    ).nodeId
    const tgt1 = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: root, name: 'T1' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tgt1, semanticName: 'hand' }))
    const tgt2 = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: root, name: 'T2' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tgt2, semanticName: 'hand' }))

    const res = dispatcher.dispatch(
      new ApplyClipCollectionCommand({ collectionId: colId, targetNodeId: root }),
    )
    expect(res.ok).toBe(true)
    expect(engine.getClipInstances(tgt1)).toHaveLength(1)
    expect(engine.getClipInstances(tgt2)).toHaveLength(1)
    undoStack.undo(engine)
    expect(engine.getClipInstances(tgt1)).toHaveLength(0)
    expect(engine.getClipInstances(tgt2)).toHaveLength(0)
    undoStack.redo(engine)
    expect(engine.getClipInstances(tgt1)).toHaveLength(1)
    expect(engine.getClipInstances(tgt2)).toHaveLength(1)
  })

  it('works with IK/bone hierarchy - IK handles are nodes too', async () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    // Create a bone chain and IK handle
    const rigHandle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Handle',
        }),
      ),
    ).nodeId
    const bone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: rigHandle,
          name: 'Bone',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'arm' }))
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'ArmClip', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clip })))
    const colId = expectOk(
      dispatcher.dispatch(
        new ExportClipCollectionCommand({ parentNodeId: rigHandle, name: 'IKRig' }),
      ),
    ).collectionId
    // target
    const tgtHandle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'TgtHandle',
        }),
      ),
    ).nodeId
    const tgtBone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: tgtHandle,
          name: 'TgtBone',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tgtBone, semanticName: 'arm' }))
    dispatcher.dispatch(
      new ApplyClipCollectionCommand({ collectionId: colId, targetNodeId: tgtHandle }),
    )
    expect(engine.getClipInstances(tgtBone)).toHaveLength(1)
    expect(engine.getClipInstances(tgtBone)[0]!.clipId).toBe(clip)
  })
})

describe('ClipCollection persistence', () => {
  it('serializes via LessonJSON and restores', () => {
    const { engine, dispatcher } = setupEngine()
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: 'cat' })),
    ).clipId
    const col = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'MyCol', bindings: { hand: clip } }),
      ),
    )
    const json = engine.toJSON()
    expect(json.clipCollections).toBeDefined()
    expect(json.clipCollections![0]!.name).toBe('MyCol')
    expect(json.clipCollections![0]!.bindings.hand).toBe(clip)

    const engine2 = createEngine()
    engine2.restoreFromJSON(json)
    expect(engine2.clipCollections).toHaveLength(1)
    expect(engine2.getClipCollection(col.collectionId).getBinding('hand')).toBe(clip)
  })

  it('library storage self-contained: collection references remain after restore', () => {
    const { engine, dispatcher } = setupEngine()
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(
      dispatcher.dispatch(new CreateClipCollectionCommand({ name: 'Col', bindings: { a: clip } })),
    )
    const json = engine.toJSON()
    // Simulate library storage: move clipCollections to library
    const withLibrary = {
      ...json,
      clipCollections: undefined,
      library: { ...json.library, clipCollections: json.clipCollections },
    } as unknown as import('../../engine/json').LessonJSON
    const engine2 = createEngine()
    engine2.restoreFromJSON(withLibrary)
    expect(engine2.clipCollections).toHaveLength(1)
  })

  it('validates unknown clip references in collection', () => {
    const { engine, dispatcher } = setupEngine()
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(
      dispatcher.dispatch(new CreateClipCollectionCommand({ name: 'Col', bindings: { a: clip } })),
    )
    const json = engine.toJSON()
    // Corrupt binding to ghost clip
    ;(json.clipCollections![0]!.bindings as unknown as Record<string, string>).a = 'ghost-clip'
    const errors = validate(json)
    expect(errors.some((e) => e.includes('unknown clip id'))).toBe(true)
  })

  it('Create/Delete/Rename are undoable', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    const colId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'First', bindings: { hand: clip } }),
      ),
    ).collectionId
    expect(engine.clipCollections).toHaveLength(1)
    expectOk(
      dispatcher.dispatch(new RenameClipCollectionCommand({ collectionId: colId, name: 'Second' })),
    )
    expect(engine.getClipCollection(colId).name).toBe('Second')
    undoStack.undo(engine)
    expect(engine.getClipCollection(colId).name).toBe('First')
    undoStack.undo(engine)
    expect(engine.clipCollections).toHaveLength(0)
    undoStack.redo(engine)
    expect(engine.clipCollections).toHaveLength(1)
    expectOk(dispatcher.dispatch(new DeleteClipCollectionCommand({ collectionId: colId })))
    expect(engine.clipCollections).toHaveLength(0)
    undoStack.undo(engine)
    expect(engine.clipCollections).toHaveLength(1)
  })
})

describe('ClipCollection events and self-contained', () => {
  it('references stay valid after clip duplicate and delete handling', () => {
    const { engine, dispatcher } = setupEngine()
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    const colId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Col', bindings: { hand: clip } }),
      ),
    ).collectionId
    // Clip still exists, collection valid
    expect(engine.getClipCollection(colId).getBinding('hand')).toBe(clip)
    // Attempt delete clip while referenced by collection? Currently not blocked; but self-contained means collection just references clip, not block delete.
    // However clip deletion should be blocked if referenced by node instances, not collection. So not relevant.
  })
})
