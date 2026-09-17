import { describe, it, expect } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { ClipCollection } from '../../engine/clipCollection'
import {
  CommandDispatcher,
  UndoStack,
  CreateClipCommand,
  AssignClipCommand,
  RemoveClipCommand,
  CreateClipCollectionCommand,
  RenameClipCollectionCommand,
  SetClipCollectionBindingsCommand,
  ExportClipCollectionCommand,
  ApplyClipCollectionCommand,
  PlaceCollectionCommand,
  CreateNodeCommand,
  SetSemanticNameCommand,
} from '../../engine/commands'

function setup() {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undo, () => {})
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  return { engine, dispatcher, undo }
}

function expectOk<T>(r: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!r.ok) throw new Error(`expected ok: ${(r as { error?: Error }).error?.message}`)
  return (r as { ok: true; inverse: T }).inverse
}

describe('collection identity: unique name per rig', () => {
  it('rejects duplicate name on same rig, allows same name on different rig', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rigA = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigA',
        }),
      ),
    ).nodeId
    const rigB = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigB',
        }),
      ),
    ).nodeId
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Walk',
          bindings: { h: clip },
          sourceNodeId: rigA,
        }),
      ),
    )
    const dup = dispatcher.dispatch(
      new CreateClipCollectionCommand({
        name: '  walk ',
        bindings: { h: clip },
        sourceNodeId: rigA,
      }),
    )
    expect(dup.ok).toBe(false)
    const other = dispatcher.dispatch(
      new CreateClipCollectionCommand({ name: 'Walk', bindings: { h: clip }, sourceNodeId: rigB }),
    )
    expect(other.ok).toBe(true)
    const global = dispatcher.dispatch(
      new CreateClipCollectionCommand({ name: 'Walk', bindings: { h: clip } }),
    )
    expect(global.ok).toBe(true)
    expect(engine.clipCollections).toHaveLength(3)
  })

  it('rejects rename to duplicate on same rig', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rig = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' })),
    ).clipId
    expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'A', bindings: { h: clip }, sourceNodeId: rig }),
      ),
    )
    const b = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'B', bindings: { h: clip }, sourceNodeId: rig }),
      ),
    ).collectionId
    const res = dispatcher.dispatch(new RenameClipCollectionCommand({ collectionId: b, name: 'a' }))
    expect(res.ok).toBe(false)
    expect(engine.getClipCollection(b).name).toBe('B')
  })

  it('re-export same rig+name keeps same id (replace, no duplicates)', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rig = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    const child = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: rig, name: 'Hand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: child, semanticName: 'hand' }))
    const c1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C1', duration: 1, category: '' })),
    ).clipId
    const c2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C2', duration: 1, category: '' })),
    ).clipId
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: child, clipId: c1 })))
    const first = expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: rig, name: 'Rig' })),
    ).collectionId
    expect(engine.clipCollections).toHaveLength(1)
    const instId = engine.getNode(child).clipInstances[0]!.id
    expectOk(dispatcher.dispatch(new RemoveClipCommand({ nodeId: child, instanceId: instId })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: child, clipId: c2 })))
    const second = expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: rig, name: 'Rig' })),
    ).collectionId
    expect(second).toBe(first)
    expect(engine.clipCollections).toHaveLength(1)
    expect(engine.getClipCollection(second).getBinding('hand')).toBe(c2)
  })
})

describe('collection replacement refreshes placements and Apply provenance', () => {
  it('setBindings updates placed lanes and applied instances in place', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rig = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    const hand = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: rig, name: 'Hand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: hand, semanticName: 'hand' }))
    const foot = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: rig, name: 'Foot' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: foot, semanticName: 'foot' }))
    const cHand1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'H1', duration: 1, category: '' })),
    ).clipId
    const cHand2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'H2', duration: 1, category: '' })),
    ).clipId
    const cFoot = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'F', duration: 1, category: '' })),
    ).clipId
    const colId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Walk',
          bindings: { hand: cHand1 },
          sourceNodeId: rig,
        }),
      ),
    ).collectionId

    const target = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Target',
        }),
      ),
    ).nodeId
    const tHand = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: target, name: 'THand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: tHand, semanticName: 'hand' }))
    expectOk(
      dispatcher.dispatch(
        new ApplyClipCollectionCommand({ collectionId: colId, targetNodeId: target }),
      ),
    )
    expect(engine.getNode(tHand).clipInstances).toHaveLength(1)
    expect(engine.getNode(tHand).clipInstances[0]!.clipId).toBe(cHand1)
    expect(engine.getNode(tHand).clipInstances[0]!.collectionId).toBe(colId)
    const appliedIdBefore = engine.getNode(tHand).clipInstances[0]!.id

    expectOk(
      dispatcher.dispatch(
        new PlaceCollectionCommand({ collectionId: colId, parentNodeId: rig, startTime: 2 }),
      ),
    )
    const placedHand = engine.getNode(hand).clipInstances.find((i) => i.placementId)
    expect(placedHand).toBeDefined()
    expect(placedHand!.clipId).toBe(cHand1)

    expectOk(
      dispatcher.dispatch(
        new SetClipCollectionBindingsCommand({
          collectionId: colId,
          bindings: { hand: cHand2, foot: cFoot },
        }),
      ),
    )
    expect(engine.clipCollections).toHaveLength(1)
    const appliedAfter = engine.getNode(tHand).clipInstances
    expect(appliedAfter).toHaveLength(1)
    expect(appliedAfter[0]!.clipId).toBe(cHand2)
    expect(appliedAfter[0]!.id).toBe(appliedIdBefore)
    const placedAfter = engine.getNode(hand).clipInstances.find((i) => i.placementId)
    expect(placedAfter!.clipId).toBe(cHand2)
    expect(placedAfter!.startTime).toBe(2)
    const footPlaced = engine.getNode(foot).clipInstances.find((i) => i.placementId)
    expect(footPlaced).toBeDefined()
    expect(footPlaced!.clipId).toBe(cFoot)
  })

  it('removing a binding removes it from placements and applies', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rig = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    const hand = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: rig, name: 'Hand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: hand, semanticName: 'hand' }))
    const foot = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: rig, name: 'Foot' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: foot, semanticName: 'foot' }))
    const cHand = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'H', duration: 1, category: '' })),
    ).clipId
    const cFoot = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'F', duration: 1, category: '' })),
    ).clipId
    const colId = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Walk',
          bindings: { hand: cHand, foot: cFoot },
          sourceNodeId: rig,
        }),
      ),
    ).collectionId
    expectOk(
      dispatcher.dispatch(
        new PlaceCollectionCommand({ collectionId: colId, parentNodeId: rig, startTime: 0 }),
      ),
    )
    expect(engine.getNode(foot).clipInstances.filter((i) => i.placementId)).toHaveLength(1)
    expectOk(
      dispatcher.dispatch(
        new SetClipCollectionBindingsCommand({ collectionId: colId, bindings: { hand: cHand } }),
      ),
    )
    expect(engine.getNode(foot).clipInstances.filter((i) => i.placementId)).toHaveLength(0)
    expect(engine.getNode(hand).clipInstances.filter((i) => i.placementId)).toHaveLength(1)
  })
})

describe('export/import preserves distinct ids, symmetrical copies survive', () => {
  it('two collections same rig different names both survive round-trip', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rig = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    const c1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C1', duration: 1, category: '' })),
    ).clipId
    const c2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C2', duration: 1, category: '' })),
    ).clipId
    const orig = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Walk',
          bindings: { hand: c1 },
          sourceNodeId: rig,
        }),
      ),
    ).collectionId
    const sym = expectOk(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Walk Mirrored',
          bindings: { hand: c2 },
          sourceNodeId: rig,
        }),
      ),
    ).collectionId
    expect(orig).not.toBe(sym)
    const json = engine.toJSON()
    expect(json.clipCollections).toHaveLength(2)
    const engine2 = createEngineInternal()
    engine2.restoreFromJSON(json)
    expect(engine2.clipCollections).toHaveLength(2)
    const names = engine2.clipCollections.map((c) => c.name).sort()
    expect(names).toEqual(['Walk', 'Walk Mirrored'])
  })

  it('legacy duplicates same rig+name collapse keeping last, repointing placements', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const rig = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId
    const hand = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: rig, name: 'Hand' }),
      ),
    ).nodeId
    dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: hand, semanticName: 'hand' }))
    const c1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C1', duration: 1, category: '' })),
    ).clipId
    const c2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'C2', duration: 1, category: '' })),
    ).clipId
    // Bypass validation to simulate legacy duplicates.
    const colA = engine.createClipCollection('Dup', { hand: c1 }, rig)
    // Force second with same name via direct manager import.
    const secondId = `clipCollection-legacy-${Date.now()}`
    engine.importClipCollection(new ClipCollection(secondId, 'Dup', { hand: c2 }, rig))
    expect(engine.clipCollections).toHaveLength(2)
    expectOk(
      dispatcher.dispatch(
        new PlaceCollectionCommand({ collectionId: colA.id, parentNodeId: rig, startTime: 0 }),
      ),
    )
    const removed = (
      engine as unknown as { deduplicateClipCollections(): string[] }
    ).deduplicateClipCollections()
    expect(removed).toHaveLength(1)
    expect(engine.clipCollections).toHaveLength(1)
    expect(engine.clipCollections[0]!.getBinding('hand')).toBe(c2)
  })
})
