import { describe, it, expect, vi } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  CreateClipCollectionCommand,
  AddClipKeyframeCommand,
  SetClipKeyframeInterpolationCommand,
  SetClipKeyframeTangentsCommand,
} from '../engine/commands'
import {
  buildLibraryDestRows,
  executeProportionalCopy,
  previewProportionalCopy,
  resolveLibraryDestIds,
} from '../app/clipProportionalCopyAction'
import type { ProportionalCopySelection } from '../app/clipProportionalCopyAction'

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

type Channel = 'positionX' | 'positionY' | 'rotation' | 'opacity'

function makeClip(
  dispatcher: CommandDispatcher,
  name: string,
  duration: number,
  channels: Channel[],
): string {
  return expectOk(
    dispatcher.dispatch(
      new CreateClipCommand({
        name,
        duration,
        category: '',
        channels: channels.map((property) => ({ property })),
      }),
    ),
  ).clipId
}

function makeLinkedClip(dispatcher: CommandDispatcher, name: string, duration: number): string {
  return expectOk(
    dispatcher.dispatch(
      new CreateClipCommand({
        name,
        duration,
        category: '',
        params: [{ key: 'p', label: 'P', kind: 'number', default: 1 }],
        channels: [{ property: 'positionX', paramKey: 'p', linkMode: 'offset' }],
      }),
    ),
  ).clipId
}

function makeCollection(
  dispatcher: CommandDispatcher,
  name: string,
  bindings: Record<string, string>,
): string {
  return expectOk(dispatcher.dispatch(new CreateClipCollectionCommand({ name, bindings })))
    .collectionId
}

function addKf(
  engine: Engine,
  dispatcher: CommandDispatcher,
  clipId: string,
  channel: Channel,
  time: number,
  value: number,
): string {
  const before = new Set(engine.getClipChannelKeyframes(clipId, channel).map((kf) => kf.id))
  expectOk(
    dispatcher.dispatch(
      new AddClipKeyframeCommand({ target: { kind: 'clip', clipId, channel }, time, value }),
    ),
  )
  const created = engine.getClipChannelKeyframes(clipId, channel).find((kf) => !before.has(kf.id))
  if (!created) throw new Error('keyframe was not created')
  return created.id
}

function kfData(engine: Engine, clipId: string, channel: Channel) {
  return engine.getClipChannelKeyframes(clipId, channel).map((kf) => ({
    time: kf.time,
    value: kf.value,
    interpolation: kf.interpolation,
    tangentIn: { ...kf.tangentIn },
    tangentOut: { ...kf.tangentOut },
  }))
}

function baseSelection(overrides: Partial<ProportionalCopySelection>): ProportionalCopySelection {
  return {
    sourceCollectionId: '',
    fromNorm: 0,
    toNorm: 1,
    bindings: [],
    destCollectionIds: [],
    mode: 'exact',
    reverse: false,
    ...overrides,
  }
}

describe('proportional copy', () => {
  it('copies exact values at the same normalized times into another collection', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 8, ['positionX', 'positionY'])
    addKf(engine, dispatcher, src, 'positionX', 0, 10)
    addKf(engine, dispatcher, src, 'positionX', 0.5, 20)
    addKf(engine, dispatcher, src, 'positionX', 1, 30)
    addKf(engine, dispatcher, src, 'positionY', 0.25, 5)
    const dst = makeClip(dispatcher, 'Dst', 8, ['positionX', 'positionY'])
    const srcCol = makeCollection(dispatcher, 'TurnLeft', { head: src })
    const dstCol = makeCollection(dispatcher, 'TurnRight', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX', 'positionY'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.keyframeCount).toBe(4)
    expect(result.destClipCount).toBe(1)
    expect(kfData(engine, dst, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [0, 10],
      [0.5, 20],
      [1, 30],
    ])
    expect(kfData(engine, dst, 'positionY').map((k) => [k.time, k.value])).toEqual([[0.25, 5]])
  })

  it('maps a source sub-range onto the same normalized window of a shorter clip', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 8, ['positionX'])
    addKf(engine, dispatcher, src, 'positionX', 0, 1)
    addKf(engine, dispatcher, src, 'positionX', 0.25, 2)
    addKf(engine, dispatcher, src, 'positionX', 0.5, 3)
    addKf(engine, dispatcher, src, 'positionX', 0.75, 4)
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 0.5,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    // 0–4s of the 8s source lands on 0–2s of the 4s dest: same normalized times
    expect(kfData(engine, dst, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [0, 1],
      [0.25, 2],
      [0.5, 3],
    ])
  })

  it('replaces destination keyframes inside the window and keeps the rest', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX'])
    addKf(engine, dispatcher, src, 'positionX', 0.5, 100)
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX'])
    addKf(engine, dispatcher, dst, 'positionX', 0.1, 1)
    addKf(engine, dispatcher, dst, 'positionX', 0.5, 2)
    addKf(engine, dispatcher, dst, 'positionX', 0.9, 3)
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0.4,
      toNorm: 0.6,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.replacedCount).toBe(1)
    expect(kfData(engine, dst, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [0.1, 1],
      [0.5, 100],
      [0.9, 3],
    ])
  })

  it('mirror X negates positionX and rotation but keeps positionY', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX', 'positionY', 'rotation'])
    const kfX = addKf(engine, dispatcher, src, 'positionX', 0.5, 10)
    expectOk(
      dispatcher.dispatch(
        new SetClipKeyframeTangentsCommand({
          target: { kind: 'clip', clipId: src, channel: 'positionX' },
          keyframeId: kfX,
          tangentIn: { time: 0.1, value: 2 },
          tangentOut: { time: 0.2, value: 3 },
        }),
      ),
    )
    addKf(engine, dispatcher, src, 'positionY', 0.5, 7)
    addKf(engine, dispatcher, src, 'rotation', 0.5, 30)
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX', 'positionY', 'rotation'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX', 'positionY', 'rotation'] }],
      destCollectionIds: [dstCol],
      mode: 'mirrorX',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const x = kfData(engine, dst, 'positionX')
    expect(x.map((k) => k.value)).toEqual([-10])
    expect(x[0]!.tangentIn).toEqual({ time: 0.1, value: -2 })
    expect(x[0]!.tangentOut).toEqual({ time: 0.2, value: -3 })
    expect(kfData(engine, dst, 'positionY').map((k) => k.value)).toEqual([7])
    expect(kfData(engine, dst, 'rotation').map((k) => k.value)).toEqual([-30])
  })

  it('preserves interpolation through copy, undo and redo', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX'])
    const kfId = addKf(engine, dispatcher, src, 'positionX', 0.5, 42)
    expectOk(
      dispatcher.dispatch(
        new SetClipKeyframeInterpolationCommand({
          target: { kind: 'clip', clipId: src, channel: 'positionX' },
          keyframeId: kfId,
          interpolation: 'bezier',
        }),
      ),
    )
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX'])
    addKf(engine, dispatcher, dst, 'positionX', 0.5, 1)
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    const copied = kfData(engine, dst, 'positionX')
    expect(copied).toHaveLength(1)
    expect(copied[0]!.value).toBe(42)
    expect(copied[0]!.interpolation).toBe('bezier')

    expect(dispatcher.undo()).toBe(true)
    expect(kfData(engine, dst, 'positionX').map((k) => k.value)).toEqual([1])
    expect(dispatcher.redo()).toBe(true)
    const redone = kfData(engine, dst, 'positionX')
    expect(redone).toHaveLength(1)
    expect(redone[0]!.value).toBe(42)
    expect(redone[0]!.interpolation).toBe('bezier')
  })

  it('creates a missing destination channel and skips param-linked tracks', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX', 'positionY'])
    addKf(engine, dispatcher, src, 'positionX', 0.5, 4)
    addKf(engine, dispatcher, src, 'positionY', 0.5, 9)
    const linkedSrc = makeLinkedClip(dispatcher, 'LinkedSrc', 4)
    addKf(engine, dispatcher, linkedSrc, 'positionX', 0.5, 3)
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionY'])
    const linkedDst = makeLinkedClip(dispatcher, 'LinkedDst', 4)
    const srcCol = makeCollection(dispatcher, 'A', { head: src, arm: linkedSrc })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst, arm: linkedDst })

    const preview = previewProportionalCopy(
      engine,
      baseSelection({
        sourceCollectionId: srcCol,
        fromNorm: 0,
        toNorm: 1,
        bindings: [
          { semanticName: 'head', channels: ['positionX', 'positionY'] },
          { semanticName: 'arm', channels: ['positionX'] },
        ],
        destCollectionIds: [dstCol],
        mode: 'exact',
        reverse: false,
      }),
    )
    // head/positionX: dest lacks the channel entirely (created on copy);
    // arm/positionX is param-linked and skipped once per pair.
    expect(preview.skippedLinked).toBe(1)
    expect(preview.keyframeCount).toBe(2)

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [
        { semanticName: 'head', channels: ['positionX', 'positionY'] },
        { semanticName: 'arm', channels: ['positionX'] },
      ],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(engine.getClip(dst).hasChannel('positionX')).toBe(true)
    expect(kfData(engine, dst, 'positionX').map((k) => k.value)).toEqual([4])
    expect(kfData(engine, dst, 'positionY').map((k) => k.value)).toEqual([9])
    // param-linked tracks are left untouched on both sides
    expect(engine.getClipChannelKeyframes(linkedDst, 'positionX')).toHaveLength(0)
    expect(kfData(engine, linkedSrc, 'positionX').map((k) => k.value)).toEqual([3])
  })

  it('reports missing semantic bindings and fails cleanly on empty ranges', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX'])
    addKf(engine, dispatcher, src, 'positionX', 0.1, 1)
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { leg: dst })

    const preview = previewProportionalCopy(
      engine,
      baseSelection({
        sourceCollectionId: srcCol,
        fromNorm: 0,
        toNorm: 1,
        bindings: [{ semanticName: 'head', channels: ['positionX'] }],
        destCollectionIds: [dstCol],
        mode: 'exact',
        reverse: false,
      }),
    )
    expect(preview.skippedMissingSemantic).toBe(1)
    expect(preview.keyframeCount).toBe(0)

    const missing = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(missing.ok).toBe(false)

    const emptyWindow = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0.8,
      toNorm: 0.9,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(emptyWindow.ok).toBe(false)

    const badRange = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0.9,
      toNorm: 0.9,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: false,
    })
    expect(badRange.ok).toBe(false)

    const noDest = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [],
      mode: 'exact',
      reverse: false,
    })
    expect(noDest.ok).toBe(false)
  })

  it('copies one source binding into several destination collections at once', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 6, ['positionX'])
    addKf(engine, dispatcher, src, 'positionX', 0.5, 11)
    const dst1 = makeClip(dispatcher, 'Dst1', 6, ['positionX'])
    const dst2 = makeClip(dispatcher, 'Dst2', 3, ['positionX'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol1 = makeCollection(dispatcher, 'B', { head: dst1 })
    const dstCol2 = makeCollection(dispatcher, 'C', { head: dst2 })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol1, dstCol2],
      mode: 'exact',
      reverse: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.destClipCount).toBe(2)
    expect(kfData(engine, dst1, 'positionX').map((k) => [k.time, k.value])).toEqual([[0.5, 11]])
    expect(kfData(engine, dst2, 'positionX').map((k) => [k.time, k.value])).toEqual([[0.5, 11]])
    expect(dispatcher.undo()).toBe(true)
    expect(engine.getClipChannelKeyframes(dst1, 'positionX')).toHaveLength(0)
    expect(engine.getClipChannelKeyframes(dst2, 'positionX')).toHaveLength(0)
  })
})

describe('library destinations', () => {
  it('lists library entries except ones already imported, normalizing categories', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX'])
    const other = makeClip(dispatcher, 'Other', 4, ['positionX'])
    makeCollection(dispatcher, 'TurnLeft', { head: src })
    makeCollection(dispatcher, 'Nod', { head: other })

    const rows = buildLibraryDestRows(engine, [
      { id: 'e-src', name: 'TurnLeft', category: 'turns', bindings: { head: 'c1' } },
      { id: 'e-nod', name: 'Nod', category: null, bindings: { head: 'c2' } },
      { id: 'e-fresh', name: 'Wave', category: 'gestures', bindings: { head: 'c3', arm: 'c4' } },
      { id: 'e-legacy', name: 'Old', bindings: { head: 'c5' } },
    ])
    // TurnLeft and Nod already exist as project globals → excluded
    expect(rows.map((r) => r.key)).toEqual(['library:e-fresh', 'library:e-legacy'])
    expect(rows[0]).toMatchObject({
      origin: 'library',
      refId: 'e-fresh',
      collectionName: 'Wave',
      category: 'gestures',
      bindingCount: 2,
    })
    expect(rows[1]).toMatchObject({ category: '', bindingCount: 1 })
  })

  it('resolves library dests by reuse, import, and skips entries with no overlap', async () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX'])
    const reusedClip = makeClip(dispatcher, 'Reused', 4, ['positionX'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const reusedCol = makeCollection(dispatcher, 'LibReused', { head: reusedClip })
    const importer = vi.fn(async () => 'imported-id')

    const resolved = await resolveLibraryDestIds(
      engine,
      srcCol,
      [
        { id: 'e1', name: 'LibReused', bindings: { head: 'x' } },
        { id: 'e2', name: 'LibFresh', bindings: { head: 'y' } },
        { id: 'e3', name: 'LibEmpty', bindings: { leg: 'z' } },
      ],
      importer,
    )
    expect(resolved.ids).toEqual([reusedCol, 'imported-id'])
    expect(importer).toHaveBeenCalledOnce()
    expect(resolved.skipped).toEqual(['"LibEmpty" shares no objects with the source'])
  })

  it('reports a missing source and a failed import without throwing', async () => {
    const { engine } = setupEngine()
    const failing = await resolveLibraryDestIds(
      engine,
      'nope',
      [{ id: 'e1', name: 'X', bindings: { head: 'c' } }],
      async () => 'id',
    )
    expect(failing.ids).toEqual([])
    expect(failing.skipped).toEqual(['Source collection not found'])

    const { engine: engine2, dispatcher: dispatcher2 } = setupEngine()
    const src = makeClip(dispatcher2, 'Src', 4, ['positionX'])
    const srcCol = makeCollection(dispatcher2, 'A', { head: src })
    const failed = await resolveLibraryDestIds(
      engine2,
      srcCol,
      [{ id: 'e1', name: 'Broken', bindings: { head: 'c' } }],
      async () => null,
    )
    expect(failed.ids).toEqual([])
    expect(failed.skipped).toEqual(['"Broken" could not be imported'])
  })
})

describe('proportional copy with reverse', () => {
  it('mirrors times inside the window: end becomes start and vice versa', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 8, ['positionX'])
    addKf(engine, dispatcher, src, 'positionX', 0, 10)
    addKf(engine, dispatcher, src, 'positionX', 0.5, 20)
    addKf(engine, dispatcher, src, 'positionX', 1, 30)
    const dst = makeClip(dispatcher, 'Dst', 8, ['positionX'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.message).toContain('reversed')
    expect(kfData(engine, dst, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [0, 30],
      [0.5, 20],
      [1, 10],
    ])
  })

  it('reverses within a sub-window, leaving the rest of the destination alone', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 8, ['positionX'])
    addKf(engine, dispatcher, src, 'positionX', 0, 1)
    addKf(engine, dispatcher, src, 'positionX', 0.25, 2)
    addKf(engine, dispatcher, src, 'positionX', 0.5, 3)
    addKf(engine, dispatcher, src, 'positionX', 0.75, 4)
    const dst = makeClip(dispatcher, 'Dst', 8, ['positionX'])
    addKf(engine, dispatcher, dst, 'positionX', 0.9, 99)
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 0.5,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    // 0→0.5, 0.25→0.25, 0.5→0 inside the window; 0.9 untouched
    expect(kfData(engine, dst, 'positionX').map((k) => [k.time, k.value])).toEqual([
      [0, 3],
      [0.25, 2],
      [0.5, 1],
      [0.9, 99],
    ])
  })

  it('composes reverse with mirror X: values negate, tangent values survive both flips', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX', 'rotation'])
    const kfX = addKf(engine, dispatcher, src, 'positionX', 0.25, 10)
    expectOk(
      dispatcher.dispatch(
        new SetClipKeyframeInterpolationCommand({
          target: { kind: 'clip', clipId: src, channel: 'positionX' },
          keyframeId: kfX,
          interpolation: 'bezier',
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new SetClipKeyframeTangentsCommand({
          target: { kind: 'clip', clipId: src, channel: 'positionX' },
          keyframeId: kfX,
          tangentIn: { time: 0.1, value: 2 },
          tangentOut: { time: 0.2, value: 4 },
        }),
      ),
    )
    addKf(engine, dispatcher, src, 'rotation', 0.25, 30)
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX', 'rotation'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX', 'rotation'] }],
      destCollectionIds: [dstCol],
      mode: 'mirrorX',
      reverse: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const x = kfData(engine, dst, 'positionX')
    expect(x.map((k) => [k.time, k.value])).toEqual([[0.75, -10]])
    // reverse swaps sides and negates time; mirror negates values twice → back
    expect(x[0]!.tangentIn).toEqual({ time: -0.2, value: 4 })
    expect(x[0]!.tangentOut).toEqual({ time: -0.1, value: 2 })
    expect(kfData(engine, dst, 'rotation').map((k) => [k.time, k.value])).toEqual([[0.75, -30]])

    expect(dispatcher.undo()).toBe(true)
    expect(engine.getClipChannelKeyframes(dst, 'positionX')).toHaveLength(0)
    expect(dispatcher.redo()).toBe(true)
    expect(kfData(engine, dst, 'positionX').map((k) => [k.time, k.value])).toEqual([[0.75, -10]])
  })

  it('zeroes tangents on reversed non-bezier keys, like clip reverse', () => {
    const { engine, dispatcher } = setupEngine()
    const src = makeClip(dispatcher, 'Src', 4, ['positionX'])
    const kfId = addKf(engine, dispatcher, src, 'positionX', 0.25, 5)
    expectOk(
      dispatcher.dispatch(
        new SetClipKeyframeTangentsCommand({
          target: { kind: 'clip', clipId: src, channel: 'positionX' },
          keyframeId: kfId,
          tangentIn: { time: 0.1, value: 1 },
          tangentOut: { time: 0.1, value: 1 },
        }),
      ),
    )
    const dst = makeClip(dispatcher, 'Dst', 4, ['positionX'])
    const srcCol = makeCollection(dispatcher, 'A', { head: src })
    const dstCol = makeCollection(dispatcher, 'B', { head: dst })

    const result = executeProportionalCopy(engine, dispatcher.dispatch.bind(dispatcher), {
      sourceCollectionId: srcCol,
      fromNorm: 0,
      toNorm: 1,
      bindings: [{ semanticName: 'head', channels: ['positionX'] }],
      destCollectionIds: [dstCol],
      mode: 'exact',
      reverse: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const copied = kfData(engine, dst, 'positionX')
    expect(copied.map((k) => [k.time, k.value])).toEqual([[0.75, 5]])
    expect(copied[0]!.tangentIn).toEqual({ time: 0, value: 0 })
    expect(copied[0]!.tangentOut).toEqual({ time: 0, value: 0 })
  })
})
