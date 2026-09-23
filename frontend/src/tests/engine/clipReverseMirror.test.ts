import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  ReverseMirrorCollectionCommand,
} from '../../engine/commands'
import { ClipDefinition, newClipId } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId, ZERO_TANGENT } from '../../engine/keyframe'
import { createReversedClipDefinition } from '../../engine/clipReverse'
import {
  createReverseMirroredClipDefinition,
  reverseMirrorClipDefaultName,
  reverseMirrorCollectionDefaultName,
} from '../../engine/clipReverseMirror'

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

function kf(time: number, value: number | boolean): KeyframeModel {
  return new KeyframeModel(
    newKeyframeId(),
    time,
    value as never,
    'hold',
    { ...ZERO_TANGENT },
    { ...ZERO_TANGENT },
  )
}

function linearKf(time: number, value: number): KeyframeModel {
  return new KeyframeModel(
    newKeyframeId(),
    time,
    value,
    'linear',
    { ...ZERO_TANGENT },
    { ...ZERO_TANGENT },
  )
}

describe('hold-correct clip reverse (zIndex/visible)', () => {
  function zClip(keys: [number, number][]): ClipDefinition {
    const clip = new ClipDefinition(newClipId(), 'Zed', 2, 'test', [], [])
    for (const [t, v] of keys) clip.addZIndexKeyframe(kf(t, v))
    return clip
  }

  it('reverses a 3-key zIndex track so hold segments play back in reverse order', () => {
    const rev = createReversedClipDefinition(
      zClip([
        [0, 1],
        [0.5, 2],
        [1, 3],
      ]),
      'Zed Reversed',
    )
    // Source holds 1 on [0,.5), 2 on [.5,1), 3 at 1. Reversed must hold 2 on
    // [0,.5) then 1 — the naive t'=1-t mirror would wrongly hold 3 then 2.
    // (The leading single instant of 3 at exactly u=0 is not representable
    // with forward-hold keys and is documented as an approximation.)
    expect(rev.getZIndexKeyframes().map((k) => [k.time, k.value])).toEqual([
      [0, 2],
      [0.5, 1],
    ])
  })

  it('reverses a non-spanning 2-key zIndex track exactly', () => {
    const rev = createReversedClipDefinition(
      zClip([
        [0, 1],
        [0.8, 2],
      ]),
      'Zed Reversed',
    )
    expect(rev.getZIndexKeyframes().map((k) => [k.time, k.value])).toEqual([
      [0, 2],
      [0.2, 1],
    ])
  })

  it('reverses a single-key zIndex track to a single key at 0', () => {
    const rev = createReversedClipDefinition(zClip([[0.5, 7]]), 'Zed Reversed')
    expect(rev.getZIndexKeyframes().map((k) => [k.time, k.value])).toEqual([[0, 7]])
  })

  it('reverses the visible track with the same hold rule', () => {
    const clip = new ClipDefinition(newClipId(), 'Vis', 2, 'test', [], [])
    clip.addVisibleKeyframe(kf(0, true))
    clip.addVisibleKeyframe(kf(0.8, false))
    const rev = createReversedClipDefinition(clip, 'Vis Reversed')
    expect(rev.getVisibleKeyframes().map((k) => [k.time, k.value])).toEqual([
      [0, false],
      [0.2, true],
    ])
  })

  it('plays the reversed zIndex track back in reverse order end-to-end', () => {
    const { engine } = setupEngine()
    const clip = new ClipDefinition(newClipId(), 'Zed', 2, 'test', [], [])
    clip.addZIndexKeyframe(kf(0, 1))
    clip.addZIndexKeyframe(kf(0.8, 2))
    engine.importClip(clip)
    const rev = createReversedClipDefinition(clip, 'Zed Reversed')
    engine.importClip(rev)
    const col = engine.createClipCollection('ZedCol', { box: rev.id })
    const slide = engine.getActiveSlide()!
    const root = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const box = engine.createNode(slide.scene.id, root.id, 'Box', { semanticName: 'box' })
    engine.applyClipCollection(col.id, root.id)
    // clip duration 2, instance starts at 0: u = time / 2
    // source holds 1 on [0,.8) then 2; reversed must hold 2 on [0,.2) then 1
    expect(engine.evaluateZIndex(box.id, 0.1)).toBe(2)
    expect(engine.evaluateZIndex(box.id, 1.0)).toBe(1)
    expect(engine.evaluateZIndex(box.id, 1.9)).toBe(1)
  })
})

describe('reverseMirror naming', () => {
  it('defaults to "<original> Reversed Mirrored (X/Y)"', () => {
    expect(reverseMirrorClipDefaultName('Walk', 'X')).toBe('Walk Reversed Mirrored (X)')
    expect(reverseMirrorClipDefaultName('Walk', 'Y')).toBe('Walk Reversed Mirrored (Y)')
    expect(reverseMirrorCollectionDefaultName('Walk', 'X')).toBe('Walk Reversed Mirrored (X)')
  })
})

describe('createReverseMirroredClipDefinition', () => {
  function waveClip(): ClipDefinition {
    const src = new ClipDefinition(
      newClipId(),
      'Wave',
      2,
      'gesture',
      [],
      [{ property: 'positionX' }, { property: 'rotation' }],
    )
    src.addChannelKeyframe('positionX', linearKf(0, 10))
    src.addChannelKeyframe('positionX', linearKf(1, 30))
    src.addChannelKeyframe('rotation', linearKf(0, 90))
    return src
  }

  it('reverses time and mirrors space in one pass', () => {
    const { clip } = createReverseMirroredClipDefinition(waveClip(), 'X')
    expect(clip.name).toBe('Wave Reversed Mirrored (X)')
    expect(clip.isReversed).toBe(true)
    expect(clip.getChannelKeyframes('positionX').map((k) => [k.time, k.value])).toEqual([
      [0, -30],
      [1, -10],
    ])
    expect(clip.getChannelKeyframes('rotation').map((k) => [k.time, k.value])).toEqual([[1, -90]])
  })

  it('writes the symmetry bracket: factor 1 hold at start, 0 at end', () => {
    const { clip } = createReverseMirroredClipDefinition(waveClip(), 'X')
    const keys = clip.getSymmetryKeyframes()
    expect(keys.length).toBe(2)
    expect(keys[0]!.time).toBe(0)
    expect(keys[0]!.value).toEqual({ axis: 'x', factor: 1 })
    expect(keys[0]!.interpolation).toBe('hold')
    expect(keys[1]!.time).toBe(1)
    expect(keys[1]!.value).toEqual({ axis: 'x', factor: 0 })
    expect(keys[1]!.interpolation).toBe('hold')
  })

  it('uses the Y axis for the bracket on Y mirror', () => {
    const { clip } = createReverseMirroredClipDefinition(waveClip(), 'Y')
    expect(clip.getSymmetryKeyframes().map((k) => k.value)).toEqual([
      { axis: 'y', factor: 1 },
      { axis: 'y', factor: 0 },
    ])
  })

  it('reverse-mirrors the zIndex lane with the hold rule', () => {
    const src = waveClip()
    src.addZIndexKeyframe(kf(0, 1))
    src.addZIndexKeyframe(kf(0.8, 2))
    const { clip } = createReverseMirroredClipDefinition(src, 'X')
    expect(clip.getZIndexKeyframes().map((k) => [k.time, k.value])).toEqual([
      [0, 2],
      [0.2, 1],
    ])
  })
})

describe('createReverseMirroredCollection', () => {
  function motionClip(value: number): ClipDefinition {
    const clip = new ClipDefinition(
      newClipId(),
      `Motion${value}`,
      2,
      'gesture',
      [],
      [{ property: 'positionX' }],
    )
    clip.addChannelKeyframe('positionX', linearKf(0, value))
    clip.addChannelKeyframe('positionX', linearKf(1, value + 20))
    return clip
  }

  it('keeps bindings on their original sides, mirrors values, and brackets symmetry', () => {
    const { engine } = setupEngine()
    const clipL = motionClip(10)
    const clipR = motionClip(40)
    const clipT = motionClip(5)
    engine.importClip(clipL)
    engine.importClip(clipR)
    engine.importClip(clipT)
    const sourceId = engine.createClipCollection('Gesture', {
      left_hand: clipL.id,
      right_hand: clipR.id,
      torso: clipT.id,
    }).id
    const { collection, clipIdMap } = engine.createReverseMirroredCollection(sourceId, 'X')
    expect(collection.name).toBe('Gesture Reversed Mirrored (X)')
    expect(clipIdMap.size).toBe(3)
    const bindings = collection.getBindingsObject()
    // no lateral guessing: each key keeps its own clip, only values mirror
    const mirroredL = engine.getClip(bindings['left_hand']!)
    const mirroredR = engine.getClip(bindings['right_hand']!)
    expect(mirroredL.getChannelKeyframes('positionX').map((k) => [k.time, k.value])).toEqual([
      [0, -30],
      [1, -10],
    ])
    expect(mirroredR.getChannelKeyframes('positionX').map((k) => [k.time, k.value])).toEqual([
      [0, -60],
      [1, -40],
    ])
    // unpaired torso keeps its key with mirrored values
    const mirroredT = engine.getClip(bindings['torso']!)
    expect(mirroredT.getChannelKeyframes('positionX').map((k) => [k.time, k.value])).toEqual([
      [0, -25],
      [1, -5],
    ])
    // every member carries the symmetry bracket and the collection name
    for (const id of Object.values(bindings)) {
      const member = engine.getClip(id)
      expect(member.getSymmetryKeyframes().map((k) => k.value)).toEqual([
        { axis: 'x', factor: 1 },
        { axis: 'x', factor: 0 },
      ])
      expect(member.name).toBe('Gesture Reversed Mirrored (X)')
      expect(member.isReversed).toBe(true)
    }
    // categories record the original binding semantics (no swap)
    expect(engine.getClip(bindings['left_hand']!).category).toBe('left_hand')
    expect(engine.getClip(bindings['right_hand']!).category).toBe('right_hand')
  })

  it('preserves morph shape names (no left↔right morph swap)', () => {
    const src = new ClipDefinition(newClipId(), 'Turn', 2, 'gesture', [], [])
    src.addMorphKeyframe(
      new KeyframeModel(
        newKeyframeId(),
        0,
        { fromShapeName: 'turn_left', toShapeName: 'turn_left', coefficient: 0 } as never,
        'linear',
        { ...ZERO_TANGENT },
        { ...ZERO_TANGENT },
      ),
    )
    src.addMorphKeyframe(
      new KeyframeModel(
        newKeyframeId(),
        1,
        { fromShapeName: 'turn_left', toShapeName: 'turn_left', coefficient: 1 } as never,
        'linear',
        { ...ZERO_TANGENT },
        { ...ZERO_TANGENT },
      ),
    )
    const { clip } = createReverseMirroredClipDefinition(src, 'X')
    // names stay on their original side; times reverse so coefficients run backwards
    expect(clip.getMorphKeyframes().map((k) => [k.time, k.value])).toEqual([
      [0, { fromShapeName: 'turn_left', toShapeName: 'turn_left', coefficient: 1 }],
      [1, { fromShapeName: 'turn_left', toShapeName: 'turn_left', coefficient: 0 }],
    ])
  })

  it('leaves non-lateral names unswapped with mirrored values', () => {
    const { engine } = setupEngine()
    const clips = [motionClip(1), motionClip(2), motionClip(3)]
    for (const c of clips) engine.importClip(c)
    const sourceId = engine.createClipCollection('Trio', {
      nodeA: clips[0]!.id,
      nodeB: clips[1]!.id,
      nodeC: clips[2]!.id,
    }).id
    const { collection } = engine.createReverseMirroredCollection(sourceId, 'X')
    const bindings = collection.getBindingsObject()
    // non-lateral names with no pair: each key keeps its own (mirrored) clip
    expect(
      engine
        .getClip(bindings['nodeA']!)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([-21, -1])
    expect(
      engine
        .getClip(bindings['nodeB']!)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([-22, -2])
    expect(
      engine
        .getClip(bindings['nodeC']!)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([-23, -3])
  })
})

describe('ReverseMirrorCollectionCommand undo/redo', () => {
  it('mints clips + collection in a single History Entry and restores on redo', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const clip = new ClipDefinition(
      newClipId(),
      'LeftWave',
      2,
      'gesture',
      [],
      [{ property: 'positionX' }],
    )
    clip.addChannelKeyframe('positionX', linearKf(0, 10))
    engine.importClip(clip)
    const sourceId = engine.createClipCollection('Gesture', { left_hand: clip.id }).id
    const entriesBefore = undoStack.entries.length
    const res = dispatcher.dispatch(
      new ReverseMirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Gesture Reversed Mirrored (X)',
        axis: 'X',
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('reverse-mirror failed')
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    const newId = res.inverse.newCollectionId
    expect(engine.getClipCollection(newId).name).toBe('Gesture Reversed Mirrored (X)')
    expect(res.inverse.newClipIds.length).toBe(1)
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClipCollection(newId)).toThrow()
    expect(() => engine.getClip(res.inverse.newClipIds[0]!)).toThrow()
    expect(engine.getClipCollection(sourceId).name).toBe('Gesture')
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getClipCollection(newId).name).toBe('Gesture Reversed Mirrored (X)')
  })

  it('rejects an unknown axis, an empty name, and a missing source', () => {
    const { engine, dispatcher } = setupEngine()
    const clip = new ClipDefinition(
      newClipId(),
      'LeftWave',
      2,
      'gesture',
      [],
      [{ property: 'positionX' }],
    )
    engine.importClip(clip)
    const sourceId = engine.createClipCollection('Gesture', { left_hand: clip.id }).id
    expect(
      () =>
        new ReverseMirrorCollectionCommand({
          sourceCollectionId: sourceId,
          newName: 'M',
          axis: 'Z' as never,
        }),
    ).toThrow(/mirror axis/i)
    expect(
      dispatcher.dispatch(
        new ReverseMirrorCollectionCommand({
          sourceCollectionId: sourceId,
          newName: '  ',
          axis: 'X',
        }),
      ).ok,
    ).toBe(false)
    expect(
      dispatcher.dispatch(
        new ReverseMirrorCollectionCommand({
          sourceCollectionId: 'missing',
          newName: 'M',
          axis: 'X',
        }),
      ).ok,
    ).toBe(false)
  })
})
