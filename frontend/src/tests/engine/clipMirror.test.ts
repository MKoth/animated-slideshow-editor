import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  AssignClipCommand,
  MirrorClipCommand,
} from '../../engine/commands'
import { ClipDefinition, newClipId } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from '../../engine/keyframe'
import {
  createMirroredClipDefinition,
  mirrorClipDefaultName,
  type MirrorAxis,
} from '../../engine/clipMirror'

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

function kf(
  time: number,
  value: number,
  interpolation: 'hold' | 'linear' | 'bezier' | 'bounce' | 'elastic' | 'spring' = 'linear',
  tangentIn = { time: 0, value: 0 },
  tangentOut = { time: 0, value: 0 },
): KeyframeModel {
  return new KeyframeModel(newKeyframeId(), time, value, interpolation, tangentIn, tangentOut)
}

/** A source clip with transform channels plus pass-through lanes. */
function buildSourceClip(name = 'Wave'): ClipDefinition {
  const src = new ClipDefinition(
    newClipId(),
    name,
    2,
    'gesture',
    [{ key: 'amp', label: 'Amp', kind: 'number', default: 1 }],
    [
      { property: 'positionX', paramKey: 'amp', linkMode: 'gain' },
      { property: 'positionY' },
      { property: 'rotation' },
      { property: 'scaleX' },
      { property: 'opacity' },
    ],
  )
  src.addChannelKeyframe(
    'positionX',
    kf(0, 10, 'bezier', { time: -0.1, value: -2 }, { time: 0.2, value: 3 }),
  )
  src.addChannelKeyframe('positionX', kf(1, 30, 'linear'))
  src.addChannelKeyframe(
    'positionY',
    kf(0, 5, 'bezier', { time: -0.1, value: -4 }, { time: 0.1, value: 6 }),
  )
  src.addChannelKeyframe('positionY', kf(1, 15, 'linear'))
  src.addChannelKeyframe('rotation', kf(0, 90, 'linear'))
  src.addChannelKeyframe('rotation', kf(1, 180, 'linear'))
  src.addChannelKeyframe('scaleX', kf(0, 1, 'linear'))
  src.addChannelKeyframe('scaleX', kf(1, 2, 'linear'))
  src.addChannelKeyframe('opacity', kf(0, 0.2, 'linear'))
  src.addChannelKeyframe('opacity', kf(1, 0.8, 'linear'))
  src.addVisibleKeyframe(
    new KeyframeModel(
      newKeyframeId(),
      0,
      true,
      'hold',
      { time: 0, value: 0 },
      { time: 0, value: 0 },
    ),
  )
  src.addZIndexKeyframe(
    new KeyframeModel(newKeyframeId(), 0, 3, 'hold', { time: 0, value: 0 }, { time: 0, value: 0 }),
  )
  return src
}

describe('mirrorClipDefaultName', () => {
  it('defaults to "<original> Mirrored (X)" / "(Y)"', () => {
    expect(mirrorClipDefaultName('Wave', 'X')).toBe('Wave Mirrored (X)')
    expect(mirrorClipDefaultName('Wave', 'Y')).toBe('Wave Mirrored (Y)')
  })
})

describe('createMirroredClipDefinition value table', () => {
  it('X-mirror negates positionX and rotation, leaves positionY/scale/opacity', () => {
    const src = buildSourceClip()
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-10, -30])
    expect(clip.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-90, -180])
    expect(clip.getChannelKeyframes('positionY').map((k) => k.value)).toEqual([5, 15])
    expect(clip.getChannelKeyframes('scaleX').map((k) => k.value)).toEqual([1, 2])
    expect(clip.getChannelKeyframes('opacity').map((k) => k.value)).toEqual([0.2, 0.8])
  })

  it('Y-mirror negates positionY and rotation, leaves positionX', () => {
    const src = buildSourceClip()
    const { clip } = createMirroredClipDefinition(src, 'Y')
    expect(clip.getChannelKeyframes('positionY').map((k) => k.value)).toEqual([-5, -15])
    expect(clip.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-90, -180])
    expect(clip.getChannelKeyframes('positionX').map((k) => k.value)).toEqual(
      [-10, -30].map((v) => -v),
    )
  })

  it('preserves keyframe times and interpolation kinds', () => {
    const src = buildSourceClip()
    for (const axis of ['X', 'Y'] as const) {
      const { clip } = createMirroredClipDefinition(src, axis)
      for (const prop of ['positionX', 'positionY', 'rotation'] as const) {
        const s = src.getChannelKeyframes(prop)
        const m = clip.getChannelKeyframes(prop)
        expect(m.map((k) => k.time)).toEqual(s.map((k) => k.time))
        expect(m.map((k) => k.interpolation)).toEqual(s.map((k) => k.interpolation))
      }
    }
  })

  it('keeps bezier tangent time-components, negates value-components iff the value is negated', () => {
    const src = buildSourceClip()
    const { clip } = createMirroredClipDefinition(src, 'X')
    // positionX is negated on X: tangent values flip, times stay
    const px = clip.getChannelKeyframes('positionX')[0]!
    expect(px.tangentIn).toEqual({ time: -0.1, value: 2 })
    expect(px.tangentOut).toEqual({ time: 0.2, value: -3 })
    // positionY untouched on X: tangents identical
    const py = clip.getChannelKeyframes('positionY')[0]!
    expect(py.tangentIn).toEqual({ time: -0.1, value: -4 })
    expect(py.tangentOut).toEqual({ time: 0.1, value: 6 })
    // rotation negated on either axis (linear here: tangents stay zero)
    const rot = clip.getChannelKeyframes('rotation')[0]!
    expect(rot.tangentIn).toEqual({ time: 0, value: 0 })
  })

  it('mirrors parametric channels at the same normalized position with negated output', () => {
    const src = new ClipDefinition(newClipId(), 'Springy', 1, '', [], [{ property: 'positionX' }])
    src.addChannelKeyframe('positionX', kf(0, 12, 'bounce'))
    src.addChannelKeyframe('positionX', kf(1, 24, 'elastic'))
    const { clip } = createMirroredClipDefinition(src, 'X')
    const m = clip.getChannelKeyframes('positionX')
    expect(m.map((k) => k.time)).toEqual([0, 1])
    expect(m.map((k) => k.value)).toEqual([-12, -24])
    expect(m.map((k) => k.interpolation)).toEqual(['bounce', 'elastic'])
  })

  it('negates gain/offset-linked stored keyframes, leaves param definitions and defaults', () => {
    const src = buildSourceClip()
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.params).toEqual(src.params)
    expect(clip.getParam('amp')?.default).toBe(1)
    expect(clip.getChannel('positionX')).toMatchObject({ paramKey: 'amp', linkMode: 'gain' })
    expect(clip.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-10, -30])
  })
})

describe('createMirroredClipDefinition pass-through lanes', () => {
  it('copies visible, zIndex, symmetry, material, morph verbatim; shadows mirror by direction (#358)', () => {
    const src = buildSourceClip()
    src.addSymmetryKeyframe(
      new KeyframeModel(newKeyframeId(), 0, { axis: 'x', factor: 0.5 } as never),
    )
    src.addChannel({ property: 'scaleY', materialParameter: 'glow' })
    src.addMaterialChannelKeyframe(
      'glow',
      new KeyframeModel(
        newKeyframeId(),
        0.25,
        0.75,
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    src.addMorphKeyframe(
      new KeyframeModel(newKeyframeId(), 0.5, {
        fromShapeName: 'A',
        toShapeName: 'B',
        coefficient: 0.3,
      } as never),
    )
    src.addShadowChannelKeyframe(
      'offsetX',
      new KeyframeModel(
        newKeyframeId(),
        0,
        10,
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.getVisibleKeyframes().map((k) => [k.time, k.value])).toEqual([[0, true]])
    expect(clip.getZIndexKeyframes().map((k) => [k.time, k.value])).toEqual([[0, 3]])
    expect(clip.getSymmetryKeyframes().map((k) => k.value)).toEqual([{ axis: 'x', factor: 0.5 }])
    expect(clip.getMaterialChannelKeyframes('glow').map((k) => [k.time, k.value])).toEqual([
      [0.25, 0.75],
    ])
    expect(clip.getMorphKeyframes().map((k) => k.value)).toEqual([
      { fromShapeName: 'A', toShapeName: 'B', coefficient: 0.3 },
    ])
    expect(clip.getShadowChannelKeyframes('offsetX').map((k) => [k.time, k.value])).toEqual([
      [0, -10],
    ])
  })

  it('respects bone (no opacity) and camera (no rotation) constraints via channel preservation', () => {
    // bone-like: five transform channels, no opacity — mirror adds none
    const bone = new ClipDefinition(
      newClipId(),
      'BoneMove',
      1,
      '',
      [],
      [
        { property: 'positionX' },
        { property: 'positionY' },
        { property: 'rotation' },
        { property: 'scaleX' },
        { property: 'scaleY' },
      ],
    )
    bone.addChannelKeyframe('positionX', kf(0, 4))
    bone.addChannelKeyframe('rotation', kf(0, 30))
    const mirroredBone = createMirroredClipDefinition(bone, 'X').clip
    expect(mirroredBone.channels.map((c) => c.property)).toEqual(
      bone.channels.map((c) => c.property),
    )
    expect(mirroredBone.hasChannel('opacity')).toBe(false)
    expect(mirroredBone.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-30])
    // camera-like: no rotation channel — mirror introduces none
    const cam = new ClipDefinition(
      newClipId(),
      'CamPan',
      1,
      '',
      [],
      [{ property: 'positionX' }, { property: 'positionY' }, { property: 'opacity' }],
    )
    cam.addChannelKeyframe('positionX', kf(0, 8))
    const mirroredCam = createMirroredClipDefinition(cam, 'X').clip
    expect(mirroredCam.hasChannel('rotation')).toBe(false)
    expect(mirroredCam.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-8])
    expect(mirroredCam.getChannelKeyframes('opacity').map((k) => k.value)).toEqual([])
  })

  it('skips circle/table lanes with a visible notice, never silently drops', () => {
    const src = buildSourceClip()
    src.addCircleKeyframe('radius', kf(0, 10))
    src.addCircleKeyframe('radius', kf(1, 20))
    src.addTableKeyframe('borderRadius', kf(0, 4))
    const before = JSON.stringify(src.toJSON())
    const { clip, skipped } = createMirroredClipDefinition(src, 'X')
    expect(clip.circleTrackKeys).toEqual([])
    expect(clip.tableTrackKeys).toEqual([])
    expect(skipped.length).toBeGreaterThan(0)
    expect(skipped.join(' ')).toMatch(/circle/i)
    expect(skipped.join(' ')).toMatch(/table/i)
    // source untouched
    expect(JSON.stringify(src.toJSON())).toBe(before)
    expect(src.circleTrackKeys).toContain('radius')
    expect(src.tableTrackKeys).toContain('borderRadius')
  })

  it('leaves the source clip untouched and mints a new identity', () => {
    const src = buildSourceClip()
    const before = JSON.stringify(src.toJSON())
    const { clip } = createMirroredClipDefinition(src, 'X', 'Custom Name')
    expect(JSON.stringify(src.toJSON())).toBe(before)
    expect(clip.id).not.toBe(src.id)
    expect(clip.name).toBe('Custom Name')
    expect(clip.duration).toBe(src.duration)
    expect(clip.category).toBe(src.category)
    expect(clip.isReversed).toBe(false)
    // keyframe ids are fresh
    const srcIds = src.getChannelKeyframes('positionX').map((k) => k.id)
    const dstIds = clip.getChannelKeyframes('positionX').map((k) => k.id)
    expect(dstIds).not.toEqual(srcIds)
  })
})

describe('MirrorClipCommand undo/redo', () => {
  function buildEngineClip(engine: Engine): string {
    const clip = engine.createClip(
      'Wave',
      2,
      'gesture',
      [{ key: 'amp', label: 'Amp', kind: 'number', default: 1 }],
      [
        { property: 'positionX', paramKey: 'amp', linkMode: 'gain' },
        { property: 'positionY' },
        { property: 'rotation' },
      ],
    )
    clip.addChannelKeyframe('positionX', kf(0, 10))
    clip.addChannelKeyframe('positionX', kf(1, 30))
    clip.addChannelKeyframe('positionY', kf(0, 5))
    clip.addChannelKeyframe('rotation', kf(0, 90))
    return clip.id
  }

  it('mirrors via the dispatcher with axis + default name, undoes/redoes as one entry', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const sourceId = buildEngineClip(engine)
    const entriesBefore = undoStack.entries.length
    const axis: MirrorAxis = 'X'
    const res = dispatcher.dispatch(
      new MirrorClipCommand({
        sourceClipId: sourceId,
        newName: mirrorClipDefaultName(engine.getClip(sourceId).name, axis),
        axis,
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    const mirrored = engine.getClip(res.inverse.newClipId)
    expect(mirrored.name).toBe('Wave Mirrored (X)')
    expect(mirrored.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-10, -30])
    expect(mirrored.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-90])
    expect(mirrored.getChannelKeyframes('positionY').map((k) => k.value)).toEqual([5])
    // source untouched
    expect(
      engine
        .getClip(sourceId)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([10, 30])
    // single-entry undo removes the mirrored clip
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClip(res.inverse.newClipId)).toThrow()
    expect(engine.getClip(sourceId).name).toBe('Wave')
    // redo restores the mirrored clip
    expect(dispatcher.redo()).toBe(true)
    const restored = engine.getClip(res.inverse.newClipId)
    expect(restored.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-10, -30])
  })

  it('plays back mirrored through the standard evaluator', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    const clip = engine.createClip(
      'Wave',
      2,
      '',
      [],
      [{ property: 'positionX' }, { property: 'rotation' }],
    )
    clip.addChannelKeyframe('positionX', kf(0, 10))
    clip.addChannelKeyframe('positionX', kf(1, 30))
    clip.addChannelKeyframe('rotation', kf(0, 90))
    clip.addChannelKeyframe('rotation', kf(1, 180))
    const res = dispatcher.dispatch(
      new MirrorClipCommand({ sourceClipId: clip.id, newName: 'Wave Mirrored (X)', axis: 'X' }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    const assign = dispatcher.dispatch(
      new AssignClipCommand({
        nodeId: node.id,
        clipId: res.inverse.newClipId,
        startTime: 0,
        speed: 1,
      }),
    )
    expect(assign.ok).toBe(true)
    expect(engine.evaluateNode(node.id, 0).transform.x).toBeCloseTo(-10)
    expect(engine.evaluateNode(node.id, 1).transform.x).toBeCloseTo(-20)
    expect(engine.evaluateNode(node.id, 0).transform.rotation).toBeCloseTo(-90)
  })

  it('rejects an unknown axis, an empty name, and a missing source', () => {
    const { engine, dispatcher } = setupEngine()
    const sourceId = buildEngineClip(engine)
    expect(
      () =>
        new MirrorClipCommand({ sourceClipId: sourceId, newName: 'M', axis: 'Z' as MirrorAxis }),
    ).toThrow(/mirror axis/i)
    expect(
      dispatcher.dispatch(
        new MirrorClipCommand({ sourceClipId: sourceId, newName: '  ', axis: 'X' }),
      ).ok,
    ).toBe(false)
    expect(
      dispatcher.dispatch(
        new MirrorClipCommand({ sourceClipId: 'clip-missing', newName: 'M', axis: 'X' }),
      ).ok,
    ).toBe(false)
  })
})
