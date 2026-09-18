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
import { Keyframe } from '../../engine/keyframe'
import { executeSegmentToCollection } from '../../engine/timeSegmentExtraction'
import {
  previewCollectionFlatten,
  executeCollectionFlatten,
  longestClipDuration,
} from '../../engine/collectionFlatten'

function setupEngine(): { engine: Engine; dispatcher: CommandDispatcher; undoStack: UndoStack } {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  const res = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!res.ok) throw new Error('create project failed')
  const slideRes = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  if (!slideRes.ok) throw new Error('create slide failed')
  // Extend slide duration for flatten ranges
  const slide = engine.getActiveSlide()!
  slide.duration = 20
  return { engine, dispatcher, undoStack }
}

function propTarget(nodeId: string): KeyframeTarget {
  return { kind: 'node', nodeId, property: 'positionX' }
}

/** Build a rig with a collection minted from orphans in [1,4]; orphans deleted. */
function setupCollection(): {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  parentId: string
  leftId: string
  rightId: string
  collectionId: string
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
  const leftKfs = engine.getKeyframes(left.id, 'positionX').map((kf) => ({
    target: propTarget(left.id),
    time: kf.time,
    value: kf.value,
    interpolation: kf.interpolation,
    tangentIn: kf.tangentIn,
    tangentOut: kf.tangentOut,
    keyframeId: kf.id,
  }))
  const rightKfs = engine.getKeyframes(right.id, 'positionX').map((kf) => ({
    target: propTarget(right.id),
    time: kf.time,
    value: kf.value,
    interpolation: kf.interpolation,
    tangentIn: kf.tangentIn,
    tangentOut: kf.tangentOut,
    keyframeId: kf.id,
  }))
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
          keyframes: leftKfs,
        },
        {
          nodeId: right.id,
          nodeName: 'RightHand',
          semanticName: 'right_hand',
          clipName: 'RightHand Clip 1',
          category: 'right_hand',
          keyframes: rightKfs,
        },
      ],
      collectionName: 'Rig',
      deleteOrphans: true,
      keepFirst: false,
      keepLast: false,
    },
  )
  if (!result.ok) throw new Error(`setup collection failed: ${result.error}`)
  return {
    engine,
    dispatcher,
    undoStack,
    parentId: parent.id,
    leftId: left.id,
    rightId: right.id,
    collectionId: result.collectionId,
  }
}

describe('collection flatten preview', () => {
  it('reports per-node write counts with no conflicts on a clean range', () => {
    const { engine, collectionId } = setupCollection()
    const preview = previewCollectionFlatten(engine, { collectionId, from: 5, to: 8 })
    expect(preview.conflicts).toHaveLength(0)
    expect(preview.totalWrites).toBe(6)
    expect(preview.truncatedCount).toBe(0)
    const byName = new Map(preview.entries.map((e) => [e.nodeName, e.writeCount]))
    expect(byName.get('LeftHand')).toBe(3)
    expect(byName.get('RightHand')).toBe(3)
  })

  it('counts truncated keys past To', () => {
    const { engine, collectionId } = setupCollection()
    // Clips have duration 3 → timeline [5,8]; To=7 truncates the last key of each clip
    const preview = previewCollectionFlatten(engine, { collectionId, from: 5, to: 7 })
    expect(preview.truncatedCount).toBeGreaterThan(0)
    expect(preview.totalWrites + preview.truncatedCount).toBe(6)
  })
})

describe('executeCollectionFlatten', () => {
  it('flattens symmetry keyframes from collection clips', () => {
    const { engine, dispatcher, undoStack, collectionId, leftId } = setupCollection()
    const collection = engine.getClipCollection(collectionId)
    const clip = engine.getClip(collection.getBinding('left_hand')!)
    clip.addSymmetryKeyframe(new Keyframe('symmetry-0', 0, { axis: 'x', factor: 0 }))
    clip.addSymmetryKeyframe(new Keyframe('symmetry-1', 1, { axis: 'x', factor: 1 }))

    const result = executeCollectionFlatten(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      { collectionId, from: 5, to: 8 },
    )

    expect(result.ok).toBe(true)
    expect(engine.getSymmetryKeyframes(leftId).map((kf) => kf.value)).toEqual([
      { axis: 'x', factor: 0 },
      { axis: 'x', factor: 1 },
    ])
  })

  it('writes orphans at natural duration with values verbatim', () => {
    const { engine, dispatcher, undoStack, collectionId, leftId, rightId } = setupCollection()
    const result = executeCollectionFlatten(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      { collectionId, from: 5, to: 8 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.writtenCount).toBe(6)
    expect(result.truncatedCount).toBe(0)
    // Natural duration: left clip keys u=0,1/3,2/3 → 5,6,7; values 10,20,30
    const leftTimes = [...engine.getKeyframes(leftId, 'positionX')]
      .map((k) => k.time)
      .sort((a, b) => a - b)
    expect(leftTimes).toEqual([5, 6, 7])
    const leftVals = [...engine.getKeyframes(leftId, 'positionX')]
      .sort((a, b) => a.time - b.time)
      .map((k) => k.value)
    expect(leftVals).toEqual([10, 20, 30])
    const rightTimes = [...engine.getKeyframes(rightId, 'positionX')]
      .map((k) => k.time)
      .sort((a, b) => a - b)
    expect(rightTimes).toEqual([6, 7, 8])
  })

  it('scales bezier tangent time-components by clip duration', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const hand = engine.createNode(slide.scene.id, parent.id, 'Hand')
    engine.setSemanticName(hand.id, 'hand')
    engine.addKeyframe({ kind: 'node', nodeId: hand.id, property: 'positionX' }, 1, 0)
    engine.addKeyframe({ kind: 'node', nodeId: hand.id, property: 'positionX' }, 2, 10)
    // Force bezier with known tangents via direct manipulation
    const kfs = engine.getKeyframes(hand.id, 'positionX')
    for (const kf of kfs) {
      engine.setKeyframeInterpolation(
        { kind: 'node', nodeId: hand.id, property: 'positionX' },
        kf.id,
        'bezier',
      )
      engine.setKeyframeTangents(
        { kind: 'node', nodeId: hand.id, property: 'positionX' },
        kf.id,
        { time: 0.5, value: 2 },
        { time: 0.5, value: 3 },
      )
    }
    const extractables = engine.getKeyframes(hand.id, 'positionX').map((kf) => ({
      target: propTarget(hand.id),
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: { ...kf.tangentIn },
      tangentOut: { ...kf.tangentOut },
      keyframeId: kf.id,
    }))
    const created = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parent.id,
        from: 0,
        to: 2,
        objects: [
          {
            nodeId: hand.id,
            nodeName: 'Hand',
            semanticName: 'hand',
            clipName: 'Hand Clip 1',
            category: 'hand',
            keyframes: extractables,
          },
        ],
        collectionName: 'C',
        deleteOrphans: true,
        keepFirst: false,
        keepLast: false,
      },
    )
    if (!created.ok) throw new Error('setup failed')
    // Clip duration is 2 (segment [0,2]); extraction normalized tangents by /2 → 0.25
    const clip = engine.getClip(created.clips[0]!.clipId)
    const clipKf = clip.getChannelKeyframes('positionX')[0]!
    expect(clipKf.tangentIn.time).toBeCloseTo(0.25)
    // Flatten at natural duration from=5: timeline = 5 + u*2, tangents scaled back by *2 → 0.5
    const flat = executeCollectionFlatten(engine, dispatcher.dispatch.bind(dispatcher), undoStack, {
      collectionId: created.collectionId,
      from: 5,
      to: 7,
    })
    expect(flat.ok).toBe(true)
    const orphans = [...engine.getKeyframes(hand.id, 'positionX')].sort((a, b) => a.time - b.time)
    expect(orphans).toHaveLength(2)
    expect(orphans[0]!.tangentIn.time).toBeCloseTo(0.5)
    expect(orphans[0]!.tangentOut.time).toBeCloseTo(0.5)
    expect(orphans[0]!.interpolation).toBe('bezier')
  })

  it('refuses with a track-by-track error and writes nothing when orphans exist in range', () => {
    const { engine, dispatcher, undoStack, collectionId, leftId } = setupCollection()
    engine.addKeyframe({ kind: 'node', nodeId: leftId, property: 'positionX' }, 6, 999)
    const baseline = undoStack.entries.length
    const result = executeCollectionFlatten(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      { collectionId, from: 5, to: 8 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toMatch(/LeftHand/)
    expect(result.error).toMatch(/positionX/)
    // Zero writes: only the pre-existing orphan remains
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(1)
    expect(undoStack.entries.length).toBe(baseline)
  })

  it('skips keys past To with a warning count', () => {
    const { engine, dispatcher, undoStack, collectionId, leftId } = setupCollection()
    const result = executeCollectionFlatten(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      { collectionId, from: 5, to: 6.5 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.truncatedCount).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('past To'))).toBe(true)
    for (const kf of engine.getKeyframes(leftId, 'positionX')) {
      expect(kf.time).toBeLessThanOrEqual(6.5 + 1e-9)
    }
  })

  it('leaves placements alone and undoes in a single history entry', () => {
    const { engine, dispatcher, undoStack, collectionId, parentId, leftId } = setupCollection()
    engine.placeCollection(collectionId, parentId, 0)
    const placementsBefore = engine.getCollectionPlacements(parentId).length
    expect(placementsBefore).toBe(1)
    const baseline = undoStack.entries.length
    const result = executeCollectionFlatten(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      { collectionId, from: 5, to: 8 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.warnings.some((w) => w.includes('double-drive'))).toBe(true)
    expect(engine.getCollectionPlacements(parentId)).toHaveLength(1)
    expect(undoStack.entries.length).toBe(baseline + 1)
    expect(dispatcher.undo()).toBe(true)
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(0)
    expect(engine.getCollectionPlacements(parentId)).toHaveLength(1)
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getKeyframes(leftId, 'positionX').length).toBeGreaterThan(0)
  })

  it('longestClipDuration drives the default range helper', () => {
    const { engine, collectionId } = setupCollection()
    expect(longestClipDuration(engine, collectionId)).toBeCloseTo(3)
  })
})
