import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  PlaceCollectionCommand,
} from '../../engine/commands'
import { Keyframe } from '../../engine/keyframe'
import {
  previewCollectionFreeze,
  executeCollectionFreeze,
  placementEndTime,
} from '../../engine/collectionFreeze'
import {
  collectionLaneEnvFromEngine,
  commitCollectionMove,
  commitCollectionStretch,
} from '../../app/collectionLaneActions'
import { deleteCollectionPlacementWithFreeze } from '../../app/collectionFreezeDeletion'
import { timelineRows } from '../../components/panels/timelineTracks'

function setupEngine(): { engine: Engine; dispatcher: CommandDispatcher; undoStack: UndoStack } {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  const res = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!res.ok) throw new Error('create project failed')
  const slideRes = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  if (!slideRes.ok) throw new Error('create slide failed')
  engine.getActiveSlide()!.duration = 20
  return { engine, dispatcher, undoStack }
}

function setupPlacedCollection() {
  const { engine, dispatcher, undoStack } = setupEngine()
  const slide = engine.getActiveSlide()!
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
  const paw = engine.createNode(slide.scene.id, parent.id, 'Paw')
  const tail = engine.createNode(slide.scene.id, parent.id, 'Tail')
  engine.setSemanticName(paw.id, 'paw')
  engine.setSemanticName(tail.id, 'tail')

  const pawClip = engine.createClip('pawClip', 2, '', [], [{ property: 'positionX' }])
  pawClip.addChannelKeyframe('positionX', new Keyframe('p1', 0, 10))
  pawClip.addChannelKeyframe('positionX', new Keyframe('p2', 1, 30))
  const tailClip = engine.createClip('tailClip', 4, '', [], [{ property: 'positionX' }])
  tailClip.addChannelKeyframe('positionX', new Keyframe('t1', 0, 100))
  tailClip.addChannelKeyframe('positionX', new Keyframe('t2', 1, 300))

  const col = engine.createClipCollection('CatPose', { paw: pawClip.id, tail: tailClip.id })
  const placeRes = dispatcher.dispatch(
    new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: parent.id, startTime: 2 }),
  )
  if (!placeRes.ok) throw new Error(`place failed: ${placeRes.error.message}`)
  const placementId = (placeRes.inverse as { placementId: string }).placementId
  return { engine, dispatcher, undoStack, parent, paw, tail, pawClip, tailClip, col, placementId }
}

describe('collectionFreeze', () => {
  it('placement end is max member visual (2s + 4s → end 6s)', () => {
    const { engine, placementId } = setupPlacedCollection()
    const { end, visual } = placementEndTime(engine, placementId)
    expect(visual).toBe(4)
    expect(end).toBe(6)
  })

  it('preview last copies end keys plus hold prefixes at block start', () => {
    const { engine, placementId } = setupPlacedCollection()
    const preview = previewCollectionFreeze(engine, { placementId, source: 'last' })
    // 2 end keys + 2 hold prefixes (tracks start empty; a lone key would
    // otherwise drive the whole slide, including before the block)
    expect(preview.totalWrites).toBe(4)
    expect(preview.targetTime).toBe(6)
    const byName = new Map(preview.entries.map((e) => [e.nodeName, e.writeCount]))
    expect(byName.get('Paw')).toBe(2)
    expect(byName.get('Tail')).toBe(2)
    expect(preview.warnings.some((w) => w.includes('hold key'))).toBe(true)
  })

  it('execute last writes last clip values at block end with base hold at start', () => {
    const { engine, dispatcher, undoStack, placementId, paw, tail } = setupPlacedCollection()
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'last',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.writtenCount).toBe(4)
    expect(res.targetTime).toBe(6)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 30],
    ])
    expect(engine.getKeyframes(tail.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 300],
    ])
    // prefix is hold with zero tangents so the pre-block pose is untouched
    const prefix = engine.getKeyframes(paw.id, 'positionX').find((k) => k.time === 2)!
    expect(prefix.interpolation).toBe('hold')
  })

  it('preview first writes first keys at block start (before the block)', () => {
    const { engine, placementId } = setupPlacedCollection()
    const preview = previewCollectionFreeze(engine, { placementId, source: 'first' })
    expect(preview.totalWrites).toBe(2)
    expect(preview.targetTime).toBe(2)
    const byName = new Map(preview.entries.map((e) => [e.nodeName, e.writeCount]))
    expect(byName.get('Paw')).toBe(1)
    expect(byName.get('Tail')).toBe(1)
  })

  it('execute first writes first clip values at block start', () => {
    const { engine, dispatcher, undoStack, placementId, paw, tail } = setupPlacedCollection()
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'first',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetTime).toBe(2)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 10],
    ])
    expect(engine.getKeyframes(tail.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 100],
    ])
  })

  it('first then last leaves an entry anchor and an exit anchor', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'first' }).ok,
    ).toBe(true)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 10],
      [6, 30],
    ])
  })

  it('last then first replaces the base hold prefix with the first pose', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 30],
    ])
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'first' }).ok,
    ).toBe(true)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 10],
      [6, 30],
    ])
    // Undo of the replace-restoring freeze brings the base hold prefix back.
    undoStack.undo(engine)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 30],
    ])
  })

  it('skips the hold prefix on tracks that already have keys', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    engine.addKeyframe({ kind: 'node', nodeId: paw.id, property: 'positionX' }, 1, 5)
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'last',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // pre-existing key at 1, frozen key at 6, no prefix at 2 for paw
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [1, 5],
      [6, 30],
    ])
  })

  it('keeps the hold prefix when the only existing key is after the block', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    engine.addKeyframe({ kind: 'node', nodeId: paw.id, property: 'positionX' }, 10, 7)
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'last',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    // A lone key at 6 would otherwise drive the whole track (base 0 before the
    // block, drifting toward the key at 10). The prefix at 2 pins the pose.
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 30],
      [10, 7],
    ])
  })

  it('refuses to freeze a block that starts at or after the slide end', () => {
    const { engine, dispatcher, undoStack, placementId } = setupPlacedCollection()
    engine.setCollectionPlacementStartTime(placementId, 20)
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'last',
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error')
    expect(res.error).toContain('starts at or after the end of the slide')
  })
})

describe('timeline collection lane rows', () => {
  it('emits a collectionLane row under a parent with placements', () => {
    const { engine } = setupPlacedCollection()
    const slide = engine.getActiveSlide()!
    const rows = timelineRows(slide.scene, {}, [], {}, undefined, undefined)
    const lane = rows.find((r) => r.kind === 'collectionLane')
    expect(lane).toBeDefined()
    expect((lane as { node: { name: string } }).node.name).toBe('Cat')
  })

  it('emits no collectionLane row without placements', () => {
    const { engine } = setupEngine()
    const slide = engine.getActiveSlide()!
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Plain')
    const rows = timelineRows(slide.scene, {}, [], {}, undefined, undefined)
    expect(rows.some((r) => r.kind === 'collectionLane')).toBe(false)
  })
})

describe('freeze link (placement ↔ frozen keyframes)', () => {
  it('tags freeze-last writes with placement link roles (last + prefix)', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'last',
    })
    expect(res.ok).toBe(true)
    const linked = engine.getFreezeKeyframes(placementId)
    // 2 end keys (last) + 2 hold prefixes (prefix)
    expect(linked).toHaveLength(4)
    expect(linked.filter((l) => l.keyframe.freezeLink?.role === 'last')).toHaveLength(2)
    expect(linked.filter((l) => l.keyframe.freezeLink?.role === 'prefix')).toHaveLength(2)
    for (const l of linked) expect(l.keyframe.freezeLink?.placementId).toBe(placementId)
    void paw
  })

  it('tags freeze-first writes with the first role', () => {
    const { engine, dispatcher, undoStack, placementId } = setupPlacedCollection()
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'first',
    })
    expect(res.ok).toBe(true)
    const linked = engine.getFreezeKeyframes(placementId)
    expect(linked).toHaveLength(2)
    for (const l of linked) {
      expect(l.keyframe.freezeLink?.placementId).toBe(placementId)
      expect(l.keyframe.freezeLink?.role).toBe('first')
    }
  })

  it('collection move shifts linked freeze keys by the same delta', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([2, 6])
    const env = collectionLaneEnvFromEngine(engine)
    const res = commitCollectionMove(env, dispatch as never, placementId, 5, 2, {
      maxStartTime: 20,
    })
    expect(res.ok).toBe(true)
    expect(res.freezeSkipped).toBe(0)
    expect(res.freezeMoved).toBe(4)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(5)
    // prefix rode 2 → 5, frozen end rode 6 → 9
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([5, 9])
    // links survive the move
    expect(engine.getFreezeKeyframes(placementId)).toHaveLength(4)
  })

  it('move then undo restores both placement and freeze key times', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    const env = collectionLaneEnvFromEngine(engine)
    commitCollectionMove(env, dispatch as never, placementId, 5, 2, { maxStartTime: 20 })
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([5, 9])
    expect(dispatcher.undo()).toBe(true)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(2)
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([2, 6])
    void undoStack
  })

  it('stretch-right moves end-linked keys, keeps start-linked ones', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    const env = collectionLaneEnvFromEngine(engine)
    // visual 4 → 8: right edge 6 → 10
    const res = commitCollectionStretch(env, dispatch as never, {
      placementId,
      initialStart: 2,
      initialVisual: 4,
      previewStart: 2,
      previewVisual: 8,
      isLeftHandle: false,
    })
    expect(res.ok).toBe(true)
    expect(res.freezeSkipped).toBe(0)
    // prefix stays at 2, frozen end rides 6 → 10
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([2, 10])
  })

  it('stretch-left moves start-linked keys, keeps end-linked ones', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    const env = collectionLaneEnvFromEngine(engine)
    // left edge 2 → 4 (visual 4 → 2 keeps right edge at 6)
    const res = commitCollectionStretch(env, dispatch as never, {
      placementId,
      initialStart: 2,
      initialVisual: 4,
      previewStart: 4,
      previewVisual: 2,
      isLeftHandle: true,
    })
    expect(res.ok).toBe(true)
    expect(res.freezeSkipped).toBe(0)
    // prefix rides 2 → 4, frozen end stays at 6
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([4, 6])
  })

  it('delete choice removes linked freeze keys with the placement', () => {
    const { engine, dispatcher, undoStack, placementId, paw, tail } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    expect(engine.getFreezeKeyframes(placementId)).toHaveLength(4)
    const result = deleteCollectionPlacementWithFreeze(
      engine,
      dispatch as never,
      placementId,
      'delete',
    )
    expect(result.ok).toBe(true)
    expect(result.freezeDeleted).toBe(4)
    expect(() => engine.getCollectionPlacement(placementId)).toThrow()
    expect(engine.getKeyframes(paw.id, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframes(tail.id, 'positionX')).toHaveLength(0)
    // undo restores placement and linked keys together
    expect(dispatcher.undo()).toBe(true)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(2)
    expect(engine.getFreezeKeyframes(placementId)).toHaveLength(4)
  })

  it('orphan choice keeps freeze keys as plain keyframes', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    const result = deleteCollectionPlacementWithFreeze(
      engine,
      dispatch as never,
      placementId,
      'orphan',
    )
    expect(result.ok).toBe(true)
    expect(result.freezeOrphaned).toBe(4)
    expect(() => engine.getCollectionPlacement(placementId)).toThrow()
    // keys stay, links stripped
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => k.time)).toEqual([2, 6])
    for (const kf of engine.getKeyframes(paw.id, 'positionX')) {
      expect(kf.freezeLink).toBeUndefined()
    }
    // undo restores the placement and the links
    expect(dispatcher.undo()).toBe(true)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(2)
    expect(engine.getFreezeKeyframes(placementId)).toHaveLength(4)
  })

  it('freeze links survive a JSON round-trip', () => {
    const { engine, dispatcher, undoStack, placementId } = setupPlacedCollection()
    expect(
      executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
        placementId,
        source: 'last',
      }).ok,
    ).toBe(true)
    const restored = createEngine()
    restored.restoreFromJSON(engine.toJSON())
    const linked = restored.getFreezeKeyframes(placementId)
    expect(linked).toHaveLength(4)
    expect(linked.filter((l) => l.keyframe.freezeLink?.role === 'last')).toHaveLength(2)
    expect(linked.filter((l) => l.keyframe.freezeLink?.role === 'prefix')).toHaveLength(2)
  })

  it('duplicate slide remaps freeze links to the copied placement', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    expect(
      executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
        placementId,
        source: 'last',
      }).ok,
    ).toBe(true)
    const slide = engine.getActiveSlide()!
    const copy = engine.duplicateSlide(slide.id)
    const copiedParentId = copy.scene.root.children.find((c) => c.name === 'Cat')!.id
    const copiedPlacementId = engine.getNode(copiedParentId).collectionPlacements[0]!.id
    expect(copiedPlacementId).not.toBe(placementId)
    const linked = engine.getFreezeKeyframes(copiedPlacementId)
    expect(linked).toHaveLength(4)
    // old placement keeps its own links
    expect(engine.getFreezeKeyframes(placementId)).toHaveLength(4)
    void paw
  })

  it('skips (never overwrites) freeze keys whose destination is occupied', () => {
    const { engine, dispatcher, undoStack, placementId, paw } = setupPlacedCollection()
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    expect(
      executeCollectionFreeze(engine, dispatch, undoStack, { placementId, source: 'last' }).ok,
    ).toBe(true)
    // plant a manual key exactly where the frozen end would land after a +3 move
    engine.addKeyframe({ kind: 'node', nodeId: paw.id, property: 'positionX' }, 9, 999)
    const env = collectionLaneEnvFromEngine(engine)
    const res = commitCollectionMove(env, dispatch as never, placementId, 5, 2, {
      maxStartTime: 20,
    })
    expect(res.ok).toBe(true)
    expect(res.freezeSkipped).toBeGreaterThan(0)
    // the manual key is untouched
    expect(engine.getKeyframes(paw.id, 'positionX').find((k) => k.time === 9)?.value).toBe(999)
  })
})
