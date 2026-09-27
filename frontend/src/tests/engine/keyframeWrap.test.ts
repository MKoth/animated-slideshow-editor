import { describe, expect, it } from 'vitest'
import { Keyframe, requireKeyframeWrap, ZERO_TANGENT } from '../../engine/keyframe'
import type { InterpolationType } from '../../engine/keyframe'
import { evaluateSegment } from '../../engine/interpolators'
import { evaluateControlTrack, controlTrackKeyframeFromJSON } from '../../engine/control'
import { ClipChannelAnimation } from '../../engine/clipDefinition'
import {
  AddKeyframeCommand,
  AddClipKeyframeCommand,
  CommandDispatcher,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetKeyframeWrapCommand,
  SetKeyframeInterpolationCommand,
  SetClipKeyframeWrapCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import type { CommandResult } from '../../engine/commands'

function wrapKeyframe(time: number, value: number, wrap = true): Keyframe {
  return new Keyframe(
    `kf-${time}-${value}`,
    time,
    value,
    'linear',
    ZERO_TANGENT,
    ZERO_TANGENT,
    false,
    undefined,
    wrap,
  )
}

function plainKeyframe(
  time: number,
  value: number,
  interpolation: InterpolationType = 'linear',
): Keyframe {
  return new Keyframe(`kf-${time}-${value}`, time, value, interpolation)
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupEngine(): { engine: Engine; dispatcher: CommandDispatcher; undoStack: UndoStack } {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'Wrap' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  return { engine, dispatcher, undoStack }
}

describe('wrap-around linear interpolation', () => {
  it('goes 0.2 → 0 → 1 → 0.75 instead of straight forward', () => {
    const from = wrapKeyframe(0, 0.2)
    const to = plainKeyframe(1, 0.75)
    expect(evaluateSegment(from, to, 0)).toBeCloseTo(0.2)
    expect(evaluateSegment(from, to, 1)).toBeCloseTo(0.75)
    // wrapped delta is -0.45, so the midpoint dips through the boundary
    expect(evaluateSegment(from, to, 0.5)).toBeCloseTo(0.975)
    expect(evaluateSegment(from, to, 0.25)).toBeCloseTo(0.0875)
  })

  it('wraps the other direction for 0.75 → 0.2', () => {
    const from = wrapKeyframe(0, 0.75)
    const to = plainKeyframe(1, 0.2)
    expect(evaluateSegment(from, to, 0.5)).toBeCloseTo(0.975)
    expect(evaluateSegment(from, to, 1)).toBeCloseTo(0.2)
  })

  it('stays constant when both values are equal', () => {
    const from = wrapKeyframe(0, 0.4)
    const to = plainKeyframe(1, 0.4)
    expect(evaluateSegment(from, to, 0.5)).toBeCloseTo(0.4)
  })

  it('is inert without the flag (direct path)', () => {
    const from = plainKeyframe(0, 0.2)
    const to = plainKeyframe(1, 0.75)
    expect(evaluateSegment(from, to, 0.5)).toBeCloseTo(0.475)
  })

  it('is inert for bezier segments even with the flag set', () => {
    const from = new Keyframe(
      'a',
      0,
      0.2,
      'bezier',
      ZERO_TANGENT,
      ZERO_TANGENT,
      false,
      undefined,
      true,
    )
    const to = new Keyframe('b', 2, 0.75, 'bezier')
    expect(evaluateSegment(from, to, 1)).toBeCloseTo(0.475)
  })

  it('is inert for out-of-range absolute values even with the flag set', () => {
    const from = wrapKeyframe(1, 10)
    const to = plainKeyframe(3, 30)
    expect(evaluateSegment(from, to, 2)).toBe(20)
  })
})

describe('wrap on control tracks', () => {
  it('evaluates a wrapped control segment through the boundary', () => {
    const kfs = [wrapKeyframe(0, 0.2), plainKeyframe(10, 0.75)]
    expect(evaluateControlTrack(kfs, 0, 0)).toBeCloseTo(0.2)
    expect(evaluateControlTrack(kfs, 10, 0)).toBeCloseTo(0.75)
    expect(evaluateControlTrack(kfs, 5, 0)).toBeCloseTo(0.975)
  })

  it('round-trips wrap through control track JSON', () => {
    const json = wrapKeyframe(2, 0.2).toJSON()
    expect(json.wrap).toBe(true)
    const parsed = controlTrackKeyframeFromJSON(json, 10)
    expect(parsed?.wrap).toBe(true)
    const plain = controlTrackKeyframeFromJSON(plainKeyframe(2, 0.2).toJSON(), 10)
    expect(plain?.wrap).toBe(false)
  })
})

describe('wrap on clip channels', () => {
  it('round-trips wrap through clip channel JSON', () => {
    const anim = new ClipChannelAnimation()
    anim.add(wrapKeyframe(0, 0.2))
    anim.add(plainKeyframe(1, 0.75))
    const restored = ClipChannelAnimation.fromJSON(anim.toJSON())
    expect(restored.keyframes()[0]?.wrap).toBe(true)
    expect(restored.keyframes()[1]?.wrap).toBe(false)
  })
})

describe('SetKeyframeWrapCommand on node opacity', () => {
  it('sets wrap, drives evaluation through the boundary, and undoes', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')
    const { nodeId } = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    const target = { kind: 'node', nodeId, property: 'opacity' } as const
    const first = expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target, time: 0, value: 0.2 })),
    )
    expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target, time: slide.duration, value: 0.75 })),
    )

    expect(engine.evaluateNode(nodeId, slide.duration / 2).opacity).toBeCloseTo(0.475)

    const inverse = expectOk(
      dispatcher.dispatch(
        new SetKeyframeWrapCommand({ target, keyframeId: first.keyframe.keyframeId, wrap: true }),
      ),
    )
    expect(inverse.oldWrap).toBe(false)
    expect(engine.evaluateNode(nodeId, slide.duration / 2).opacity).toBeCloseTo(0.975)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.evaluateNode(nodeId, slide.duration / 2).opacity).toBeCloseTo(0.475)
  })

  it('rejects wrap on absolute tracks and non-linear keyframes', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')
    const { nodeId } = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    const posTarget = { kind: 'node', nodeId, property: 'positionX' } as const
    const pos = expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target: posTarget, time: 0, value: 0.2 })),
    )
    const rejected = dispatcher.dispatch(
      new SetKeyframeWrapCommand({
        target: posTarget,
        keyframeId: pos.keyframe.keyframeId,
        wrap: true,
      }),
    )
    expect(rejected.ok).toBe(false)

    // clearing the flag is always allowed, even on absolute tracks
    const cleared = expectOk(
      dispatcher.dispatch(
        new SetKeyframeWrapCommand({
          target: posTarget,
          keyframeId: pos.keyframe.keyframeId,
          wrap: false,
        }),
      ),
    )
    expect(cleared.oldWrap).toBe(false)

    // wrap requires linear interpolation on the keyframe itself
    const slide2 = dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' }))
    void slide2
    const opacityTarget = { kind: 'node', nodeId, property: 'opacity' } as const
    const op = expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target: opacityTarget, time: 0, value: 0.2 })),
    )
    expectOk(
      dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({
          target: opacityTarget,
          keyframeId: op.keyframe.keyframeId,
          interpolation: 'bezier',
        }),
      ),
    )
    const bezierRejected = dispatcher.dispatch(
      new SetKeyframeWrapCommand({
        target: opacityTarget,
        keyframeId: op.keyframe.keyframeId,
        wrap: true,
      }),
    )
    expect(bezierRejected.ok).toBe(false)
  })
})

describe('SetClipKeyframeWrapCommand', () => {
  it('sets wrap on the opacity channel and rejects other channels', () => {
    const { dispatcher, engine } = setupEngine()
    const { clipId } = expectOk(
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Fade',
          duration: 1,
          category: 'test',
          params: [],
          channels: [{ property: 'opacity' }, { property: 'positionX' }],
        }),
      ),
    )
    const first = expectOk(
      dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'opacity' },
          time: 0,
          value: 0.2,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'opacity' },
          time: 1,
          value: 0.75,
        }),
      ),
    )
    const inverse = expectOk(
      dispatcher.dispatch(
        new SetClipKeyframeWrapCommand({
          target: { kind: 'clip', clipId, channel: 'opacity' },
          keyframeId: first.keyframe.keyframeId,
          wrap: true,
        }),
      ),
    )
    expect(inverse.oldWrap).toBe(false)
    expect(
      engine.getClip(clipId).getChannelKeyframe('opacity', first.keyframe.keyframeId)?.wrap,
    ).toBe(true)

    const pos = expectOk(
      dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'positionX' },
          time: 0,
          value: 5,
        }),
      ),
    )
    const rejected = dispatcher.dispatch(
      new SetClipKeyframeWrapCommand({
        target: { kind: 'clip', clipId, channel: 'positionX' },
        keyframeId: pos.keyframe.keyframeId,
        wrap: true,
      }),
    )
    expect(rejected.ok).toBe(false)
  })
})

describe('requireKeyframeWrap', () => {
  it('defaults absent to false and rejects non-booleans', () => {
    expect(requireKeyframeWrap(undefined)).toBe(false)
    expect(requireKeyframeWrap(true)).toBe(true)
    expect(() => requireKeyframeWrap('yes')).toThrow()
  })
})
