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
  MirrorCollectionCommand,
  SetShadowEffectCommand,
} from '../../engine/commands'
import { ClipDefinition, newClipId } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from '../../engine/keyframe'
import { createMirroredClipDefinition } from '../../engine/clipMirror'
import { DEFAULT_SHADOW_EFFECT } from '../../engine/shadowEffect'

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

function kf(time: number, value: number | string): KeyframeModel {
  return new KeyframeModel(
    newKeyframeId(),
    time,
    value as never,
    'linear',
    { time: 0, value: 0 },
    { time: 0, value: 0 },
  )
}

function bezierKf(
  time: number,
  value: number,
  tangentIn: { time: number; value: number },
  tangentOut: { time: number; value: number },
): KeyframeModel {
  return new KeyframeModel(newKeyframeId(), time, value as never, 'bezier', tangentIn, tangentOut)
}

/** Manual-mode source: raw offset/rotation/skew/scale/shared/light-static lanes, no azimuth. */
function buildManualSource(name = 'ShadowManual'): ClipDefinition {
  const src = new ClipDefinition(newClipId(), name, 2, '', [], [])
  src.addShadowChannelKeyframe('offsetX', kf(0, 10))
  src.addShadowChannelKeyframe('offsetX', kf(1, 20))
  src.addShadowChannelKeyframe('offsetY', kf(0, 6))
  src.addShadowChannelKeyframe('offsetY', kf(1, 8))
  src.addShadowChannelKeyframe('rotation', kf(0, 30))
  src.addShadowChannelKeyframe('skewX', kf(0, 12))
  src.addShadowChannelKeyframe('skewY', kf(0, -18))
  src.addShadowChannelKeyframe('scaleX', kf(0, 1.5))
  src.addShadowChannelKeyframe('scaleY', kf(0, 0.5))
  src.addShadowChannelKeyframe('blur', kf(0, 8))
  src.addShadowChannelKeyframe('opacity', kf(0, 0.4))
  src.addShadowChannelKeyframe('color', kf(0, '#ff0000'))
  src.addShadowChannelKeyframe('lightElevation', kf(0, 45))
  src.addShadowChannelKeyframe('lightDistance', kf(0, 28))
  return src
}

/** Auto-mode source: azimuth lane plus stale raw lanes that must pass through untouched. */
function buildAutoSource(name = 'ShadowAuto'): ClipDefinition {
  const src = new ClipDefinition(newClipId(), name, 2, '', [], [])
  src.addShadowChannelKeyframe('lightAzimuth', kf(0, 30))
  src.addShadowChannelKeyframe('lightAzimuth', kf(1, 135))
  src.addShadowChannelKeyframe('offsetX', kf(0, 10))
  src.addShadowChannelKeyframe('rotation', kf(0, 30))
  src.addShadowChannelKeyframe('skewX', kf(0, 12))
  src.addShadowChannelKeyframe('blur', kf(0, 8))
  src.addShadowChannelKeyframe('opacity', kf(0, 0.4))
  return src
}

describe('shadow manual mirroring (raw offset/rotation/skew)', () => {
  it('X-mirror negates offsetX, leaves offsetY and all non-directional lanes', () => {
    const { clip } = createMirroredClipDefinition(buildManualSource(), 'X')
    expect(clip.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([-10, -20])
    expect(clip.getShadowChannelKeyframes('offsetY').map((k) => k.value)).toEqual([6, 8])
    expect(clip.getShadowChannelKeyframes('scaleX').map((k) => k.value)).toEqual([1.5])
    expect(clip.getShadowChannelKeyframes('scaleY').map((k) => k.value)).toEqual([0.5])
    expect(clip.getShadowChannelKeyframes('blur').map((k) => k.value)).toEqual([8])
    expect(clip.getShadowChannelKeyframes('opacity').map((k) => k.value)).toEqual([0.4])
    expect(clip.getShadowChannelKeyframes('color').map((k) => k.value)).toEqual(['#ff0000'])
    expect(clip.getShadowChannelKeyframes('lightElevation').map((k) => k.value)).toEqual([45])
    expect(clip.getShadowChannelKeyframes('lightDistance').map((k) => k.value)).toEqual([28])
  })

  it('Y-mirror negates offsetY, leaves offsetX', () => {
    const { clip } = createMirroredClipDefinition(buildManualSource(), 'Y')
    expect(clip.getShadowChannelKeyframes('offsetY').map((k) => k.value)).toEqual([-6, -8])
    expect(clip.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([10, 20])
  })

  it('negates rotation and skews on either axis with angular normalization', () => {
    const src = new ClipDefinition(newClipId(), 'Angles', 1, '', [], [])
    src.addShadowChannelKeyframe('rotation', kf(0, 190))
    src.addShadowChannelKeyframe('skewX', kf(0, 170))
    src.addShadowChannelKeyframe('skewY', kf(0, -170))
    for (const axis of ['X', 'Y'] as const) {
      const { clip } = createMirroredClipDefinition(src, axis)
      // -(190) = -190 wraps to 170; -(170) = -170; -(-170) = 170
      expect(clip.getShadowChannelKeyframes('rotation').map((k) => k.value)).toEqual([170])
      expect(clip.getShadowChannelKeyframes('skewX').map((k) => k.value)).toEqual([-170])
      expect(clip.getShadowChannelKeyframes('skewY').map((k) => k.value)).toEqual([170])
    }
  })

  it('never negates scales and negates bezier tangent values iff the lane value is negated', () => {
    const src = new ClipDefinition(newClipId(), 'Tangents', 1, '', [], [])
    src.addShadowChannelKeyframe(
      'offsetX',
      bezierKf(0, 10, { time: -0.1, value: -2 }, { time: 0.2, value: 3 }),
    )
    src.addShadowChannelKeyframe(
      'offsetY',
      bezierKf(0, 6, { time: -0.1, value: -4 }, { time: 0.1, value: 5 }),
    )
    src.addShadowChannelKeyframe(
      'rotation',
      bezierKf(0, 30, { time: -0.2, value: -7 }, { time: 0.3, value: 9 }),
    )
    const { clip } = createMirroredClipDefinition(src, 'X')
    const ox = clip.getShadowChannelKeyframes('offsetX')[0]!
    expect(ox.value).toBe(-10)
    expect(ox.tangentIn).toEqual({ time: -0.1, value: 2 })
    expect(ox.tangentOut).toEqual({ time: 0.2, value: -3 })
    // unaffected axis keeps tangents bit-identical
    const oy = clip.getShadowChannelKeyframes('offsetY')[0]!
    expect(oy.value).toBe(6)
    expect(oy.tangentIn).toEqual({ time: -0.1, value: -4 })
    expect(oy.tangentOut).toEqual({ time: 0.1, value: 5 })
    // rotation negated on either axis
    const rot = clip.getShadowChannelKeyframes('rotation')[0]!
    expect(rot.value).toBe(-30)
    expect(rot.tangentIn).toEqual({ time: -0.2, value: 7 })
    expect(rot.tangentOut).toEqual({ time: 0.3, value: -9 })
    // times and interpolation preserved
    expect(ox.time).toBe(0)
    expect(ox.interpolation).toBe('bezier')
  })

  it('leaves the source untouched and mints fresh keyframe ids', () => {
    const src = buildManualSource()
    const before = JSON.stringify(src.toJSON())
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(JSON.stringify(src.toJSON())).toBe(before)
    expect(clip.id).not.toBe(src.id)
    expect(clip.isReversed).toBe(false)
    const srcIds = src.getShadowChannelKeyframes('offsetX').map((k) => k.id)
    const dstIds = clip.getShadowChannelKeyframes('offsetX').map((k) => k.id)
    expect(dstIds).not.toEqual(srcIds)
  })
})

describe('shadow auto mirroring (azimuth only, projection re-derives)', () => {
  it('X-mirror maps azimuth to 180-azimuth normalized to 0-360', () => {
    const src = new ClipDefinition(newClipId(), 'Az', 1, '', [], [])
    src.addShadowChannelKeyframe('lightAzimuth', kf(0, 30))
    src.addShadowChannelKeyframe('lightAzimuth', kf(0.5, 135))
    src.addShadowChannelKeyframe('lightAzimuth', kf(1, 0))
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.getShadowChannelKeyframes('lightAzimuth').map((k) => k.value)).toEqual([
      150, 45, 180,
    ])
  })

  it('Y-mirror maps azimuth to -azimuth normalized to 0-360 (offsetY side)', () => {
    const src = new ClipDefinition(newClipId(), 'Az', 1, '', [], [])
    src.addShadowChannelKeyframe('lightAzimuth', kf(0, 135))
    src.addShadowChannelKeyframe('lightAzimuth', kf(1, 30))
    const { clip } = createMirroredClipDefinition(src, 'Y')
    expect(clip.getShadowChannelKeyframes('lightAzimuth').map((k) => k.value)).toEqual([225, 330])
  })

  it('auto clips mirror the azimuth only: raw lanes pass through with no double application', () => {
    const src = buildAutoSource()
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.getShadowChannelKeyframes('lightAzimuth').map((k) => k.value)).toEqual([150, 45])
    // stale raw lanes untouched so the re-derived projection applies exactly once
    expect(clip.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([10])
    expect(clip.getShadowChannelKeyframes('rotation').map((k) => k.value)).toEqual([30])
    expect(clip.getShadowChannelKeyframes('skewX').map((k) => k.value)).toEqual([12])
    expect(clip.getShadowChannelKeyframes('blur').map((k) => k.value)).toEqual([8])
    expect(clip.getShadowChannelKeyframes('opacity').map((k) => k.value)).toEqual([0.4])
  })

  it('negates azimuth tangent values while keeping times and interpolation', () => {
    const src = new ClipDefinition(newClipId(), 'AzTan', 1, '', [], [])
    src.addShadowChannelKeyframe(
      'lightAzimuth',
      bezierKf(0.25, 30, { time: -0.1, value: -2 }, { time: 0.2, value: 3 }),
    )
    const { clip } = createMirroredClipDefinition(src, 'X')
    const az = clip.getShadowChannelKeyframes('lightAzimuth')[0]!
    expect(az.value).toBe(150)
    expect(az.time).toBe(0.25)
    expect(az.interpolation).toBe('bezier')
    expect(az.tangentIn).toEqual({ time: -0.1, value: 2 })
    expect(az.tangentOut).toEqual({ time: 0.2, value: -3 })
  })
})

describe('shadow mirroring through single-clip and collection flows', () => {
  it('mirrors manual shadow lanes via MirrorClipCommand in one undo entry', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const src = buildManualSource()
    engine.importClip(src)
    const entriesBefore = undoStack.entries.length
    const res = dispatcher.dispatch(
      new MirrorClipCommand({
        sourceClipId: src.id,
        newName: 'ShadowManual Mirrored (X)',
        axis: 'X',
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    const mirrored = engine.getClip(res.inverse.newClipId)
    expect(mirrored.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([-10, -20])
    expect(mirrored.getShadowChannelKeyframes('rotation').map((k) => k.value)).toEqual([-30])
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClip(res.inverse.newClipId)).toThrow()
    expect(dispatcher.redo()).toBe(true)
    expect(
      engine
        .getClip(res.inverse.newClipId)
        .getShadowChannelKeyframes('offsetX')
        .map((k) => k.value),
    ).toEqual([-10, -20])
  })

  it('mirrors shadow lanes through the collection flow under one undo entry', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const manual = buildManualSource('Manual')
    const auto = buildAutoSource('Auto')
    engine.importClip(manual)
    engine.importClip(auto)
    const sourceId = engine.createClipCollection('Shadows', {
      left_hand: manual.id,
      right_hand: auto.id,
    }).id
    const entriesBefore = undoStack.entries.length
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Shadows Mirrored (X)',
        axis: 'X',
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    const collection = engine.getClipCollection(res.inverse.newCollectionId)
    const bindings = collection.getBindingsObject()
    // lateral swap: mirrored manual (was left) now drives right and vice versa
    const mirroredManual = engine.getClip(bindings['right_hand']!)
    const mirroredAuto = engine.getClip(bindings['left_hand']!)
    expect(mirroredManual.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([
      -10, -20,
    ])
    expect(mirroredAuto.getShadowChannelKeyframes('lightAzimuth').map((k) => k.value)).toEqual([
      150, 45,
    ])
    expect(mirroredAuto.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([10])
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClipCollection(res.inverse.newCollectionId)).toThrow()
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getClipCollection(res.inverse.newCollectionId).name).toBe('Shadows Mirrored (X)')
  })

  it('manual mirrored clip evaluates to the mirrored side through the standard evaluator', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'G')
    engine.createNode(slide.scene.id, group.id, 'C1', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    dispatcher.dispatch(
      new SetShadowEffectCommand({
        nodeId: group.id,
        shadowEffect: { ...DEFAULT_SHADOW_EFFECT, auto: false, offsetX: 0, offsetY: 0 },
      }),
    )
    const src = new ClipDefinition(newClipId(), 'Eval', 2, '', [], [])
    src.addShadowChannelKeyframe('offsetX', kf(0, 10))
    src.addShadowChannelKeyframe('offsetX', kf(1, 20))
    engine.importClip(src)
    const res = dispatcher.dispatch(
      new MirrorClipCommand({ sourceClipId: src.id, newName: 'Eval Mirrored (X)', axis: 'X' }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    const assign = dispatcher.dispatch(
      new AssignClipCommand({
        nodeId: group.id,
        clipId: res.inverse.newClipId,
        startTime: 0,
        speed: 1,
      }),
    )
    expect(assign.ok).toBe(true)
    expect(engine.evaluateShadow(group.id, 0)!.offsetX).toBeCloseTo(-10)
    expect(engine.evaluateShadow(group.id, 2)!.offsetX).toBeCloseTo(-20)
  })

  it('auto mirrored clip re-derives to the mirrored side (center anchor: offsetX negates exactly)', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'G')
    engine.createNode(slide.scene.id, group.id, 'C1', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    dispatcher.dispatch(
      new SetShadowEffectCommand({
        nodeId: group.id,
        shadowEffect: { ...DEFAULT_SHADOW_EFFECT, auto: true, anchor: 'center', lightAzimuth: 30 },
      }),
    )
    const before = engine.evaluateShadow(group.id, 0, { w: 100, h: 50 })!
    const src = new ClipDefinition(newClipId(), 'AutoEval', 1, '', [], [])
    src.addShadowChannelKeyframe('lightAzimuth', kf(0, 30))
    engine.importClip(src)
    const res = dispatcher.dispatch(
      new MirrorClipCommand({ sourceClipId: src.id, newName: 'AutoEval Mirrored (X)', axis: 'X' }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    const mirrored = engine.getClip(res.inverse.newClipId)
    expect(mirrored.getShadowChannelKeyframes('lightAzimuth').map((k) => k.value)).toEqual([150])
    const assign = dispatcher.dispatch(
      new AssignClipCommand({
        nodeId: group.id,
        clipId: res.inverse.newClipId,
        startTime: 0,
        speed: 1,
      }),
    )
    expect(assign.ok).toBe(true)
    const after = engine.evaluateShadow(group.id, 0, { w: 100, h: 50 })!
    expect(after.offsetX).toBeCloseTo(-before.offsetX, 8)
    expect(after.offsetY).toBeCloseTo(before.offsetY, 8)
  })
})
