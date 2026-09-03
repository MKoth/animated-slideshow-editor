import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { CommandDispatcher, UndoStack, CreateProjectCommand, CreateSlideCommand } from '../../engine/commands'
import { ExtractToClipCommand } from '../../engine/commands/extractToClipCommand'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import { computeExtractionBounds, normalizeExtractable, validateNoDuplicateTimes, channelKeyOf, groupNormalizedByChannel } from '../../engine/clipExtraction'
import type { KeyframeTarget } from '../../engine/keyframeTarget'

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

function makeExtractable(target: KeyframeTarget, time: number, value: unknown, interp: import('../../engine/keyframe').InterpolationType = 'linear', tangentIn = { time: 0, value: 0 }, tangentOut = { time: 0, value: 0 }): ExtractableKeyframe {
  return {
    target,
    time,
    value: value as import('../../engine/keyframe').KeyframeValue,
    interpolation: interp,
    tangentIn,
    tangentOut,
    keyframeId: `kf-${time}-${String(value)}`,
  }
}

describe('clipExtraction pure functions', () => {
  it('normalizes time as (t - selStart)/selDuration', () => {
    const kfs = [
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 1, 0),
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 2, 10),
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 4, 20),
    ]
    const bounds = computeExtractionBounds(kfs)
    expect(bounds.selStart).toBe(1)
    expect(bounds.selEnd).toBe(4)
    expect(bounds.selDuration).toBe(3)
    expect(bounds.clipDuration).toBe(3)
    const normalized = kfs.map((kf) => normalizeExtractable(kf, bounds))
    expect(normalized[0].time).toBeCloseTo(0)
    expect(normalized[1].time).toBeCloseTo(1/3)
    expect(normalized[2].time).toBeCloseTo(1)
    // values unchanged
    expect(normalized[0].value).toBe(0)
    expect(normalized[1].value).toBe(10)
  })

  it('normalizes tangent time by selDuration', () => {
    const kf = makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 2, 5, 'bezier', { time: -0.3, value: 1 }, { time: 0.6, value: -2 })
    const bounds = { selStart: 1, selEnd: 4, selDuration: 3, clipDuration: 3 }
    const n = normalizeExtractable(kf, bounds)
    expect(n.tangentIn.time).toBeCloseTo(-0.1)
    expect(n.tangentOut.time).toBeCloseTo(0.2)
    expect(n.tangentIn.value).toBe(1)
    expect(n.tangentOut.value).toBe(-2)
  })

  it('handles zero duration selection with clipDuration 1 and time 0', () => {
    const kfs = [
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'opacity' }, 5, 0.5),
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'opacity' }, 5, 0.8),
    ]
    const bounds = computeExtractionBounds(kfs)
    expect(bounds.selDuration).toBe(0)
    expect(bounds.clipDuration).toBe(1)
    const normalized = kfs.map((kf) => normalizeExtractable(kf, bounds))
    expect(normalized[0].time).toBe(0)
    expect(normalized[1].time).toBe(0)
    // duplicate time should be detected
    const groups = groupNormalizedByChannel(normalized)
    expect(() => validateNoDuplicateTimes(groups)).toThrow(/Duplicate normalized time/)
  })

  it('validates duplicate times across same channel', () => {
    const kfs = [
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 0, 0),
      makeExtractable({ kind: 'node', nodeId: 'n2', property: 'positionX' }, 0, 10),
    ]
    const bounds = { selStart: 0, selEnd: 1, selDuration: 1, clipDuration: 1 }
    const normalized = kfs.map((kf) => normalizeExtractable(kf, bounds))
    // both at 0, same channel property -> duplicate
    const groups = groupNormalizedByChannel(normalized)
    expect(() => validateNoDuplicateTimes(groups)).toThrow(/Duplicate/)
  })

  it('allows same time across different channels', () => {
    const kfs = [
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionX' }, 0, 0),
      makeExtractable({ kind: 'node', nodeId: 'n1', property: 'positionY' }, 0, 10),
    ]
    const bounds = { selStart: 0, selEnd: 1, selDuration: 1, clipDuration: 1 }
    const normalized = kfs.map((kf) => normalizeExtractable(kf, bounds))
    const groups = groupNormalizedByChannel(normalized)
    expect(() => validateNoDuplicateTimes(groups)).not.toThrow()
  })

  it('channelKeyOf distinguishes visible and circle', () => {
    expect(channelKeyOf({ kind: 'visible', nodeId: 'n1' })).toBe('visible')
    expect(channelKeyOf({ kind: 'circle', nodeId: 'n1', property: 'radius' })).toBe('circle:radius')
    expect(channelKeyOf({ kind: 'node', nodeId: 'n1', property: 'opacity' })).toBe('property:opacity')
  })
})

describe('ExtractToClipCommand - new clip', () => {
  it('creates a new clip with normalized keyframes, preserves interp/tangents, and validates 0..1', () => {
    const { engine, dispatcher } = setupEngine()
    const activeSlide = engine.getActiveSlide()!
    const node = engine.createNode(activeSlide.scene.id, activeSlide.scene.root.id, 'Box')
    // Create node keyframes at t=1,2,4 with bezier tangents
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 1, 0)
    // The first added will be at 1, but we need 3 keyframes for extraction test
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 2, 10)
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 4, 20)
    // Set second keyframe to bezier with tangents
    const second = engine.getKeyframes(node.id, 'positionX').find((k) => k.time === 2)!
    engine.setKeyframeInterpolation({ kind: 'node', nodeId: node.id, property: 'positionX' }, second.id, 'bezier')
    engine.setKeyframeTangents({ kind: 'node', nodeId: node.id, property: 'positionX' }, second.id, { time: -0.3, value: 1 }, { time: 0.3, value: 1 })

    const all = engine.getKeyframes(node.id, 'positionX')
    const extractable: ExtractableKeyframe[] = all.map((kf) => ({
      target: { kind: 'node', nodeId: node.id, property: 'positionX' },
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))

    const result = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: extractable,
        name: 'MyExtracted',
        duration: undefined,
        category: 'extracted',
      }),
    )
    expect(result.ok).toBe(true)
    const clips = engine.clips
    expect(clips).toHaveLength(1)
    const clip = clips[0]!
    expect(clip.name).toBe('MyExtracted')
    expect(clip.duration).toBeCloseTo(3) // selDuration 3
    expect(clip.category).toBe('extracted')
    const clipKfs = clip.getChannelKeyframes('positionX')
    expect(clipKfs).toHaveLength(3)
    expect(clipKfs[0].time).toBeCloseTo(0)
    expect(clipKfs[1].time).toBeCloseTo(1/3)
    expect(clipKfs[2].time).toBeCloseTo(1)
    // Values preserved
    expect(clipKfs[0].value).toBe(0)
    expect(clipKfs[1].value).toBe(10)
    // Interpolation preserved
    expect(clipKfs[1].interpolation).toBe('bezier')
    // Tangents normalized: original -0.3 /3 = -0.1
    expect(clipKfs[1].tangentIn.time).toBeCloseTo(-0.1)
    expect(clipKfs[1].tangentOut.time).toBeCloseTo(0.1)
    // Original node keyframes unchanged (copy not move)
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(3)
  })

  it('merges channels: extracting across properties creates multiple channels', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'N1')
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 0, 5)
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'opacity' }, 0, 0.2)
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'opacity' }, 1, 0.8)

    const posKfs = engine.getKeyframes(n1.id, 'positionX').map((kf) => ({
      target: { kind: 'node' as const, nodeId: n1.id, property: 'positionX' as const },
      time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
    }))
    const opKfs = engine.getKeyframes(n1.id, 'opacity').map((kf) => ({
      target: { kind: 'node' as const, nodeId: n1.id, property: 'opacity' as const },
      time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
    }))

    const result = dispatcher.dispatch(new ExtractToClipCommand({ keyframes: [...posKfs, ...opKfs], name: 'Mixed', category: 'test' }))
    expect(result.ok).toBe(true)
    const clip = engine.clips[0]!
    expect(clip.getChannelKeyframes('positionX')).toHaveLength(1)
    expect(clip.getChannelKeyframes('opacity')).toHaveLength(2)
    // opacity values validated 0..1
    expect(clip.getChannelKeyframes('opacity')[0].value).toBe(0.2)
  })

  it('handles visible and circle angles', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'CircleNode', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 90 } },
    })
    engine.addKeyframe({ kind: 'visible', nodeId: n1.id }, 0, true)
    engine.addKeyframe({ kind: 'visible', nodeId: n1.id }, 2, false)
    engine.addKeyframe({ kind: 'circle', nodeId: n1.id, property: 'radius' }, 0, 10)
    engine.addKeyframe({ kind: 'circle', nodeId: n1.id, property: 'radius' }, 2, 20)

    const visKfs = engine.getVisibleKeyframes(n1.id).map((kf) => ({
      target: { kind: 'visible' as const, nodeId: n1.id },
      time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
    }))
    const radKfs = engine.getCircleKeyframes(n1.id, 'radius').map((kf) => ({
      target: { kind: 'circle' as const, nodeId: n1.id, property: 'radius' as const },
      time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
    }))

    const result = dispatcher.dispatch(new ExtractToClipCommand({ keyframes: [...visKfs, ...radKfs], name: 'VisCircle' }))
    expect(result.ok).toBe(true)
    const clip = engine.clips[0]!
    expect(clip.getVisibleKeyframes()).toHaveLength(2)
    expect(clip.getVisibleKeyframes()[0].value).toBe(true)
    expect(clip.getVisibleKeyframes()[0].time).toBe(0)
    expect(clip.getVisibleKeyframes()[1].time).toBe(1) // normalized 2/2
    expect(clip.getCircleKeyframes('radius')).toHaveLength(2)
    expect(clip.getCircleKeyframes('radius')[0].value).toBe(10)
  })
})

describe('ExtractToClipCommand - append to existing', () => {
  it('appends and merges channels', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 0, 0)
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 2, 20)

    // Create initial clip with one channel
    const createRes = dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: engine.getKeyframes(n1.id, 'positionX').map((kf) => ({
        target: { kind: 'node' as const, nodeId: n1.id, property: 'positionX' as const },
        time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
      })),
      name: 'Existing',
    }))
    expect(createRes.ok).toBe(true)
    const clipId = engine.clips[0]!.id
    const beforeCount = engine.getClip(clipId).getChannelKeyframes('positionX').length
    expect(beforeCount).toBe(2)

    // Add another node's opacity keyframes and append
    const n2 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box2')
    engine.addKeyframe({ kind: 'node', nodeId: n2.id, property: 'opacity' }, 1, 0.5)
    engine.addKeyframe({ kind: 'node', nodeId: n2.id, property: 'opacity' }, 3, 1)

    const appended = dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: engine.getKeyframes(n2.id, 'opacity').map((kf) => ({
        target: { kind: 'node' as const, nodeId: n2.id, property: 'opacity' as const },
        time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
      })),
      clipId,
    }))
    expect(appended.ok).toBe(true)
    const clip = engine.getClip(clipId)
    // Should have both channels now
    expect(clip.getChannelKeyframes('positionX')).toHaveLength(2)
    expect(clip.getChannelKeyframes('opacity')).toHaveLength(2)
    // Times normalized per extraction: second extraction sel 1..3 duration 2 -> times 0,1
    expect(clip.getChannelKeyframes('opacity')[0].time).toBe(0)
    expect(clip.getChannelKeyframes('opacity')[1].time).toBe(1)
  })

  it('rejects duplicate normalized time on same channel', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 0, 0)
    dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: engine.getKeyframes(n1.id, 'positionX').map((kf) => ({
        target: { kind: 'node' as const, nodeId: n1.id, property: 'positionX' as const },
        time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
      })),
      name: 'Existing',
    }))
    const clipId = engine.clips[0]!.id
    // Now try to append a keyframe that will normalize to 0, which already exists
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 5, 100)
    const dupKf = engine.getKeyframes(n1.id, 'positionX').find((k) => k.time === 5)!
    const result = dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: [{
        target: { kind: 'node', nodeId: n1.id, property: 'positionX' },
        time: dupKf.time, value: dupKf.value, interpolation: dupKf.interpolation, tangentIn: dupKf.tangentIn, tangentOut: dupKf.tangentOut, keyframeId: dupKf.id,
      }],
      clipId,
    }))
    // Single keyframe extraction with selDuration 0 -> normalized 0, which collides with existing time 0
    expect(result.ok).toBe(false)
  })
})

describe('ExtractToClipCommand undo', () => {
  it('undo new clip creation restores empty', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 0, 0)
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 1, 10)

    const extractable = engine.getKeyframes(n1.id, 'positionX').map((kf) => ({
      target: { kind: 'node' as const, nodeId: n1.id, property: 'positionX' as const },
      time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
    }))

    dispatcher.dispatch(new ExtractToClipCommand({ keyframes: extractable, name: 'Clip1' }))
    expect(engine.clips).toHaveLength(1)
    undoStack.undo(engine as unknown as import('../../engine/internal').Engine)
    expect(engine.clips).toHaveLength(0)
    // redo
    undoStack.redo(engine as unknown as import('../../engine/internal').Engine)
    expect(engine.clips).toHaveLength(1)
    expect(engine.clips[0]!.name).toBe('Clip1')
  })

  it('undo append restores pre-extraction state', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 0, 0)
    const firstClip = dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: engine.getKeyframes(n1.id, 'positionX').map((kf) => ({
        target: { kind: 'node' as const, nodeId: n1.id, property: 'positionX' as const },
        time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
      })),
      name: 'C1',
    }))
    expect(firstClip.ok).toBe(true)
    const clipId = engine.clips[0]!.id
    const beforeJson = engine.clips[0]!.toJSON()

    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'opacity' }, 0, 0)
    const op = engine.getKeyframes(n1.id, 'opacity')[0]!
    dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: [{ target: { kind: 'node', nodeId: n1.id, property: 'opacity' }, time: op.time, value: op.value, interpolation: op.interpolation, tangentIn: op.tangentIn, tangentOut: op.tangentOut, keyframeId: op.id }],
      clipId,
    }))
    expect(engine.getClip(clipId).getChannelKeyframes('opacity')).toHaveLength(1)
    undoStack.undo(engine as unknown as import('../../engine/internal').Engine)
    const restored = engine.getClip(clipId)
    expect(restored.getChannelKeyframes('opacity')).toHaveLength(0)
    expect(restored.toJSON()).toEqual(beforeJson)
  })

  it('original node keyframes remain after extraction (copy not move)', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const n1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 0, 0)
    engine.addKeyframe({ kind: 'node', nodeId: n1.id, property: 'positionX' }, 1, 10)
    const before = engine.getKeyframes(n1.id, 'positionX').map((k) => k.time)
    dispatcher.dispatch(new ExtractToClipCommand({
      keyframes: engine.getKeyframes(n1.id, 'positionX').map((kf) => ({
        target: { kind: 'node' as const, nodeId: n1.id, property: 'positionX' as const },
        time: kf.time, value: kf.value, interpolation: kf.interpolation, tangentIn: kf.tangentIn, tangentOut: kf.tangentOut, keyframeId: kf.id,
      })),
      name: 'Copy',
    }))
    const after = engine.getKeyframes(n1.id, 'positionX').map((k) => k.time)
    expect(after).toEqual(before)
  })
})
