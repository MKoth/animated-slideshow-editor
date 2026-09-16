import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  ExtractToClipCommand,
  AssignClipCommand,
  ReverseClipCommand,
} from '../../engine/commands'
import {
  getAnimatedParams,
  getOrphanKeyframes,
  hasAnyKeyframe,
} from '../../engine/animationManagerModel'
import { isClipStorableTarget } from '../../engine/timeSegmentExtraction'
import { ClipDefinition } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from '../../engine/keyframe'

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

function addZKeyframes(engine: Engine, nodeId: string, points: [number, number][]): void {
  for (const [time, value] of points) {
    engine.addKeyframe({ kind: 'zIndex', nodeId }, time, value)
  }
}

describe('zIndex orphans surface like any other parameter', () => {
  it('lists zIndex animated params, orphans, and animated-child status', () => {
    const { engine } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    addZKeyframes(engine, node.id, [
      [1, 2],
      [3, 5],
    ])
    expect(hasAnyKeyframe(node, slide)).toBe(true)
    const params = getAnimatedParams(node, slide, [], (id) => engine.getClip(id))
    const z = params.find((p) => p.kind === 'zIndex')
    expect(z).toMatchObject({ kind: 'zIndex', key: 'zIndex', label: 'Z-Index' })
    const orphans = getOrphanKeyframes(node, slide, z!)
    expect(orphans.map((k) => k.time)).toEqual([1, 3])
  })

  it('is a clip-storable target for the segment flow', () => {
    expect(isClipStorableTarget({ kind: 'zIndex', nodeId: 'n' })).toBe(true)
  })
})

describe('zIndex clip extraction', () => {
  it('extracts zIndex orphans into a hold-only clip track', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    addZKeyframes(engine, node.id, [
      [1, 2],
      [3, 5],
    ])
    const extractable = engine.getZIndexKeyframes(node.id).map((kf) => ({
      target: { kind: 'zIndex', nodeId: node.id } as const,
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: extractable,
        name: 'Zed',
        category: 'left_hand',
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    expect(clip.hasZIndexTrack()).toBe(true)
    const kfs = clip.getZIndexKeyframes()
    expect(kfs.map((k) => k.time)).toEqual([0, 1])
    expect(kfs.map((k) => k.value)).toEqual([2, 5])
    expect(kfs.every((k) => k.interpolation === 'hold')).toBe(true)
    expect(clip.duration).toBeCloseTo(2)
  })

  it('round-trips zIndexAnimation through JSON with truncation', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    addZKeyframes(engine, node.id, [[1, 2.9]])
    const extractable = engine.getZIndexKeyframes(node.id).map((kf) => ({
      target: { kind: 'zIndex', nodeId: node.id } as const,
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({ keyframes: extractable, name: 'Zed' }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    const json = clip.toJSON() as unknown as Record<string, unknown>
    expect(json.zIndexAnimation).toBeDefined()
    const restored = ClipDefinition.fromJSON(JSON.parse(JSON.stringify(json)))
    expect(restored.hasZIndexTrack()).toBe(true)
    // node-side 2.9 truncates to 2 on clip import
    expect(restored.getZIndexKeyframes()[0]!.value).toBe(2)
  })

  it('reverses the zIndex track', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    addZKeyframes(engine, node.id, [
      [0, 2],
      [2, 9],
    ])
    const extractable = engine.getZIndexKeyframes(node.id).map((kf) => ({
      target: { kind: 'zIndex', nodeId: node.id } as const,
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: kf.tangentIn,
      tangentOut: kf.tangentOut,
      keyframeId: kf.id,
    }))
    const created = dispatcher.dispatch(
      new ExtractToClipCommand({ keyframes: extractable, name: 'Zed' }),
    )
    expect(created.ok).toBe(true)
    const sourceId = engine.clips[0]!.id
    const reversed = dispatcher.dispatch(
      new ReverseClipCommand({ sourceClipId: sourceId, newName: 'Zed Reversed' }),
    )
    expect(reversed.ok).toBe(true)
    if (!reversed.ok) throw new Error('reverse failed')
    const rev = engine.getClip(reversed.inverse.newClipId)
    expect(rev.hasZIndexTrack()).toBe(true)
    expect(rev.getZIndexKeyframes().map((k) => [k.time, k.value])).toEqual([
      [0, 9],
      [1, 2],
    ])
  })
})

describe('zIndex clip evaluation', () => {
  it('layers clip instances last-wins over node keyframes', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    // base: 1 until t=10 then 9
    addZKeyframes(engine, node.id, [
      [0, 1],
      [10, 9],
    ])
    // clip: 7 at u=0, 8 at u=1, duration 2, placed at t=0
    const clip = engine.createClip('Zed', 2, '', [], [])
    clip.addZIndexKeyframe(
      new KeyframeModel(
        newKeyframeId(),
        0,
        7,
        'hold',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    clip.addZIndexKeyframe(
      new KeyframeModel(
        newKeyframeId(),
        1,
        8,
        'hold',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    const assigned = dispatcher.dispatch(
      new AssignClipCommand({ nodeId: node.id, clipId: clip.id, startTime: 0, speed: 1 }),
    )
    expect(assigned.ok).toBe(true)
    // inside the instance the clip wins (u=0.25 → hold from 0 → 7)
    expect(engine.evaluateZIndex(node.id, 0.5)).toBe(7)
    // past the instance the base track shows through
    expect(engine.evaluateZIndex(node.id, 5)).toBe(1)
    expect(engine.evaluateZIndex(node.id, 10)).toBe(9)
  })
})
