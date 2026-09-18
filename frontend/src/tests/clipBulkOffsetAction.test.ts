import { describe, it, expect } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
} from '../engine/commands'
import { executeBulkClipOffset, previewBulkClipOffset } from '../app/clipBulkOffsetAction'

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

function makeClip(
  dispatcher: CommandDispatcher,
  name: string,
  channels: {
    property: 'positionX' | 'positionY' | 'opacity'
    paramKey?: string
    linkMode?: 'gain' | 'offset'
  }[],
  params: { key: string; label: string; kind: 'number'; default: number }[] = [],
): string {
  return expectOk(
    dispatcher.dispatch(
      new CreateClipCommand({
        name,
        duration: 1,
        category: '',
        params,
        channels: channels.map((c) => ({
          property: c.property,
          ...(c.paramKey ? { paramKey: c.paramKey, linkMode: c.linkMode ?? 'offset' } : {}),
        })),
      }),
    ),
  ).clipId
}

function addKf(
  dispatcher: CommandDispatcher,
  clipId: string,
  channel: 'positionX' | 'positionY' | 'opacity',
  time: number,
  value: number,
): void {
  expectOk(
    dispatcher.dispatch(
      new AddClipKeyframeCommand({ target: { kind: 'clip', clipId, channel }, time, value }),
    ),
  )
}

describe('executeBulkClipOffset', () => {
  it('offsets positionY keyframes in place across two clips sharing semantic head', () => {
    const { engine, dispatcher } = setupEngine()
    const clipHead1 = makeClip(dispatcher, 'A', [{ property: 'positionY' }])
    const clipHead2 = makeClip(dispatcher, 'B', [{ property: 'positionY' }])
    addKf(dispatcher, clipHead1, 'positionY', 0, 10)
    addKf(dispatcher, clipHead1, 'positionY', 1, 20)
    addKf(dispatcher, clipHead2, 'positionY', 0, 0)
    addKf(dispatcher, clipHead2, 'positionY', 1, 5)

    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [clipHead1, clipHead2],
      offsets: { positionY: 100 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.keyframeCount).toBe(4)
    expect(result.clipCount).toBe(2)
    expect(engine.getClipChannelKeyframes(clipHead1, 'positionY').map((kf) => kf.value)).toEqual([
      110, 120,
    ])
    expect(engine.getClipChannelKeyframes(clipHead2, 'positionY').map((kf) => kf.value)).toEqual([
      100, 105,
    ])
  })

  it('leaves tangents untouched and undoes multi-clip edits in one step', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(dispatcher, 'A', [{ property: 'positionX' }])
    const clipId2 = makeClip(dispatcher, 'B', [{ property: 'positionX' }])
    addKf(dispatcher, clipId, 'positionX', 0, 7)
    addKf(dispatcher, clipId2, 'positionX', 0, 1)
    const before = engine.getClipChannelKeyframes(clipId, 'positionX')[0]!
    const tangentIn = { ...before.tangentIn }
    const tangentOut = { ...before.tangentOut }

    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [clipId, clipId2],
      offsets: { positionX: -3 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.keyframeCount).toBe(2)
    const after = engine.getClipChannelKeyframes(clipId, 'positionX')[0]!
    expect(after.value).toBe(4)
    expect(after.tangentIn).toEqual(tangentIn)
    expect(after.tangentOut).toEqual(tangentOut)
    expect(engine.getClipChannelKeyframes(clipId2, 'positionX')[0]!.value).toBe(-2)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.getClipChannelKeyframes(clipId, 'positionX')[0]!.value).toBe(7)
    expect(engine.getClipChannelKeyframes(clipId2, 'positionX')[0]!.value).toBe(1)
  })

  it('skips param-linked channels and reports them', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(
      dispatcher,
      'Linked',
      [{ property: 'positionX', paramKey: 'p', linkMode: 'offset' }],
      [{ key: 'p', label: 'P', kind: 'number', default: 1 }],
    )
    addKf(dispatcher, clipId, 'positionX', 0, 50)
    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [clipId],
      offsets: { positionX: 100 },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure for linked-only selection')
    expect(result.error).toContain('param-linked')
    expect(engine.getClipChannelKeyframes(clipId, 'positionX')[0]!.value).toBe(50)
  })

  it('offsets unlinked channels while reporting linked ones as skipped', () => {
    const { engine, dispatcher } = setupEngine()
    const plain = makeClip(dispatcher, 'Plain', [{ property: 'positionY' }])
    const linked = makeClip(
      dispatcher,
      'Linked',
      [{ property: 'positionY', paramKey: 'p', linkMode: 'offset' }],
      [{ key: 'p', label: 'P', kind: 'number', default: 1 }],
    )
    addKf(dispatcher, plain, 'positionY', 0, 5)
    addKf(dispatcher, linked, 'positionY', 0, 50)
    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [plain, linked],
      offsets: { positionY: 10 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.keyframeCount).toBe(1)
    expect(result.skippedLinked).toBe(1)
    expect(engine.getClipChannelKeyframes(plain, 'positionY')[0]!.value).toBe(15)
    expect(engine.getClipChannelKeyframes(linked, 'positionY')[0]!.value).toBe(50)
  })

  it('clamps opacity into [0,1] and counts clamps', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(dispatcher, 'O', [{ property: 'opacity' }])
    addKf(dispatcher, clipId, 'opacity', 0, 0.9)
    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [clipId],
      offsets: { opacity: 0.5 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(engine.getClipChannelKeyframes(clipId, 'opacity')[0]!.value).toBe(1)
    expect(result.clampedCount).toBe(1)
  })

  it('returns ok:false on empty selection and all-zero deltas', () => {
    const { engine, dispatcher } = setupEngine()
    const empty = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [],
      offsets: { positionY: 100 },
    })
    expect(empty.ok).toBe(false)
    const zero = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: ['whatever'],
      offsets: { positionY: 0 },
    })
    expect(zero.ok).toBe(false)
  })

  it('skips missing clips and channels without tracks', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(dispatcher, 'A', [{ property: 'positionY' }])
    addKf(dispatcher, clipId, 'positionY', 0, 1)
    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), {
      clipIds: [clipId, 'missing-clip'],
      offsets: { positionY: 10, positionX: 10 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.keyframeCount).toBe(1)
    expect(result.skippedMissing).toBe(1)
  })

  it('preview counts agree with execute (including opacity clamp noops)', () => {
    const { engine, dispatcher } = setupEngine()
    const clipId = makeClip(dispatcher, 'A', [{ property: 'positionY' }, { property: 'opacity' }])
    addKf(dispatcher, clipId, 'positionY', 0, 1)
    addKf(dispatcher, clipId, 'positionY', 1, 2)
    addKf(dispatcher, clipId, 'opacity', 0, 1)
    const selection = {
      clipIds: [clipId, 'missing-clip'],
      offsets: { positionY: 10, opacity: 0.5 },
    } as const
    const preview = previewBulkClipOffset(engine, selection)
    const result = executeBulkClipOffset(engine, dispatcher.dispatch.bind(dispatcher), selection)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    // opacity 1 + 0.5 clamps to 1 (noop, uncounted); positionY writes 2
    expect(preview).toEqual({
      clipCount: result.clipCount,
      keyframeCount: result.keyframeCount,
      skippedLinked: result.skippedLinked,
      skippedMissing: result.skippedMissing,
    })
    expect(result.keyframeCount).toBe(2)
  })
})
