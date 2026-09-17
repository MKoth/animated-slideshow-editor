import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  ExtractToClipCommand,
} from '../../engine/commands'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import { collectBakingKeyframes, collectBakingKeyframesForNode } from '../../engine/clipExtraction'
import type { KeyframeTarget } from '../../engine/keyframeTarget'
import {
  validateSegmentRange,
  defaultSegmentRange,
  inSegment,
  nextClipNameForNode,
  uniqueClipName,
  defaultSegmentCollectionName,
  isClipStorableTarget,
  deleteGroupKey,
  planSegmentDeletes,
  executeSegmentToCollection,
} from '../../engine/timeSegmentExtraction'
import type { SegmentCollectionPlan } from '../../engine/timeSegmentExtraction'

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

function propTarget(nodeId: string, property: 'positionX' = 'positionX'): KeyframeTarget {
  return { kind: 'node', nodeId, property }
}

function makeExtractable(
  target: KeyframeTarget,
  time: number,
  value: unknown = 0,
  keyframeId = `kf-${Math.random().toString(36).slice(2)}`,
): ExtractableKeyframe {
  return {
    target,
    time,
    value: value as import('../../engine/keyframe').KeyframeValue,
    interpolation: 'linear',
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
    keyframeId,
  }
}

describe('validateSegmentRange', () => {
  it('accepts a valid segment inside the slide', () => {
    expect(validateSegmentRange(1, 4, 10)).toBeNull()
  })
  it('rejects From >= To', () => {
    expect(validateSegmentRange(4, 4, 10)).toMatch(/From < To/)
    expect(validateSegmentRange(5, 4, 10)).toMatch(/From < To/)
  })
  it('rejects To beyond slide duration', () => {
    expect(validateSegmentRange(0, 11, 10)).toMatch(/slide duration/)
  })
  it('rejects negative From and non-numeric input', () => {
    expect(validateSegmentRange(-1, 4, 10)).toMatch(/≥ 0/)
    expect(validateSegmentRange(NaN, 4, 10)).toMatch(/numeric/)
  })
})

describe('defaultSegmentRange', () => {
  it('spans orphan min/max', () => {
    expect(defaultSegmentRange([3, 1, 2], 10)).toEqual({ from: 1, to: 3 })
  })
  it('expands a single-point selection', () => {
    const { from, to } = defaultSegmentRange([5], 10)
    expect(from).toBeLessThan(5)
    expect(to).toBeGreaterThan(5)
  })
  it('falls back to the slide when empty', () => {
    expect(defaultSegmentRange([], 10)).toEqual({ from: 0, to: 10 })
  })
})

describe('inSegment', () => {
  it('is inclusive on both ends', () => {
    expect(inSegment(1, 1, 4)).toBe(true)
    expect(inSegment(4, 1, 4)).toBe(true)
    expect(inSegment(2.5, 1, 4)).toBe(true)
    expect(inSegment(0.999, 1, 4)).toBe(false)
    expect(inSegment(4.001, 1, 4)).toBe(false)
  })
})

describe('naming', () => {
  it('nextClipNameForNode numbers per node', () => {
    expect(nextClipNameForNode('Hand', [])).toBe('Hand Clip 1')
    expect(nextClipNameForNode('Hand', [{ name: 'Hand Clip 1' }])).toBe('Hand Clip 2')
    // other nodes do not affect the counter
    expect(nextClipNameForNode('Hand', [{ name: 'Foot Clip 3' }])).toBe('Hand Clip 1')
  })
  it('uniqueClipName dedupes within a batch', () => {
    const taken = new Set<string>()
    expect(uniqueClipName('Hand Clip 1', taken)).toBe('Hand Clip 1')
    expect(uniqueClipName('Hand Clip 1', taken)).toBe('Hand Clip 1 2')
  })
  it('defaultSegmentCollectionName embeds the range', () => {
    expect(defaultSegmentCollectionName('Rig', 1, 4)).toBe('Rig 1.00-4.00s')
  })
})

describe('target classification', () => {
  it('stores node/visible/zIndex/morph/symmetry/circle/shadow, skips the rest', () => {
    expect(isClipStorableTarget(propTarget('n'))).toBe(true)
    expect(isClipStorableTarget({ kind: 'node', nodeId: 'n', parameter: 'tint' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'visible', nodeId: 'n' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'zIndex', nodeId: 'n' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'morph', nodeId: 'n' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'circle', nodeId: 'n', property: 'radius' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'shadow', nodeId: 'n', property: 'blur' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'symmetry', nodeId: 'n' })).toBe(true)
    expect(isClipStorableTarget({ kind: 'table', nodeId: 'n', property: 'padding' })).toBe(false)
    expect(isClipStorableTarget({ kind: 'dataLabel', nodeId: 'n', label: 'L' })).toBe(false)
  })
  it('deleteGroupKey matches one DeleteKeyframesCommand per track', () => {
    expect(deleteGroupKey(propTarget('n'))).toBe('node:n:positionX')
    expect(deleteGroupKey({ kind: 'visible', nodeId: 'n' })).toBe('visible:n')
    expect(deleteGroupKey({ kind: 'shadow', nodeId: 'n', property: 'blur' })).toBe('shadow:n:blur')
  })
})

describe('planSegmentDeletes', () => {
  const track = (id: string, time: number) => ({
    target: propTarget('n'),
    time,
    keyframeId: id,
  })
  it('deletes everything by default', () => {
    const groups = planSegmentDeletes([track('a', 1), track('b', 2), track('c', 3)], false, false)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.keyframeIds).toEqual(['a', 'b', 'c'])
  })
  it('keeps first / last / both edge keyframes globally', () => {
    const entries = [track('a', 1), track('b', 2), track('c', 3)]
    expect(planSegmentDeletes(entries, true, false)[0]!.keyframeIds).toEqual(['b', 'c'])
    expect(planSegmentDeletes(entries, false, true)[0]!.keyframeIds).toEqual(['a', 'b'])
    expect(planSegmentDeletes(entries, true, true)[0]!.keyframeIds).toEqual(['b'])
  })
  it('a single-keyframe track with both keeps deletes nothing', () => {
    expect(planSegmentDeletes([track('a', 1)], true, true)).toHaveLength(0)
  })
  it('keeps are global across tracks, not per track', () => {
    const entries = [
      { target: propTarget('n1'), time: 1, keyframeId: 'a' },
      { target: propTarget('n1'), time: 2, keyframeId: 'b' },
      { target: propTarget('n2'), time: 1, keyframeId: 'c' },
      { target: propTarget('n2'), time: 2, keyframeId: 'd' },
    ]
    const groups = planSegmentDeletes(entries, true, false)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.keyframeIds)).toEqual([['b'], ['d']])
  })
  it('spares N-1 when N keys sit on N distinct tracks (reported bug)', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      target: propTarget(`n${i}`),
      time: i + 1,
      keyframeId: `k${i}`,
    }))
    const total = (keepFirst: boolean, keepLast: boolean) =>
      planSegmentDeletes(entries, keepFirst, keepLast).reduce((n, g) => n + g.keyframeIds.length, 0)
    expect(total(false, false)).toBe(12)
    expect(total(true, false)).toBe(11)
    expect(total(false, true)).toBe(11)
    expect(total(true, true)).toBe(10)
  })
  it('spares every entry tied at a kept boundary instant', () => {
    const entries = [
      { target: propTarget('n1'), time: 1, keyframeId: 'a' },
      { target: propTarget('n2'), time: 1, keyframeId: 'b' },
      { target: propTarget('n3'), time: 2, keyframeId: 'c' },
    ]
    const firstOnly = planSegmentDeletes(entries, true, false).reduce(
      (n, g) => n + g.keyframeIds.length,
      0,
    )
    expect(firstOnly).toBe(1)
    const lastOnly = planSegmentDeletes(entries, false, true).reduce(
      (n, g) => n + g.keyframeIds.length,
      0,
    )
    expect(lastOnly).toBe(2)
  })
})

describe('clipInstanceFits', () => {
  it('requires full containment (inclusive on both ends)', async () => {
    const { clipInstanceFits } = await import('../../engine/timeSegmentExtraction')
    expect(clipInstanceFits(0, 5, 0, 5)).toBe(true)
    expect(clipInstanceFits(1, 4, 0, 5)).toBe(true)
    // touching either bound still fits
    expect(clipInstanceFits(0, 3, 0, 5)).toBe(true)
    expect(clipInstanceFits(2, 5, 0, 5)).toBe(true)
    // overhang on either side does not fit — "finishes at six, does not fit"
    expect(clipInstanceFits(0, 6, 0, 5)).toBe(false)
    expect(clipInstanceFits(-1, 5, 0, 5)).toBe(false)
    expect(clipInstanceFits(6, 7, 0, 5)).toBe(false)
  })
})

describe('executeSegmentToCollection', () => {
  function setupRig(): {
    engine: Engine
    dispatcher: CommandDispatcher
    undoStack: UndoStack
    parentId: string
    leftId: string
    rightId: string
  } {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
    const right = engine.createNode(slide.scene.id, parent.id, 'RightHand')
    engine.setSemanticName(left.id, 'left_hand')
    engine.setSemanticName(right.id, 'right_hand')
    // Left: keys at 1,2,3 — Right: keys at 2,3,4 (segment [1,4] covers all)
    for (const [nodeId, times] of [
      [left.id, [1, 2, 3]],
      [right.id, [2, 3, 4]],
    ] as const) {
      for (const t of times) {
        engine.addKeyframe(propTarget(nodeId), t, t * 10)
      }
    }
    return {
      engine,
      dispatcher,
      undoStack,
      parentId: parent.id,
      leftId: left.id,
      rightId: right.id,
    }
  }

  function extractables(engine: Engine, nodeId: string): ExtractableKeyframe[] {
    return engine.getKeyframes(nodeId, 'positionX').map((kf) => ({
      target: propTarget(nodeId),
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
  }

  function plan(
    engine: Engine,
    parentId: string,
    leftId: string,
    rightId: string,
    overrides: Partial<SegmentCollectionPlan> = {},
  ): SegmentCollectionPlan {
    return {
      parentNodeId: parentId,
      from: 1,
      to: 4,
      objects: [
        {
          nodeId: leftId,
          nodeName: 'LeftHand',
          semanticName: 'left_hand',
          clipName: 'LeftHand Clip 1',
          category: 'left_hand',
          keyframes: extractables(engine, leftId),
        },
        {
          nodeId: rightId,
          nodeName: 'RightHand',
          semanticName: 'right_hand',
          clipName: 'RightHand Clip 1',
          category: 'right_hand',
          keyframes: extractables(engine, rightId),
        },
      ],
      collectionName: 'Rig 1.00-4.00s',
      deleteOrphans: true,
      keepFirst: false,
      keepLast: false,
      ...overrides,
    }
  }

  it('creates aligned clips + collection and deletes orphans in one undo step', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupRig()
    const baselineEntries = undoStack.entries.length
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      plan(engine, parentId, leftId, rightId),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.clips).toHaveLength(2)
    expect(result.extractedCount).toBe(6)
    expect(result.deletedCount).toBe(6)
    expect(result.warnings).toHaveLength(0)

    // Both clips share the global segment duration and time base
    for (const c of result.clips) {
      const clip = engine.getClip(c.clipId)
      expect(clip.duration).toBeCloseTo(3)
      expect(clip.category).toBe(c.semanticName)
    }
    const leftClip = engine.getClip(result.clips[0]!.clipId)
    const leftTimes = leftClip.getChannelKeyframes('positionX').map((k) => k.time)
    expect(leftTimes).toHaveLength(3)
    expect(leftTimes[0]).toBeCloseTo(0) // t=1 → 0
    expect(leftTimes[1]).toBeCloseTo(1 / 3) // t=2 → 1/3
    expect(leftTimes[2]).toBeCloseTo(2 / 3) // t=3 → 2/3
    const rightClip = engine.getClip(result.clips[1]!.clipId)
    const rightTimes = rightClip.getChannelKeyframes('positionX').map((k) => k.time)
    expect(rightTimes[0]).toBeCloseTo(1 / 3) // t=2 → 1/3
    expect(rightTimes[2]).toBeCloseTo(1) // t=4 → 1

    // Collection binds semanticName → clip
    const col = engine.getClipCollection(result.collectionId)
    expect(col.name).toBe('Rig 1.00-4.00s')
    expect(col.getBinding('left_hand')).toBe(result.clips[0]!.clipId)
    expect(col.getBinding('right_hand')).toBe(result.clips[1]!.clipId)

    // Orphans deleted
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframes(rightId, 'positionX')).toHaveLength(0)

    // The whole batch (2 extracts + collection + 2 deletes) is one history entry
    expect(undoStack.entries.length).toBe(baselineEntries + 1)
    expect(undoStack.entries[0]!.type).toBe('Transaction')

    // Single undo reverts everything
    expect(dispatcher.undo()).toBe(true)
    expect(undoStack.entries.length).toBe(baselineEntries)
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(3)
    expect(engine.getKeyframes(rightId, 'positionX')).toHaveLength(3)
    expect(engine.clips).toHaveLength(0)
    expect(() => engine.getClipCollection(result.collectionId)).toThrow()
    // And redo restores the batch
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(0)
    expect(engine.clips).toHaveLength(2)
    expect(engine.getClipCollection(result.collectionId).name).toBe('Rig 1.00-4.00s')
  })

  it('keepFirst/keepLast spare the global edge orphans', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupRig()
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      plan(engine, parentId, leftId, rightId, { keepFirst: true, keepLast: true }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    // global min t=1 / max t=4 spared → middle four deleted
    expect(result.deletedCount).toBe(4)
    expect(
      engine
        .getKeyframes(leftId, 'positionX')
        .map((k) => k.time)
        .sort(),
    ).toEqual([1])
    expect(
      engine
        .getKeyframes(rightId, 'positionX')
        .map((k) => k.time)
        .sort(),
    ).toEqual([4])
    // clips still contain the full segment (edges included)
    expect(engine.getClip(result.clips[0]!.clipId).getChannelKeyframes('positionX')).toHaveLength(3)
  })

  it('deleteOrphans=false keeps all source keyframes', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupRig()
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      plan(engine, parentId, leftId, rightId, { deleteOrphans: false }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.deletedCount).toBe(0)
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(3)
  })

  it('fails when an object lacks a semantic name', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupRig()
    const p = plan(engine, parentId, leftId, rightId, {
      objects: [
        {
          nodeId: leftId,
          nodeName: 'LeftHand',
          semanticName: '   ',
          clipName: 'LeftHand Clip 1',
          category: 'left_hand',
          keyframes: extractables(engine, leftId),
        },
        {
          nodeId: rightId,
          nodeName: 'RightHand',
          semanticName: 'right_hand',
          clipName: 'RightHand Clip 1',
          category: 'right_hand',
          keyframes: extractables(engine, rightId),
        },
      ],
    })
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      p,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toMatch(/Semantic Name/)
    // nothing mutated
    expect(engine.clips).toHaveLength(0)
  })

  it('warns on duplicate semantic names (last wins) and skips non-storable tracks', () => {
    const { engine, dispatcher, undoStack, parentId, leftId, rightId } = setupRig()
    // Synthetic table keyframe (non-storable): not in the engine, so skip deletion here
    const tableKf = makeExtractable(
      { kind: 'table', nodeId: leftId, property: 'padding' } as unknown as KeyframeTarget,
      2,
      4,
      'synthetic-table-kf',
    )
    const p = plan(engine, parentId, leftId, rightId, {
      deleteOrphans: false,
      objects: [
        {
          nodeId: leftId,
          nodeName: 'LeftHand',
          semanticName: 'hand',
          clipName: 'A',
          category: 'hand',
          keyframes: [...extractables(engine, leftId), tableKf],
        },
        {
          nodeId: rightId,
          nodeName: 'RightHand',
          semanticName: 'hand',
          clipName: 'B',
          category: 'hand',
          keyframes: extractables(engine, rightId),
        },
      ],
    })
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      p,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.skippedCount).toBe(1)
    expect(result.skippedKinds).toEqual(['table'])
    expect(result.warnings.some((w) => w.includes('Duplicate semantic name'))).toBe(true)
    const col = engine.getClipCollection(result.collectionId)
    // last binding wins
    expect(col.getBinding('hand')).toBe(result.clips[1]!.clipId)
  })

  it('fails when nothing is clip-storable', () => {
    const { engine, dispatcher, undoStack, parentId, leftId } = setupRig()
    const tableKf = makeExtractable(
      { kind: 'table', nodeId: leftId, property: 'padding' } as unknown as KeyframeTarget,
      2,
      4,
    )
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parentId,
        from: 1,
        to: 4,
        objects: [
          {
            nodeId: leftId,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'A',
            category: 'left_hand',
            keyframes: [tableKf],
          },
        ],
        collectionName: 'Rig',
        deleteOrphans: false,
        keepFirst: false,
        keepLast: false,
      },
    )
    expect(result.ok).toBe(false)
  })

  describe('executeSegmentToCollection with clips', () => {
    function setupRigWithClip(): {
      engine: Engine
      dispatcher: CommandDispatcher
      undoStack: UndoStack
      parentId: string
      leftId: string
      rightId: string
      clipId: string
      instanceId: string
    } {
      const { engine, dispatcher, undoStack } = setupEngine()
      const slide = engine.getActiveSlide()!
      const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
      const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
      const right = engine.createNode(slide.scene.id, parent.id, 'RightHand')
      engine.setSemanticName(left.id, 'left_hand')
      engine.setSemanticName(right.id, 'right_hand')
      for (const t of [1, 2, 3]) {
        engine.addKeyframe({ kind: 'node', nodeId: left.id, property: 'positionX' }, t, t * 10)
      }
      const clip = engine.createClip('Wave', 2, 'gestures', [], [])
      // instance [1,3] sits fully inside segment [1,4]
      const instance = engine.assignClipInstance(right.id, clip.id, 1, 1, true, {})
      return {
        engine,
        dispatcher,
        undoStack,
        parentId: parent.id,
        leftId: left.id,
        rightId: right.id,
        clipId: clip.id,
        instanceId: instance.id,
      }
    }

    function orphanExtractables(engine: Engine, nodeId: string): ExtractableKeyframe[] {
      return engine.getKeyframes(nodeId, 'positionX').map((kf) => ({
        target: { kind: 'node', nodeId, property: 'positionX' } as const,
        time: kf.time,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: kf.tangentIn,
        tangentOut: kf.tangentOut,
        keyframeId: kf.id,
      }))
    }

    it('reuses a contained clip as-is and still mints clips for orphan objects', () => {
      const { engine, dispatcher, undoStack, parentId, leftId, rightId, clipId, instanceId } =
        setupRigWithClip()
      const baseline = undoStack.entries.length
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        {
          parentNodeId: parentId,
          from: 1,
          to: 4,
          objects: [
            {
              nodeId: leftId,
              nodeName: 'LeftHand',
              semanticName: 'left_hand',
              clipName: 'LeftHand Clip 1',
              category: 'left_hand',
              keyframes: orphanExtractables(engine, leftId),
            },
            {
              nodeId: rightId,
              nodeName: 'RightHand',
              semanticName: 'right_hand',
              clipName: 'unused',
              category: 'right_hand',
              keyframes: [],
              clips: [
                {
                  nodeId: rightId,
                  instanceId,
                  clipId,
                  clipName: 'Wave',
                  start: 1,
                  end: 3,
                },
              ],
            },
          ],
          collectionName: 'Rig 1.00-4.00s',
          deleteOrphans: true,
          keepFirst: false,
          keepLast: false,
          removeClipInstances: false,
        },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      // one minted clip (left), one reused (right)
      expect(result.clips).toHaveLength(1)
      expect(result.reused).toHaveLength(1)
      expect(result.reused[0]).toMatchObject({ semanticName: 'right_hand', clipId })
      // one minted clip (left) plus the pre-existing Wave clip (right, reused)
      expect(engine.clips).toHaveLength(2)
      const col = engine.getClipCollection(result.collectionId)
      expect(col.getBinding('left_hand')).toBe(result.clips[0]!.clipId)
      expect(col.getBinding('right_hand')).toBe(clipId)
      // orphans deleted, instance kept (removal off)
      expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(0)
      expect(engine.getNode(rightId).clipInstances).toHaveLength(1)
      // still one undo step
      expect(undoStack.entries.length).toBe(baseline + 1)
      expect(dispatcher.undo()).toBe(true)
      expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(3)
      expect(() => engine.getClipCollection(result.collectionId)).toThrow()
    })

    it('removes included placements when requested, keeping library clips', () => {
      const { engine, dispatcher, undoStack, parentId, rightId, clipId, instanceId } =
        setupRigWithClip()
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        {
          parentNodeId: parentId,
          from: 1,
          to: 4,
          objects: [
            {
              nodeId: rightId,
              nodeName: 'RightHand',
              semanticName: 'right_hand',
              clipName: 'unused',
              category: 'right_hand',
              keyframes: [],
              clips: [{ nodeId: rightId, instanceId, clipId, clipName: 'Wave', start: 1, end: 3 }],
            },
          ],
          collectionName: 'C',
          deleteOrphans: false,
          keepFirst: false,
          keepLast: false,
          removeClipInstances: true,
        },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(result.removedInstanceCount).toBe(1)
      expect(engine.getNode(rightId).clipInstances).toHaveLength(0)
      // library clip survives and is bound
      expect(engine.getClip(clipId).name).toBe('Wave')
      expect(engine.getClipCollection(result.collectionId).getBinding('right_hand')).toBe(clipId)
      // undo restores the placement
      expect(dispatcher.undo()).toBe(true)
      expect(engine.getNode(rightId).clipInstances).toHaveLength(1)
      expect(dispatcher.redo()).toBe(true)
      expect(engine.getNode(rightId).clipInstances).toHaveLength(0)
    })

    it('fails when an object selects both keyframes and a clip', () => {
      const { engine, dispatcher, undoStack, parentId, rightId, clipId, instanceId } =
        setupRigWithClip()
      for (const t of [2, 3]) {
        engine.addKeyframe({ kind: 'node', nodeId: rightId, property: 'positionX' }, t, t)
      }
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        {
          parentNodeId: parentId,
          from: 1,
          to: 4,
          objects: [
            {
              nodeId: rightId,
              nodeName: 'RightHand',
              semanticName: 'right_hand',
              clipName: 'RightHand Clip 1',
              category: 'right_hand',
              keyframes: orphanExtractables(engine, rightId),
              clips: [{ nodeId: rightId, instanceId, clipId, clipName: 'Wave', start: 1, end: 3 }],
            },
          ],
          collectionName: 'C',
          deleteOrphans: false,
          keepFirst: false,
          keepLast: false,
        },
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.error).toMatch(/both keyframes and a clip/)
      expect(engine.clips).toHaveLength(1) // only the pre-existing Wave clip; nothing minted
    })

    it('first clip wins with a warning when several are selected on one object', () => {
      const { engine, dispatcher, undoStack, parentId, rightId, clipId, instanceId } =
        setupRigWithClip()
      const clip2 = engine.createClip('Nod', 1, 'gestures', [], [])
      const inst2 = engine.assignClipInstance(rightId, clip2.id, 3, 1, true, {}) // [3,4] fits
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        {
          parentNodeId: parentId,
          from: 1,
          to: 4,
          objects: [
            {
              nodeId: rightId,
              nodeName: 'RightHand',
              semanticName: 'right_hand',
              clipName: 'unused',
              category: 'right_hand',
              keyframes: [],
              clips: [
                {
                  nodeId: rightId,
                  instanceId: inst2.id,
                  clipId: clip2.id,
                  clipName: 'Nod',
                  start: 3,
                  end: 4,
                },
                { nodeId: rightId, instanceId, clipId, clipName: 'Wave', start: 1, end: 3 },
              ],
            },
          ],
          collectionName: 'C',
          deleteOrphans: false,
          keepFirst: false,
          keepLast: false,
        },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(engine.getClipCollection(result.collectionId).getBinding('right_hand')).toBe(clip2.id)
      expect(result.warnings.some((w) => w.includes('2 clips selected'))).toBe(true)
    })

    it('fails when a clip-only object lacks a semantic name', () => {
      const { engine, dispatcher, undoStack, parentId, rightId, clipId, instanceId } =
        setupRigWithClip()
      engine.setSemanticName(rightId, undefined)
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        {
          parentNodeId: parentId,
          from: 1,
          to: 4,
          objects: [
            {
              nodeId: rightId,
              nodeName: 'RightHand',
              semanticName: '',
              clipName: 'unused',
              category: '',
              keyframes: [],
              clips: [{ nodeId: rightId, instanceId, clipId, clipName: 'Wave', start: 1, end: 3 }],
            },
          ],
          collectionName: 'C',
          deleteOrphans: false,
          keepFirst: false,
          keepLast: false,
        },
      )
      expect(result.ok).toBe(false)
    })
  })

  it('ExtractToClipCommand range mode normalizes against the segment', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe(propTarget(node.id), 2, 10)
    engine.addKeyframe(propTarget(node.id), 3, 20)
    const kfs = engine.getKeyframes(node.id, 'positionX').map((kf) => ({
      target: propTarget(node.id),
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: kfs,
        name: 'Seg',
        duration: 3,
        category: 'c',
        rangeStart: 1,
        rangeEnd: 4,
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    expect(clip.duration).toBeCloseTo(3)
    const times = clip.getChannelKeyframes('positionX').map((k) => k.time)
    expect(times[0]).toBeCloseTo(1 / 3)
    expect(times[1]).toBeCloseTo(2 / 3)
  })
})

describe('baking endpoints', () => {
  it('collectBakingKeyframes anchors synthetics at the requested end', () => {
    const evaluator = {
      getNode: () =>
        ({ components: {}, children: [] }) as unknown as import('../../engine/sceneNode').SceneNode,
      evaluateNode: () => ({
        transform: { x: 5, y: 6, rotation: 7, scaleX: 1, scaleY: 1 },
        opacity: 0.5,
      }),
      evaluateCircle: () => null,
      evaluateTable: () => null,
      evaluateShadow: () => null,
      evaluateSymmetry: () => null,
    }
    const bounds = { selStart: 1, selEnd: 4, selDuration: 3, clipDuration: 3 }
    const selected = [makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 2, 10)]
    const start = collectBakingKeyframes(bounds, selected, evaluator, 'start')
    expect(start.length).toBeGreaterThan(0)
    expect(start.every((kf) => kf.time === 1)).toBe(true)
    expect(start.every((kf) => kf.keyframeId.startsWith('bake:'))).toBe(true)
    const end = collectBakingKeyframes(bounds, selected, evaluator, 'end')
    expect(end.length).toBe(start.length)
    expect(end.every((kf) => kf.time === 4)).toBe(true)
    expect(end.every((kf) => kf.keyframeId.startsWith('bake-end:'))).toBe(true)
    // positionX is present in the selection → never baked
    expect(
      start.some(
        (kf) =>
          kf.target.kind === 'node' &&
          'property' in kf.target &&
          kf.target.property === 'positionX',
      ),
    ).toBe(false)
  })

  it('ExtractToClipCommand bakeEndingPose pins t=1 to the end pose', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe(propTarget(node.id), 2, 10)
    engine.addKeyframe(propTarget(node.id), 3, 20)
    const kfs = engine.getKeyframes(node.id, 'positionX').map((kf) => ({
      target: propTarget(node.id),
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: kfs,
        name: 'Baked',
        duration: 3,
        category: 'c',
        rangeStart: 1,
        rangeEnd: 4,
        bakeEndingPose: true,
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    // positionY was missing → baked at t=1 with the pose evaluated at To=4
    const baked = clip.getChannelKeyframes('positionY')
    expect(baked).toHaveLength(1)
    expect(baked[0]!.time).toBeCloseTo(1)
    // no start baking requested → nothing at t=0 for positionY
    expect(baked[0]!.time).not.toBeCloseTo(0)
  })

  it('both anchors pin a missing channel at t=0 and t=1', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe(propTarget(node.id), 2, 10)
    engine.addKeyframe(propTarget(node.id), 3, 20)
    const kfs = engine.getKeyframes(node.id, 'positionX').map((kf) => ({
      target: propTarget(node.id),
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: kfs,
        name: 'BakedBoth',
        duration: 3,
        category: 'c',
        rangeStart: 1,
        rangeEnd: 4,
        bakeStartingPose: true,
        bakeEndingPose: true,
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    const baked = clip.getChannelKeyframes('positionY')
    expect(baked.map((k) => k.time)).toEqual([0, 1])
  })

  it('extracts symmetry keyframes into the clip', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh')
    engine.addKeyframe({ kind: 'symmetry', nodeId: node.id }, 2, {
      axis: 'x',
      factor: 0,
    } as never)
    engine.addKeyframe({ kind: 'symmetry', nodeId: node.id }, 3, {
      axis: 'x',
      factor: 1,
    } as never)
    const kfs = engine.getKeyframesOf({ kind: 'symmetry', nodeId: node.id }).map((kf) => ({
      target: { kind: 'symmetry', nodeId: node.id } as KeyframeTarget,
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: kfs,
        name: 'SymClip',
        duration: 3,
        category: 'c',
        rangeStart: 1,
        rangeEnd: 4,
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    const sym = clip.getSymmetryKeyframes()
    expect(sym).toHaveLength(2)
    expect(sym.map((k) => k.time)).toEqual([1 / 3, 2 / 3])
    expect((sym[1]!.value as unknown as { factor: number }).factor).toBe(1)
  })

  it('bakes symmetry at the anchor when the channel is missing', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh')
    engine.addKeyframe({ kind: 'symmetry', nodeId: node.id }, 4, {
      axis: 'y',
      factor: 0.5,
    } as never)
    engine.addKeyframe(propTarget(node.id), 2, 10)
    engine.addKeyframe(propTarget(node.id), 3, 20)
    const kfs = engine.getKeyframes(node.id, 'positionX').map((kf) => ({
      target: propTarget(node.id),
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: kfs,
        name: 'SymBaked',
        duration: 3,
        category: 'c',
        rangeStart: 1,
        rangeEnd: 4,
        bakeStartingPose: true,
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    const sym = clip.getSymmetryKeyframes()
    expect(sym).toHaveLength(1)
    expect(sym[0]!.time).toBeCloseTo(0)
    expect((sym[0]!.value as unknown as { axis: string }).axis).toBe('y')
  })

  it('segment executor passes bake flags through in one undo step', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
    engine.setSemanticName(left.id, 'left_hand')
    engine.addKeyframe(propTarget(left.id), 2, 10)
    engine.addKeyframe(propTarget(left.id), 3, 20)
    const baseline = undoStack.entries.length
    const kfs = engine.getKeyframes(left.id, 'positionX').map((kf) => ({
      target: propTarget(left.id),
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
            keyframes: kfs,
          },
        ],
        collectionName: 'Rig 1.00-4.00s',
        deleteOrphans: false,
        keepFirst: false,
        keepLast: false,
        bakeStart: true,
        bakeEnd: true,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const clip = engine.getClip(result.clips[0]!.clipId)
    // baked endpoints present alongside the extracted channel
    expect(clip.getChannelKeyframes('positionX')).toHaveLength(2)
    expect(clip.getChannelKeyframes('positionY').map((k) => k.time)).toEqual([0, 1])
    expect(undoStack.entries.length).toBe(baseline + 1)
    expect(dispatcher.undo()).toBe(true)
    expect(engine.clips).toHaveLength(0)
  })

  describe('bake-only static objects (depth slider)', () => {
    function setupRigWithStatic(): {
      engine: Engine
      dispatcher: CommandDispatcher
      undoStack: UndoStack
      parentId: string
      leftId: string
      staticId: string
    } {
      const { engine, dispatcher, undoStack } = setupEngine()
      const slide = engine.getActiveSlide()!
      const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
      const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
      engine.setSemanticName(left.id, 'left_hand')
      engine.addKeyframe(propTarget(left.id), 2, 10)
      const prop = engine.createNode(slide.scene.id, parent.id, 'Prop')
      engine.setSemanticName(prop.id, 'prop')
      return {
        engine,
        dispatcher,
        undoStack,
        parentId: parent.id,
        leftId: left.id,
        staticId: prop.id,
      }
    }

    function bakeOnlyPlan(
      parentId: string,
      leftId: string,
      staticId: string,
      engine: Engine,
      overrides: Partial<SegmentCollectionPlan> = {},
    ): SegmentCollectionPlan {
      const kfs = engine.getKeyframes(leftId, 'positionX').map((kf) => ({
        target: propTarget(leftId),
        time: kf.time,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: kf.tangentIn,
        tangentOut: kf.tangentOut,
        keyframeId: kf.id,
      }))
      return {
        parentNodeId: parentId,
        from: 1,
        to: 4,
        objects: [
          {
            nodeId: leftId,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'LeftHand Clip 1',
            category: 'left_hand',
            keyframes: kfs,
          },
          {
            nodeId: staticId,
            nodeName: 'Prop',
            semanticName: 'prop',
            clipName: 'Prop Clip 1',
            category: 'prop',
            keyframes: [],
          },
        ],
        collectionName: 'Rig 1.00-4.00s',
        deleteOrphans: false,
        keepFirst: false,
        keepLast: false,
        bakeStart: true,
        bakeDepth: 1,
        ...overrides,
      }
    }

    it('mints a bake-only clip pinned at t=0 for a keyframe-less descendant', () => {
      const { engine, dispatcher, undoStack, parentId, leftId, staticId } = setupRigWithStatic()
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        bakeOnlyPlan(parentId, leftId, staticId, engine),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(`expected ok: ${result.error}`)
      expect(result.clips).toHaveLength(2)
      const baked = result.clips.find((c) => c.nodeId === staticId)!
      const clip = engine.getClip(baked.clipId)
      // start anchor only → one keyframe per bakable channel at t=0
      expect(clip.getChannelKeyframes('positionX').map((k) => k.time)).toEqual([0])
      expect(clip.getChannelKeyframes('positionY')).toHaveLength(1)
      const col = engine.getClipCollection(result.collectionId)
      expect(col.getBinding('prop')).toBe(baked.clipId)
    })

    it('pins only the checked anchor (bakeEnd only → t=1 keys)', () => {
      const { engine, dispatcher, undoStack, parentId, leftId, staticId } = setupRigWithStatic()
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        bakeOnlyPlan(parentId, leftId, staticId, engine, { bakeStart: false, bakeEnd: true }),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(`expected ok: ${result.error}`)
      const baked = result.clips.find((c) => c.nodeId === staticId)!
      const clip = engine.getClip(baked.clipId)
      expect(clip.getChannelKeyframes('positionX').map((k) => k.time)).toEqual([1])
    })

    it('skips bake-only objects with a warning when baking is off', () => {
      const { engine, dispatcher, undoStack, parentId, leftId, staticId } = setupRigWithStatic()
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        bakeOnlyPlan(parentId, leftId, staticId, engine, { bakeStart: false, bakeEnd: false }),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      // static object skipped, keyframed object still minted
      expect(result.clips).toHaveLength(1)
      expect(result.clips[0]!.nodeId).toBe(leftId)
      expect(result.warnings.some((w) => w.includes('Prop'))).toBe(true)
    })

    it('fails the batch when a bake-only object has no semantic name', () => {
      const { engine, dispatcher, undoStack, parentId, leftId, staticId } = setupRigWithStatic()
      engine.setSemanticName(staticId, undefined)
      const base = bakeOnlyPlan(parentId, leftId, staticId, engine)
      const result = executeSegmentToCollection(
        engine,
        dispatcher.dispatch.bind(dispatcher),
        undoStack,
        {
          ...base,
          objects: base.objects.map((o) =>
            o.nodeId === staticId ? { ...o, semanticName: '   ' } : o,
          ),
        },
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.error).toMatch(/Semantic Name/)
    })
  })

  describe('collectBakingKeyframesForNode', () => {
    it('bakes the full uniform-six set for a node with no keyframes', () => {
      const { engine } = setupEngine()
      const slide = engine.getActiveSlide()!
      const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Prop')
      const evaluator = {
        getNode: (id: string) => engine.getNode(id),
        evaluateNode: (id: string, time: number) => engine.evaluateNode(id, time),
        evaluateCircle: (id: string, time: number) => engine.evaluateCircle(id, time),
        evaluateTable: (id: string, time: number) => engine.evaluateTable(id, time),
        evaluateShadow: (id: string, time: number) => engine.evaluateShadow(id, time),
        evaluateSymmetry: (id: string, time: number) => engine.evaluateSymmetry(id, time),
      }
      const bounds = { selStart: 1, selEnd: 4, selDuration: 3, clipDuration: 3 }
      const out = collectBakingKeyframesForNode(bounds, node.id, evaluator, 'start')
      expect(out).toHaveLength(6)
      expect(out.every((kf) => kf.time === 1)).toBe(true)
    })

    it('returns [] for an unknown node', () => {
      const { engine } = setupEngine()
      const evaluator = {
        getNode: (id: string) => engine.getNode(id),
        evaluateNode: (id: string, time: number) => engine.evaluateNode(id, time),
        evaluateCircle: (id: string, time: number) => engine.evaluateCircle(id, time),
        evaluateTable: (id: string, time: number) => engine.evaluateTable(id, time),
        evaluateShadow: (id: string, time: number) => engine.evaluateShadow(id, time),
        evaluateSymmetry: (id: string, time: number) => engine.evaluateSymmetry(id, time),
      }
      const bounds = { selStart: 1, selEnd: 4, selDuration: 3, clipDuration: 3 }
      expect(collectBakingKeyframesForNode(bounds, 'missing', evaluator, 'start')).toEqual([])
    })
  })
})

describe('dedupeClipNames', () => {
  it('keeps duplicate names exact when disabled', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const mk = (name: string, sem: string, time: number) => {
      const n = engine.createNode(slide.scene.id, parent.id, name)
      engine.setSemanticName(n.id, sem)
      engine.addKeyframe({ kind: 'node', nodeId: n.id, property: 'positionX' }, time, time)
      engine.addKeyframe({ kind: 'node', nodeId: n.id, property: 'positionX' }, time + 1, time)
      const kfs = engine.getKeyframes(n.id, 'positionX').map((kf) => ({
        target: { kind: 'node', nodeId: n.id, property: 'positionX' } as const,
        time: kf.time,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: kf.tangentIn,
        tangentOut: kf.tangentOut,
        keyframeId: kf.id,
      }))
      return {
        nodeId: n.id,
        nodeName: name,
        semanticName: sem,
        clipName: 'Walk',
        category: sem,
        keyframes: kfs,
      }
    }
    const plan = {
      parentNodeId: parent.id,
      from: 1,
      to: 4,
      objects: [mk('LeftHand', 'left_hand', 1), mk('RightHand', 'right_hand', 2)],
      collectionName: 'Walk',
      deleteOrphans: false,
      keepFirst: false,
      keepLast: false,
      dedupeClipNames: false,
    }
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      plan,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.clips.map((c) => c.clipName)).toEqual(['Walk', 'Walk'])
  })

  it('uniquifies colliding names by default', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const mk = (name: string, sem: string, time: number) => {
      const n = engine.createNode(slide.scene.id, parent.id, name)
      engine.setSemanticName(n.id, sem)
      engine.addKeyframe({ kind: 'node', nodeId: n.id, property: 'positionX' }, time, time)
      engine.addKeyframe({ kind: 'node', nodeId: n.id, property: 'positionX' }, time + 1, time)
      const kfs = engine.getKeyframes(n.id, 'positionX').map((kf) => ({
        target: { kind: 'node', nodeId: n.id, property: 'positionX' } as const,
        time: kf.time,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: kf.tangentIn,
        tangentOut: kf.tangentOut,
        keyframeId: kf.id,
      }))
      return {
        nodeId: n.id,
        nodeName: name,
        semanticName: sem,
        clipName: 'Walk',
        category: sem,
        keyframes: kfs,
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
        objects: [mk('LeftHand', 'left_hand', 1), mk('RightHand', 'right_hand', 2)],
        collectionName: 'Walk',
        deleteOrphans: false,
        keepFirst: false,
        keepLast: false,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.clips.map((c) => c.clipName)).toEqual(['Walk', 'Walk 2'])
  })
})

describe('keepLast alone through the executor', () => {
  it('deletes all but the globally latest keyframes', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const arm = engine.createNode(slide.scene.id, parent.id, 'Arm')
    engine.setSemanticName(arm.id, 'arm')
    // two params, three keys each inside [1,4]
    for (const prop of ['positionX', 'positionY'] as const) {
      for (const t of [1, 2, 3]) {
        engine.addKeyframe({ kind: 'node', nodeId: arm.id, property: prop }, t, t * 10)
      }
    }
    const mk = (prop: 'positionX' | 'positionY') =>
      engine.getKeyframes(arm.id, prop).map((kf) => ({
        target: { kind: 'node', nodeId: arm.id, property: prop } as const,
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
            nodeId: arm.id,
            nodeName: 'Arm',
            semanticName: 'arm',
            clipName: 'Arm Clip 1',
            category: 'arm',
            keyframes: [...mk('positionX'), ...mk('positionY')],
          },
        ],
        collectionName: 'Rig 1.00-4.00s',
        deleteOrphans: true,
        keepFirst: false,
        keepLast: true,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    // 4 deleted (t=1,2 on both params), 2 kept (t=3 on both)
    expect(result.deletedCount).toBe(4)
    expect(engine.getKeyframes(arm.id, 'positionX').map((k) => k.time)).toEqual([3])
    expect(engine.getKeyframes(arm.id, 'positionY').map((k) => k.time)).toEqual([3])
    // minted clip still holds the full segment content
    expect(engine.getClip(result.clips[0]!.clipId).getChannelKeyframes('positionX')).toHaveLength(3)
  })
})

describe('keepLast with realistic mixed tracks', () => {
  it('deletes all but the globally latest keyframe across kinds', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const body = engine.createNode(slide.scene.id, parent.id, 'Body')
    engine.setSemanticName(body.id, 'body')
    // bezier positionX at fractional times
    for (const t of [0.5, 2.25, 4.75]) {
      engine.addKeyframe({ kind: 'node', nodeId: body.id, property: 'positionX' }, t, t)
    }
    for (const kf of engine.getKeyframes(body.id, 'positionX')) {
      engine.setKeyframeInterpolation(
        { kind: 'node', nodeId: body.id, property: 'positionX' },
        kf.id,
        'bezier',
      )
    }
    engine.addKeyframe({ kind: 'node', nodeId: body.id, property: 'opacity' }, 1, 0.2)
    engine.addKeyframe({ kind: 'node', nodeId: body.id, property: 'opacity' }, 3, 0.8)
    engine.addKeyframe({ kind: 'visible', nodeId: body.id }, 0, true)
    engine.addKeyframe({ kind: 'visible', nodeId: body.id }, 4, true)
    engine.addKeyframe({ kind: 'zIndex', nodeId: body.id }, 1, 2)
    engine.addKeyframe({ kind: 'zIndex', nodeId: body.id }, 2, 5)
    const collect = (target: import('../../engine/keyframeTarget').KeyframeTarget) =>
      engine.getKeyframesOf(target).map((kf) => ({
        target,
        time: kf.time,
        value: kf.value,
        interpolation: kf.interpolation,
        tangentIn: kf.tangentIn,
        tangentOut: kf.tangentOut,
        keyframeId: kf.id,
      }))
    const kfs = [
      ...collect({ kind: 'node', nodeId: body.id, property: 'positionX' }),
      ...collect({ kind: 'node', nodeId: body.id, property: 'opacity' }),
      ...collect({ kind: 'visible', nodeId: body.id }),
      ...collect({ kind: 'zIndex', nodeId: body.id }),
    ]
    const result = executeSegmentToCollection(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parent.id,
        from: 0,
        to: 5,
        objects: [
          {
            nodeId: body.id,
            nodeName: 'Body',
            semanticName: 'body',
            clipName: 'Body Clip 1',
            category: 'body',
            keyframes: kfs,
          },
        ],
        collectionName: 'Rig 0.00-5.00s',
        deleteOrphans: true,
        keepFirst: false,
        keepLast: true,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`expected ok: ${result.error}`)
    // 9 selected, global max t=4.75 kept → 8 deleted
    expect(result.deletedCount).toBe(8)
    expect(engine.getKeyframes(body.id, 'positionX').map((k) => k.time)).toEqual([4.75])
    expect(engine.getKeyframes(body.id, 'opacity').map((k) => k.time)).toEqual([])
    expect(engine.getKeyframesOf({ kind: 'visible', nodeId: body.id }).map((k) => k.time)).toEqual(
      [],
    )
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: body.id }).map((k) => k.time)).toEqual(
      [],
    )
  })
})
