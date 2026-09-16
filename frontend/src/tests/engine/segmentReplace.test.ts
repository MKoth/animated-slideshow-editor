import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
} from '../../engine/commands'
import type { KeyframeTarget } from '../../engine/keyframeTarget'
import { executeSegmentToCollection } from '../../engine/timeSegmentExtraction'
import { executeCollectionFlatten } from '../../engine/collectionFlatten'

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

function propTarget(nodeId: string): KeyframeTarget {
  return { kind: 'node', nodeId, property: 'positionX' }
}

function extractables(engine: Engine, nodeId: string) {
  return engine.getKeyframes(nodeId, 'positionX').map((kf) => ({
    target: propTarget(nodeId),
    time: kf.time,
    value: kf.value,
    interpolation: kf.interpolation,
    tangentIn: { ...kf.tangentIn },
    tangentOut: { ...kf.tangentOut },
    keyframeId: kf.id,
  }))
}

function setupCollection(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  parentId: string
  leftId: string
  rightId: string
  collectionId: string
  oldLeftClipId: string
  oldRightClipId: string
} {
  const { engine, dispatcher, undoStack } = setupEngine()
  const slide = engine.getActiveSlide()!
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
  const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
  const right = engine.createNode(slide.scene.id, parent.id, 'RightHand')
  engine.setSemanticName(left.id, 'left_hand')
  engine.setSemanticName(right.id, 'right_hand')
  for (const [nodeId, times] of [
    [left.id, [1, 2, 3]],
    [right.id, [2, 3, 4]],
  ] as const) {
    for (const t of times) {
      engine.addKeyframe({ kind: 'node', nodeId, property: 'positionX' }, t, t * 10)
    }
  }
  const result = executeSegmentToCollection(
    engine,
    dispatcher.dispatch.bind(dispatcher),
    undoStack,
    {
      parentNodeId: parent.id,
      from: 1,
      to: 4,
      objects: [
        {
          nodeId: left.id,
          nodeName: 'LeftHand',
          semanticName: 'left_hand',
          clipName: 'LeftHand Clip 1',
          category: 'left_hand',
          keyframes: extractables(engine, left.id),
        },
        {
          nodeId: right.id,
          nodeName: 'RightHand',
          semanticName: 'right_hand',
          clipName: 'RightHand Clip 1',
          category: 'right_hand',
          keyframes: extractables(engine, right.id),
        },
      ],
      collectionName: 'Rig',
      deleteOrphans: true,
      keepFirst: false,
      keepLast: false,
    },
  )
  if (!result.ok) throw new Error('setup failed')
  const col = engine.getClipCollection(result.collectionId)
  return {
    engine,
    dispatcher,
    undoStack,
    parentId: parent.id,
    leftId: left.id,
    rightId: right.id,
    collectionId: result.collectionId,
    oldLeftClipId: col.getBinding('left_hand')!,
    oldRightClipId: col.getBinding('right_hand')!,
  }
}

describe('replace from timeline', () => {
  it('rebinds included names, keeps untouched, deletes displaced exclusives in one undo step', () => {
    const {
      engine,
      dispatcher,
      undoStack,
      parentId,
      leftId,
      collectionId,
      oldLeftClipId,
      oldRightClipId,
    } = setupCollection()
    // New orphan work only for left_hand in [5,7]
    engine.addKeyframe(propTarget(leftId), 5, 50)
    engine.addKeyframe(propTarget(leftId), 6, 60)
    const baseline = undoStack.entries.length
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parentId,
        from: 5,
        to: 7,
        objects: [
          {
            nodeId: leftId,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'LeftHand Clip 1',
            category: 'left_hand',
            keyframes: extractables(engine, leftId).filter((k) => k.time >= 5 && k.time <= 7),
          },
        ],
        collectionName: 'ignored',
        deleteOrphans: true,
        keepFirst: false,
        keepLast: false,
        replaceCollectionId: collectionId,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.replaced).toBe(true)
    expect(result.collectionId).toBe(collectionId)
    const col = engine.getClipCollection(collectionId)
    // left rebound, right untouched
    expect(col.getBinding('left_hand')).not.toBe(oldLeftClipId)
    expect(col.getBinding('right_hand')).toBe(oldRightClipId)
    // old left deleted (exclusive, unplaced), old right kept
    expect(() => engine.getClip(oldLeftClipId)).toThrow()
    expect(engine.getClip(oldRightClipId).name).toBe('RightHand Clip 1')
    expect(result.deletedOldClipIds).toContain(oldLeftClipId)
    // orphans deleted
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(0)
    // single history entry
    expect(undoStack.entries.length).toBe(baseline + 1)
    // undo restores previous collection exactly
    expect(dispatcher.undo()).toBe(true)
    const restored = engine.getClipCollection(collectionId)
    expect(restored.getBinding('left_hand')).toBe(oldLeftClipId)
    expect(engine.getClip(oldLeftClipId).name).toBe('LeftHand Clip 1')
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(2)
    // redo restores replaced collection exactly
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getClipCollection(collectionId).getBinding('left_hand')).not.toBe(oldLeftClipId)
    expect(() => engine.getClip(oldLeftClipId)).toThrow()
  })

  it('keeps a displaced clip with a warning when another collection still binds it', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, collectionId, oldLeftClipId } =
      setupCollection()
    // Second collection sharing the left clip
    const other = engine.createClipCollection('Other', { left_hand: oldLeftClipId }, parentId)
    engine.addKeyframe(propTarget(leftId), 5, 50)
    engine.addKeyframe(propTarget(leftId), 6, 60)
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parentId,
        from: 5,
        to: 7,
        objects: [
          {
            nodeId: leftId,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'LeftHand Clip 1',
            category: 'left_hand',
            keyframes: extractables(engine, leftId).filter((k) => k.time >= 5 && k.time <= 7),
          },
        ],
        collectionName: 'ignored',
        deleteOrphans: false,
        keepFirst: false,
        keepLast: false,
        replaceCollectionId: collectionId,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    // Shared clip kept
    expect(engine.getClip(oldLeftClipId).name).toBe('LeftHand Clip 1')
    expect(other.getBinding('left_hand')).toBe(oldLeftClipId)
    expect(result.warnings.some((w) => w.includes('another collection'))).toBe(true)
    expect(result.keptSharedClipNames?.length).toBe(1)
  })

  it('round-trip: flatten, tweak, replace plays back the tweaked motion', () => {
    const { engine, dispatcher, undoStack, leftId, collectionId } = setupCollection()
    const flat = executeCollectionFlatten(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      collectionId,
      from: 5,
      to: 8,
    })
    expect(flat.ok).toBe(true)
    // Tweak one flattened keyframe
    const orphans = [...engine.getKeyframes(leftId, 'positionX')].sort((a, b) => a.time - b.time)
    expect(orphans.length).toBeGreaterThan(0)
    const first = orphans[0]!
    engine.setKeyframeValue(propTarget(leftId), first.id, 999)
    // Replace back into the same collection
    const kfs = extractables(engine, leftId)
    const slide = engine.getActiveSlide()!
    const parent = engine.getNode(
      engine.getClipCollection(collectionId).sourceNodeId ?? slide.scene.root.id,
    )
    const replaced = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parent.id,
        from: 5,
        to: 8,
        objects: [
          {
            nodeId: leftId,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'LeftHand Clip 1',
            category: 'left_hand',
            keyframes: kfs,
          },
        ],
        collectionName: 'ignored',
        deleteOrphans: true,
        keepFirst: false,
        keepLast: false,
        replaceCollectionId: collectionId,
      },
    )
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) throw new Error('expected ok')
    const col = engine.getClipCollection(collectionId)
    const newClip = engine.getClip(col.getBinding('left_hand')!)
    const vals = newClip.getChannelKeyframes('positionX').map((k) => k.value)
    expect(vals).toContain(999)
    // Orphans cleaned up when requested
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(0)
  })
})
