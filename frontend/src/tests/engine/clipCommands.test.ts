import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import type { ClipChannelTarget } from '../../engine/keyframeTarget'
import type { AnimationProperty } from '../../engine/animationProperties'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
  CreateClipCommand,
  DeleteClipCommand,
  RenameClipCommand,
  DuplicateClipCommand,
  SetClipDurationCommand,
  SetClipCategoryCommand,
  SetClipParamDefaultCommand,
  SetClipChannelParamLinkCommand,
  AddClipKeyframeCommand,
  DeleteClipKeyframesCommand,
  MoveClipKeyframesCommand,
  SetClipKeyframeValueCommand,
  ScaleClipKeyframesCommand,
  SetClipKeyframeInterpolationCommand,
  SetClipKeyframeTangentsCommand,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupBase(log?: CommandLogger): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  return { engine, dispatcher, undoStack }
}

function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

function clipTarget(clipId: string, channel: AnimationProperty = 'positionX'): ClipChannelTarget {
  return { kind: 'clip', clipId, channel }
}

function createTestClip(setup: Setup, name = 'TestClip', duration = 1): string {
  const inverse = expectOk(
    setup.dispatcher.dispatch(
      new CreateClipCommand({
        name,
        duration,
        category: 'test',
        params: [{ key: 'gain', label: 'Gain', kind: 'float', default: 1 }],
        channels: [{ property: 'positionX', paramKey: 'gain' }, { property: 'opacity' }],
      }),
    ),
  )
  return inverse.clipId
}

function addClipKeyframe(
  setup: Setup,
  target: ClipChannelTarget,
  time: number,
  value: number,
): string {
  const inverse = expectOk(
    setup.dispatcher.dispatch(new AddClipKeyframeCommand({ target, time, value })),
  )
  return inverse.keyframe.keyframeId
}

describe('CreateClipCommand', () => {
  it('creates a clip with inverse data, the ClipCreated event, and a log line', () => {
    const log = vi.fn()
    const setup = setupBase(log)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'FadeIn',
        duration: 2,
        category: 'transition',
        params: [{ key: 'gain', label: 'Gain', kind: 'float', default: 1 }],
        channels: [{ property: 'positionX', paramKey: 'gain' }],
      }),
    )

    const inverse = expectOk(result)
    expect(inverse.clipId).toBeTruthy()
    expect(setup.engine.clips).toHaveLength(1)
    expect(setup.engine.getClip(inverse.clipId).name).toBe('FadeIn')
    expect(setup.engine.getClip(inverse.clipId).duration).toBe(2)
    expect(setup.engine.getClip(inverse.clipId).category).toBe('transition')
    expect(events).toEqual([{ type: 'ClipCreated', clipId: inverse.clipId }])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('CreateClip'))
  })

  it('rejects invalid name or duration with the engine unchanged', () => {
    const setup = setupBase()
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const results = [
      setup.dispatcher.dispatch(new CreateClipCommand({ name: '', duration: 1 })),
      setup.dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: -1 })),
    ]

    for (const result of results) {
      expect(result.ok).toBe(false)
    }
    expect(setup.engine.clips).toHaveLength(0)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('DeleteClipCommand', () => {
  it('deletes an unreferenced clip with inverse data and ClipRemoved event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(new DeleteClipCommand({ clipId }))

    const inverse = expectOk(result)
    expect(setup.engine.clips).toHaveLength(0)
    expect(inverse.clipId).toBe(clipId)
    expect(inverse.clipData).toMatchObject({ name: 'TestClip', duration: 1 })
    expect(events).toEqual([{ type: 'ClipRemoved', clipId }])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
  })

  it('rejects deleting a clip that is referenced by a node', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    // Create a slide and node to reference the clip via clip instance
    expectOk(setup.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = setup.engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')
    const node = setup.engine.createNode(slide.scene.id, slide.scene.root.id, 'MyNode')
    setup.engine.assignClipInstance(node.id, clipId, 0, 1, true, {})
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(new DeleteClipCommand({ clipId }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('MyNode')
    }
    expect(setup.engine.clips).toHaveLength(1)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects deleting a non-existent clip', () => {
    const setup = setupBase()
    const result = setup.dispatcher.dispatch(new DeleteClipCommand({ clipId: 'ghost' }))
    expect(result.ok).toBe(false)
  })
})

describe('RenameClipCommand', () => {
  it('renames a clip with inverse old name and ClipRenamed event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(new RenameClipCommand({ clipId, name: 'NewName' }))

    const inverse = expectOk(result)
    expect(setup.engine.getClip(clipId).name).toBe('NewName')
    expect(inverse).toEqual({ clipId, oldName: 'TestClip' })
    expect(events).toEqual([{ type: 'ClipRenamed', clipId }])
  })

  it('rejects empty name or unchanged name', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    expect(setup.dispatcher.dispatch(new RenameClipCommand({ clipId, name: '' })).ok).toBe(false)
    expect(setup.dispatcher.dispatch(new RenameClipCommand({ clipId, name: 'TestClip' })).ok).toBe(
      false,
    )
    expect(events).toEqual([])
    expect(setup.undoStack.entries).toHaveLength(undoCount)
  })
})

describe('DuplicateClipCommand', () => {
  it('creates a copy with a new id and ClipDuplicated event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    addClipKeyframe(setup, clipTarget(clipId), 0, 0)
    addClipKeyframe(setup, clipTarget(clipId), 1, 100)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(new DuplicateClipCommand({ clipId }))

    const inverse = expectOk(result)
    expect(inverse.clipId).not.toBe(clipId)
    expect(setup.engine.clips).toHaveLength(2)
    expect(setup.engine.getClip(inverse.clipId).name).toBe('TestClip')
    expect(setup.engine.getClipChannelKeyframes(inverse.clipId, 'positionX')).toHaveLength(2)
    expect(events).toEqual([{ type: 'ClipDuplicated', clipId: inverse.clipId }])
  })
})

describe('SetClipDurationCommand', () => {
  it('changes duration with inverse old duration and ClipDurationChanged event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(new SetClipDurationCommand({ clipId, duration: 5 }))

    const inverse = expectOk(result)
    expect(setup.engine.getClip(clipId).duration).toBe(5)
    expect(inverse).toEqual({ clipId, oldDuration: 1 })
    expect(events).toEqual([{ type: 'ClipDurationChanged', clipId }])
  })

  it('rejects negative duration', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const result = setup.dispatcher.dispatch(new SetClipDurationCommand({ clipId, duration: -2 }))
    expect(result.ok).toBe(false)
    expect(setup.engine.getClip(clipId).duration).toBe(1)
  })
})

describe('SetClipCategoryCommand', () => {
  it('changes category with inverse old category and ClipCategoryChanged event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetClipCategoryCommand({ clipId, category: 'new-cat' }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getClip(clipId).category).toBe('new-cat')
    expect(inverse).toEqual({ clipId, oldCategory: 'test' })
    expect(events).toEqual([{ type: 'ClipCategoryChanged', clipId }])
  })
})

describe('SetClipParamDefaultCommand', () => {
  it('changes param default with inverse old value and ClipParamDefaultChanged event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetClipParamDefaultCommand({ clipId, paramKey: 'gain', defaultValue: 2.5 }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getClip(clipId).getParam('gain')?.default).toBe(2.5)
    expect(inverse).toEqual({ clipId, paramKey: 'gain', oldValue: 1 })
    expect(events).toEqual([{ type: 'ClipParamDefaultChanged', clipId, paramKey: 'gain' }])
  })

  it('rejects unknown param key', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const result = setup.dispatcher.dispatch(
      new SetClipParamDefaultCommand({ clipId, paramKey: 'ghost', defaultValue: 1 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('SetClipChannelParamLinkCommand', () => {
  it('links a channel to a param with inverse old link and ClipChannelLinkChanged event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetClipChannelParamLinkCommand({
        clipId,
        channel: 'positionX',
        paramKey: null,
      }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getClip(clipId).getChannel('positionX')?.paramKey).toBeUndefined()
    expect(inverse).toEqual({ clipId, channel: 'positionX', oldParamKey: 'gain' })
    expect(events).toEqual([{ type: 'ClipChannelLinkChanged', clipId, channel: 'positionX' }])
  })

  it('rejects unknown channel or param', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    expect(
      setup.dispatcher.dispatch(
        new SetClipChannelParamLinkCommand({
          clipId,
          channel: 'rotation',
          paramKey: 'gain',
        }),
      ).ok,
    ).toBe(false)
    expect(
      setup.dispatcher.dispatch(
        new SetClipChannelParamLinkCommand({
          clipId,
          channel: 'positionX',
          paramKey: 'ghost',
        }),
      ).ok,
    ).toBe(false)
  })
})

describe('clip keyframe commands', () => {
  function setupWithClip(): Setup & { clipId: string } {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    return { ...setup, clipId }
  }

  describe('AddClipKeyframeCommand', () => {
    it('adds a keyframe with inverse and KeyframeAdded event', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const events = collectEvents(setup.engine)
      const undoCount = setup.undoStack.entries.length

      const result = setup.dispatcher.dispatch(
        new AddClipKeyframeCommand({ target, time: 0.5, value: 0.75 }),
      )

      const inverse = expectOk(result)
      expect(setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')).toHaveLength(1)
      expect(inverse.keyframe).toMatchObject({ time: 0.5, value: 0.75 })
      expect(events).toEqual([
        { type: 'KeyframeAdded', target, keyframeId: inverse.keyframe.keyframeId },
      ])
      expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
    })

    it('rejects time outside [0,1] and non-existent clip/channel', () => {
      const setup = setupWithClip()
      const undoCount = setup.undoStack.entries.length

      expect(
        setup.dispatcher.dispatch(
          new AddClipKeyframeCommand({ target: clipTarget('ghost'), time: 0.5, value: 1 }),
        ).ok,
      ).toBe(false)
      expect(
        setup.dispatcher.dispatch(
          new AddClipKeyframeCommand({
            target: clipTarget(setup.clipId, 'rotation'),
            time: 0.5,
            value: 1,
          }),
        ).ok,
      ).toBe(false)
      expect(
        setup.dispatcher.dispatch(
          new AddClipKeyframeCommand({ target: clipTarget(setup.clipId), time: -0.1, value: 1 }),
        ).ok,
      ).toBe(false)
      expect(
        setup.dispatcher.dispatch(
          new AddClipKeyframeCommand({ target: clipTarget(setup.clipId), time: 1.1, value: 1 }),
        ).ok,
      ).toBe(false)
      expect(setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')).toHaveLength(0)
      expect(setup.undoStack.entries).toHaveLength(undoCount)
    })

    it('rejects a time already occupied on the same channel', () => {
      const setup = setupWithClip()
      addClipKeyframe(setup, clipTarget(setup.clipId), 0.5, 0)
      const events = collectEvents(setup.engine)
      const undoCount = setup.undoStack.entries.length

      const result = setup.dispatcher.dispatch(
        new AddClipKeyframeCommand({ target: clipTarget(setup.clipId), time: 0.5, value: 1 }),
      )

      expect(result.ok).toBe(false)
      expect(setup.undoStack.entries).toHaveLength(undoCount)
      expect(events).toEqual([])
    })
  })

  describe('DeleteClipKeyframesCommand', () => {
    it('deletes keyframes with inverse and KeyframeRemoved events', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const first = addClipKeyframe(setup, target, 0, 0)
      const second = addClipKeyframe(setup, target, 0.5, 50)
      const events = collectEvents(setup.engine)
      const undoCount = setup.undoStack.entries.length

      const result = setup.dispatcher.dispatch(
        new DeleteClipKeyframesCommand({ target, keyframeIds: [first, second] }),
      )

      const inverse = expectOk(result)
      expect(setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')).toHaveLength(0)
      expect(inverse.keyframes).toHaveLength(2)
      expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
      expect(events).toEqual([
        { type: 'KeyframeRemoved', target, keyframeId: first },
        { type: 'KeyframeRemoved', target, keyframeId: second },
      ])
    })

    it('rejects the whole batch when any id is unknown', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const first = addClipKeyframe(setup, target, 0, 0)
      const events = collectEvents(setup.engine)

      const result = setup.dispatcher.dispatch(
        new DeleteClipKeyframesCommand({ target, keyframeIds: [first, 'ghost'] }),
      )

      expect(result.ok).toBe(false)
      expect(setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')).toHaveLength(1)
      expect(events).toEqual([])
    })

    it('channel disappears when its last keyframe is deleted', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const kfId = addClipKeyframe(setup, target, 0.5, 50)
      expect(setup.engine.getClip(setup.clipId).hasChannel('positionX')).toBe(true)

      expectOk(
        setup.dispatcher.dispatch(new DeleteClipKeyframesCommand({ target, keyframeIds: [kfId] })),
      )
      expect(setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')).toHaveLength(0)
      // Channel definition is removed when last keyframe is deleted (Spec: "a channel exists while it has >= 1 keyframe")
      expect(setup.engine.getClip(setup.clipId).hasChannel('positionX')).toBe(false)
    })
  })

  describe('MoveClipKeyframesCommand', () => {
    it('moves keyframes with inverse old times and KeyframeMoved events', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const first = addClipKeyframe(setup, target, 0, 0)
      const second = addClipKeyframe(setup, target, 0.5, 50)
      const events = collectEvents(setup.engine)

      const result = setup.dispatcher.dispatch(
        new MoveClipKeyframesCommand({
          target,
          moves: [
            { keyframeId: first, newTime: 0.3 },
            { keyframeId: second, newTime: 0.8 },
          ],
        }),
      )

      const inverse = expectOk(result)
      expect(inverse.moves).toEqual([
        { keyframeId: first, oldTime: 0 },
        { keyframeId: second, oldTime: 0.5 },
      ])
      expect(
        setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX').map((kf) => kf.time),
      ).toEqual([0.3, 0.8])
      expect(events).toEqual([
        { type: 'KeyframeMoved', target, keyframeId: first },
        { type: 'KeyframeMoved', target, keyframeId: second },
      ])
    })
  })

  describe('SetClipKeyframeValueCommand', () => {
    it('changes value with inverse old value and KeyframeValueChanged event', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const keyframeId = addClipKeyframe(setup, target, 0.5, 0.5)
      const events = collectEvents(setup.engine)

      const result = setup.dispatcher.dispatch(
        new SetClipKeyframeValueCommand({ target, keyframeId, newValue: 0.9 }),
      )

      const inverse = expectOk(result)
      expect(inverse).toEqual({ target, keyframeId, oldValue: 0.5 })
      expect(setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')[0]?.value).toBe(0.9)
      expect(events).toEqual([{ type: 'KeyframeValueChanged', target, keyframeId }])
    })
  })

  describe('ScaleClipKeyframesCommand', () => {
    it('scales around pivot with inverse old times', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const first = addClipKeyframe(setup, target, 0.1, 10)
      const second = addClipKeyframe(setup, target, 0.3, 30)

      const result = setup.dispatcher.dispatch(
        new ScaleClipKeyframesCommand({
          target,
          keyframeIds: [first, second],
          pivot: 0,
          factor: 2,
        }),
      )

      const inverse = expectOk(result)
      expect(
        setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX').map((kf) => kf.time),
      ).toEqual([0.2, 0.6])
      expect(inverse.moves).toEqual([
        { keyframeId: first, oldTime: 0.1 },
        { keyframeId: second, oldTime: 0.3 },
      ])
    })
  })

  describe('SetClipKeyframeInterpolationCommand', () => {
    it('sets interpolation with inverse old and KeyframeInterpolationChanged event', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const keyframeId = addClipKeyframe(setup, target, 0.5, 0.5)
      const events = collectEvents(setup.engine)

      const result = setup.dispatcher.dispatch(
        new SetClipKeyframeInterpolationCommand({
          target,
          keyframeId,
          interpolation: 'bezier',
        }),
      )

      const inverse = expectOk(result)
      expect(inverse).toEqual({
        target,
        keyframeId,
        oldInterpolation: 'linear',
      })
      expect(events).toEqual([{ type: 'KeyframeInterpolationChanged', target, keyframeId }])
    })
  })

  describe('SetClipKeyframeTangentsCommand', () => {
    it('sets tangents with inverse old tangents and KeyframeTangentsChanged event', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)
      const keyframeId = addClipKeyframe(setup, target, 0.5, 0.5)
      const events = collectEvents(setup.engine)

      const result = setup.dispatcher.dispatch(
        new SetClipKeyframeTangentsCommand({
          target,
          keyframeId,
          tangentIn: { time: -0.2, value: 0.3 },
          tangentOut: { time: 0.2, value: 0.3 },
        }),
      )

      const inverse = expectOk(result)
      expect(inverse).toEqual({
        target,
        keyframeId,
        oldTangentIn: { time: 0, value: 0 },
        oldTangentOut: { time: 0, value: 0 },
      })
      expect(events).toEqual([{ type: 'KeyframeTangentsChanged', target, keyframeId }])
    })
  })

  describe('new keyframes inherit previous interpolation', () => {
    it('inherits interpolation from the previous keyframe on the same channel', () => {
      const setup = setupWithClip()
      const target = clipTarget(setup.clipId)

      // Add first keyframe with linear (default)
      const first = addClipKeyframe(setup, target, 0, 0)
      // Change it to bezier
      expectOk(
        setup.dispatcher.dispatch(
          new SetClipKeyframeInterpolationCommand({
            target,
            keyframeId: first,
            interpolation: 'bezier',
          }),
        ),
      )

      // Add second keyframe after the first
      const secondId = addClipKeyframe(setup, target, 0.5, 50)

      // The second keyframe should inherit 'bezier' from the first
      const kfs = setup.engine.getClipChannelKeyframes(setup.clipId, 'positionX')
      expect(kfs.find((kf) => kf.id === secondId)?.interpolation).toBe('bezier')
    })
  })
})

describe('clip serialization round-trip', () => {
  it('serializes and deserializes clip data through the project', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const target = clipTarget(clipId)
    addClipKeyframe(setup, target, 0, 0)
    addClipKeyframe(setup, target, 0.5, 0.5)
    addClipKeyframe(setup, target, 1, 1)
    // Change interpolation on second keyframe
    const kfs = setup.engine.getClipChannelKeyframes(clipId, 'positionX')
    const secondKf = kfs[1]!
    expectOk(
      setup.dispatcher.dispatch(
        new SetClipKeyframeInterpolationCommand({
          target,
          keyframeId: secondKf.id,
          interpolation: 'bezier',
        }),
      ),
    )
    expectOk(
      setup.dispatcher.dispatch(
        new SetClipKeyframeTangentsCommand({
          target,
          keyframeId: secondKf.id,
          tangentIn: { time: -0.1, value: 0.2 },
          tangentOut: { time: 0.1, value: 0.2 },
        }),
      ),
    )

    // Serialize
    const json = setup.engine.toJSON()
    expect(json.library?.clips).toHaveLength(1)
    const clipJson = json.library!.clips![0]!
    expect(clipJson.name).toBe('TestClip')
    expect(clipJson.duration).toBe(1)
    expect(clipJson.channels).toHaveLength(2)

    // Deserialize into a fresh engine
    const engine2 = createEngine()
    engine2.restoreFromJSON(json)
    expect(engine2.clips).toHaveLength(1)
    const restored = engine2.getClip(clipId)
    expect(restored.name).toBe('TestClip')
    expect(restored.duration).toBe(1)
    expect(restored.category).toBe('test')
    expect(restored.getParam('gain')?.default).toBe(1)
    expect(restored.getChannel('positionX')?.paramKey).toBe('gain')
    const restoredKfs = engine2.getClipChannelKeyframes(clipId, 'positionX')
    expect(restoredKfs).toHaveLength(3)
    expect(restoredKfs[0]?.time).toBe(0)
    expect(restoredKfs[0]?.value).toBe(0)
    expect(restoredKfs[1]?.interpolation).toBe('bezier')
    expect(restoredKfs[1]?.tangentIn).toEqual({ time: -0.1, value: 0.2 })
    expect(restoredKfs[2]?.time).toBe(1)
    expect(restoredKfs[2]?.value).toBe(1)
  })
})
