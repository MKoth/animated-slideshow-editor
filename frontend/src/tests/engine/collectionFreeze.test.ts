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

  it('execute first writes first clip values at block end', () => {
    const { engine, dispatcher, undoStack, placementId, paw, tail } = setupPlacedCollection()
    const res = executeCollectionFreeze(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      placementId,
      source: 'first',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(engine.getKeyframes(paw.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 10],
    ])
    expect(engine.getKeyframes(tail.id, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [6, 100],
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
