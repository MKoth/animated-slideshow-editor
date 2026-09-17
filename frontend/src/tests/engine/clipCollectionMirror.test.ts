import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  MirrorCollectionCommand,
} from '../../engine/commands'
import { newClipId } from '../../engine/clipDefinition'
import { ClipDefinition } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from '../../engine/keyframe'
import {
  swapLateralSemanticName,
  mirrorCollectionDefaultName,
  buildMirrorSwapPreview,
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

function kf(time: number, value: number): KeyframeModel {
  return new KeyframeModel(
    newKeyframeId(),
    time,
    value,
    'linear',
    { time: 0, value: 0 },
    { time: 0, value: 0 },
  )
}

function buildClip(name: string, pxValue: number): ClipDefinition {
  const clip = new ClipDefinition(
    newClipId(),
    name,
    2,
    'gesture',
    [{ key: 'amp', label: 'Amp', kind: 'number', default: 1 }],
    [{ property: 'positionX' }, { property: 'rotation' }],
  )
  clip.addChannelKeyframe('positionX', kf(0, pxValue))
  clip.addChannelKeyframe('rotation', kf(0, 90))
  return clip
}

describe('swapLateralSemanticName', () => {
  it('swaps left/right words, suffixes, and casing; unpaired pass through', () => {
    expect(swapLateralSemanticName('left_hand')).toBe('right_hand')
    expect(swapLateralSemanticName('right_hand')).toBe('left_hand')
    expect(swapLateralSemanticName('arm_L')).toBe('arm_R')
    expect(swapLateralSemanticName('arm_R')).toBe('arm_L')
    expect(swapLateralSemanticName('arm.L')).toBe('arm.R')
    expect(swapLateralSemanticName('arm.R')).toBe('arm.L')
    expect(swapLateralSemanticName('LeftArm')).toBe('RightArm')
    expect(swapLateralSemanticName('RightArm')).toBe('LeftArm')
    expect(swapLateralSemanticName('armLeft')).toBe('armRight')
    expect(swapLateralSemanticName('LEFT')).toBe('RIGHT')
    expect(swapLateralSemanticName('LEFT_HAND')).toBe('RIGHT_HAND')
    expect(swapLateralSemanticName('torso')).toBe('torso')
    expect(swapLateralSemanticName('head')).toBe('head')
  })

  it('never rewrites left/right inside unrelated words', () => {
    expect(swapLateralSemanticName('leftover')).toBe('leftover')
    expect(swapLateralSemanticName('highlight')).toBe('highlight')
    expect(swapLateralSemanticName('_Left')).toBe('_Right')
  })

  it('is an involution', () => {
    for (const name of ['left_hand', 'arm_L', 'arm.R', 'LeftLeg', 'torso']) {
      expect(swapLateralSemanticName(swapLateralSemanticName(name))).toBe(name)
    }
  })
})

describe('mirrorCollectionDefaultName', () => {
  it('defaults to "<original> Mirrored (X)" / "(Y)"', () => {
    expect(mirrorCollectionDefaultName('Walk', 'X')).toBe('Walk Mirrored (X)')
    expect(mirrorCollectionDefaultName('Walk', 'Y')).toBe('Walk Mirrored (Y)')
  })
})

describe('buildMirrorSwapPreview', () => {
  it('lists swapped and passthrough keys in input order', () => {
    const preview = buildMirrorSwapPreview(['left_hand', 'torso'])
    expect(preview).toEqual([
      { source: 'left_hand', mirrored: 'right_hand', swapped: true },
      { source: 'torso', mirrored: 'torso', swapped: false },
    ])
  })
})

describe('createMirroredCollection', () => {
  function buildSource(engine: Engine): string {
    const left = buildClip('LeftWave', 10)
    const right = buildClip('RightWave', 40)
    const torso = buildClip('TorsoSway', 5)
    engine.importClip(left)
    engine.importClip(right)
    engine.importClip(torso)
    const col = engine.createClipCollection('Gesture', {
      left_hand: left.id,
      right_hand: right.id,
      torso: torso.id,
    })
    return col.id
  }

  it('mirrors members, swaps lateral keys, and preserves clip metadata', () => {
    const { engine } = setupEngine()
    const sourceId = buildSource(engine)
    const source = engine.getClipCollection(sourceId)
    const before = JSON.stringify(source.toJSON())
    const axis: MirrorAxis = 'X'
    const { collection, clipIdMap } = engine.createMirroredCollection(sourceId, axis)
    expect(collection.name).toBe('Gesture Mirrored (X)')
    // 3 distinct source clips -> 3 mirrored clips
    expect(clipIdMap.size).toBe(3)
    const bindings = collection.getBindingsObject()
    expect(Object.keys(bindings).sort()).toEqual(['left_hand', 'right_hand', 'torso'].sort())
    // lateral exchange: mirrored left motion now drives the right side
    const mirroredLeftId = clipIdMap.get(source.getBinding('left_hand')!)!
    const mirroredRightId = clipIdMap.get(source.getBinding('right_hand')!)!
    expect(bindings['right_hand']).toBe(mirroredLeftId)
    expect(bindings['left_hand']).toBe(mirroredRightId)
    // unpaired passes through under the same key
    expect(bindings['torso']).toBe(clipIdMap.get(source.getBinding('torso')!)!)
    // mirrored values follow single-clip rules
    expect(
      engine
        .getClip(mirroredLeftId)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([-10])
    expect(
      engine
        .getClip(mirroredLeftId)
        .getChannelKeyframes('rotation')
        .map((k) => k.value),
    ).toEqual([-90])
    // metadata preserved (duration/channels/params); category carries the
    // new binding semantic, name carries the new collection name
    const srcClip = engine.getClip(source.getBinding('left_hand')!)!
    const mirrored = engine.getClip(mirroredLeftId)
    expect(mirrored.duration).toBe(srcClip.duration)
    expect(mirrored.category).toBe('right_hand')
    expect(mirrored.name).toBe('Gesture Mirrored (X)')
    expect(mirrored.channels).toEqual(srcClip.channels)
    expect(mirrored.params).toEqual(srcClip.params)
    // originals untouched
    expect(JSON.stringify(engine.getClipCollection(sourceId).toJSON())).toBe(before)
    expect(
      engine
        .getClip(srcClip.id)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([10])
  })

  it('mirrors a shared clip once and binds it N times under swapped names', () => {
    const { engine } = setupEngine()
    const shared = buildClip('Shared', 12)
    engine.importClip(shared)
    const sourceId = engine.createClipCollection('SharedCol', {
      left_hand: shared.id,
      right_hand: shared.id,
    }).id
    const { collection, clipIdMap } = engine.createMirroredCollection(sourceId, 'X')
    expect(clipIdMap.size).toBe(1)
    const bindings = collection.getBindingsObject()
    // one mirrored clip bound under both swapped keys
    expect(bindings['right_hand']).toBe(bindings['left_hand'])
    expect(Object.values(bindings).length).toBe(2)
  })

  it('applies the mirrored collection through the standard broadcast rule', () => {
    const { engine } = setupEngine()
    const sourceId = buildSource(engine)
    const { collection } = engine.createMirroredCollection(sourceId, 'X')
    const slide = engine.getActiveSlide()!
    const root = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const leftNode = engine.createNode(slide.scene.id, root.id, 'L', {
      semanticName: 'left_hand',
    })
    const rightNode = engine.createNode(slide.scene.id, root.id, 'R', {
      semanticName: 'right_hand',
    })
    const created = engine.applyClipCollection(collection.id, root.id)
    expect(created.length).toBe(2)
    const byNode = new Map(created.map((c) => [c.nodeId, c.clipId]))
    // swapped: right node plays the mirrored left clip (value -10)
    const rightClip = engine.getClip(byNode.get(rightNode.id)!)!
    expect(rightClip.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-10])
    const leftClip = engine.getClip(byNode.get(leftNode.id)!)!
    expect(leftClip.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-40])
  })
})

describe('MirrorCollectionCommand undo/redo', () => {
  it('mints clips + collection in a single History Entry and restores on redo', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const left = buildClip('LeftWave', 10)
    engine.importClip(left)
    const sourceId = engine.createClipCollection('Gesture', { left_hand: left.id }).id
    const entriesBefore = undoStack.entries.length
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: mirrorCollectionDefaultName('Gesture', 'X'),
        axis: 'X',
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    const newId = res.inverse.newCollectionId
    expect(engine.getClipCollection(newId).name).toBe('Gesture Mirrored (X)')
    expect(res.inverse.newClipIds.length).toBe(1)
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClipCollection(newId)).toThrow()
    expect(() => engine.getClip(res.inverse.newClipIds[0]!)).toThrow()
    // source survives undo
    expect(engine.getClipCollection(sourceId).name).toBe('Gesture')
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getClipCollection(newId).name).toBe('Gesture Mirrored (X)')
  })

  it('rejects an unknown axis, an empty name, and a missing source', () => {
    const { engine, dispatcher } = setupEngine()
    const left = buildClip('LeftWave', 10)
    engine.importClip(left)
    const sourceId = engine.createClipCollection('Gesture', { left_hand: left.id }).id
    expect(
      () =>
        new MirrorCollectionCommand({
          sourceCollectionId: sourceId,
          newName: 'M',
          axis: 'Z' as MirrorAxis,
        }),
    ).toThrow(/mirror axis/i)
    expect(
      dispatcher.dispatch(
        new MirrorCollectionCommand({ sourceCollectionId: sourceId, newName: '  ', axis: 'X' }),
      ).ok,
    ).toBe(false)
    expect(
      dispatcher.dispatch(
        new MirrorCollectionCommand({ sourceCollectionId: 'missing', newName: 'M', axis: 'X' }),
      ).ok,
    ).toBe(false)
  })
})
