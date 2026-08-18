import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import type { KeyframeTarget } from '../../engine/keyframeTarget'
import type { KeyframeTangent } from '../../engine/keyframe'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteKeyframesCommand,
  DuplicateKeyframesCommand,
  MoveKeyframesCommand,
  PasteKeyframesCommand,
  ScaleKeyframesCommand,
  SetKeyframeInterpolationCommand,
  SetKeyframeTangentsCommand,
  SetKeyframeValueCommand,
  TransactionCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'

const CUSTOM_MATERIAL = {
  id: 'mat-params',
  name: 'Params',
  parameters: [
    { key: 'uSteps', kind: 'int', default: 2 },
    { key: 'uGlow', kind: 'float', default: 0.5 },
  ],
}

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  nodeId: string
  cameraId: string
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithNode(log?: CommandLogger): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  return { engine, dispatcher, undoStack, nodeId, cameraId: slide.scene.camera.id }
}

function setupWithMaterialNode(log?: CommandLogger): Setup {
  const setup = setupWithNode(log)
  setup.engine.registerMaterialDefinition(
    CUSTOM_MATERIAL.id,
    CUSTOM_MATERIAL.name,
    CUSTOM_MATERIAL.parameters,
  )
  setup.engine.assignMaterial(setup.nodeId, CUSTOM_MATERIAL.id)
  return setup
}

function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

const propertyTarget = (
  nodeId: string,
  property: 'positionX' | 'opacity' = 'positionX',
): KeyframeTarget => ({
  kind: 'node',
  nodeId,
  property,
})

function addKeyframe(setup: Setup, target: KeyframeTarget, time: number, value: unknown): string {
  const inverse = expectOk(
    setup.dispatcher.dispatch(new AddKeyframeCommand({ target, time, value })),
  )
  return inverse.keyframe.keyframeId
}

describe('AddKeyframeCommand', () => {
  it('executes with inverse data, one history entry, the target-carrying event, and a log line', () => {
    const log = vi.fn()
    const setup = setupWithNode(log)
    const target = propertyTarget(setup.nodeId)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new AddKeyframeCommand({ target, time: 2.5, value: 100 }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(1)
    expect(inverse.keyframe).toMatchObject({ time: 2.5, value: 100 })
    expect(events).toEqual([
      { type: 'KeyframeAdded', target, keyframeId: inverse.keyframe.keyframeId },
    ])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
    expect(setup.undoStack.entries[0]).toMatchObject({
      type: 'AddKeyframe',
      parameters: { target, time: 2.5, value: 100 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('AddKeyframe'))
  })

  it('rejects unknown node, non-animatable property, unknown parameter, out-of-bounds time, and invalid values with the engine unchanged', () => {
    const setup = setupWithNode()
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const results = [
      setup.dispatcher.dispatch(
        new AddKeyframeCommand({ target: propertyTarget('ghost'), time: 1, value: 10 }),
      ),
      setup.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId: setup.cameraId, property: 'rotation' },
          time: 1,
          value: 0.5,
        }),
      ),
      setup.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId: setup.nodeId, parameter: 'uGhost' },
          time: 1,
          value: 10,
        }),
      ),
      setup.dispatcher.dispatch(
        new AddKeyframeCommand({ target: propertyTarget(setup.nodeId), time: -0.01, value: 10 }),
      ),
      setup.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: propertyTarget(setup.nodeId, 'opacity'),
          time: 1,
          value: 1.5,
        }),
      ),
    ]

    for (const result of results) {
      expect(result.ok).toBe(false)
    }
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(0)
    expect(setup.engine.getKeyframes(setup.nodeId, 'opacity')).toHaveLength(0)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a time already occupied on the same track', () => {
    const setup = setupWithNode()
    addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new AddKeyframeCommand({ target: propertyTarget(setup.nodeId), time: 1, value: 99 }),
    )

    expect(result.ok).toBe(false)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('adds to a material track through the dispatcher with the parameter target', () => {
    const setup = setupWithMaterialNode()
    const target: KeyframeTarget = { kind: 'node', nodeId: setup.nodeId, parameter: 'uGlow' }
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new AddKeyframeCommand({ target, time: 1, value: 0.75 }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getMaterialKeyframes(setup.nodeId, 'uGlow')[0]?.value).toBe(0.75)
    expect(events).toEqual([
      { type: 'KeyframeAdded', target, keyframeId: inverse.keyframe.keyframeId },
    ])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
  })

  it('rejects a value invalid for the parameter kind', () => {
    const setup = setupWithMaterialNode()
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: setup.nodeId, parameter: 'uSteps' },
        time: 1,
        value: 2.5,
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.engine.hasMaterialTrack(setup.nodeId, 'uSteps')).toBe(false)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('DeleteKeyframesCommand', () => {
  it('deletes one or many keyframes identically: one history entry, one event per keyframe, full inverse', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const second = addKeyframe(setup, propertyTarget(setup.nodeId), 2, 20)
    const third = addKeyframe(setup, propertyTarget(setup.nodeId), 3, 30)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const single = setup.dispatcher.dispatch(
      new DeleteKeyframesCommand({ target: propertyTarget(setup.nodeId), keyframeIds: [first] }),
    )
    expectOk(single)
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)

    const many = setup.dispatcher.dispatch(
      new DeleteKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        keyframeIds: [second, third],
      }),
    )
    const inverse = expectOk(many)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(0)
    expect(inverse.keyframes.map((keyframe) => keyframe.keyframeId)).toEqual([second, third])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 2)
    expect(events).toEqual([
      { type: 'KeyframeRemoved', target: propertyTarget(setup.nodeId), keyframeId: first },
      { type: 'KeyframeRemoved', target: propertyTarget(setup.nodeId), keyframeId: second },
      { type: 'KeyframeRemoved', target: propertyTarget(setup.nodeId), keyframeId: third },
    ])
  })

  it('rejects the whole batch when any id is unknown, leaving the engine unchanged', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new DeleteKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        keyframeIds: [first, 'ghost'],
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/keyframe.*not found/i)
    }
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(1)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('deletes material keyframes and emits the parameter target', () => {
    const setup = setupWithMaterialNode()
    const target: KeyframeTarget = { kind: 'node', nodeId: setup.nodeId, parameter: 'uGlow' }
    const keyframeId = addKeyframe(setup, target, 1, 0.5)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new DeleteKeyframesCommand({ target, keyframeIds: [keyframeId] }),
    )

    expectOk(result)
    expect(setup.engine.hasMaterialTrack(setup.nodeId, 'uGlow')).toBe(false)
    expect(events).toEqual([{ type: 'KeyframeRemoved', target, keyframeId }])
  })
})

describe('MoveKeyframesCommand', () => {
  it('moves one or many keyframes as one history entry with inverse old times', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const second = addKeyframe(setup, propertyTarget(setup.nodeId), 2, 20)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const single = setup.dispatcher.dispatch(
      new MoveKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        moves: [{ keyframeId: first, newTime: 3 }],
      }),
    )
    const singleInverse = expectOk(single)
    expect(singleInverse.moves).toEqual([{ keyframeId: first, oldTime: 1 }])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)

    const many = setup.dispatcher.dispatch(
      new MoveKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        moves: [{ keyframeId: second, newTime: 5 }],
      }),
    )
    expectOk(many)
    expect(setup.undoStack.entries).toHaveLength(undoCount + 2)
    expect(
      setup.engine
        .getKeyframes(setup.nodeId, 'positionX')
        .map((keyframe) => [keyframe.id, keyframe.time]),
    ).toEqual([
      [first, 3],
      [second, 5],
    ])
    expect(events).toEqual([
      { type: 'KeyframeMoved', target: propertyTarget(setup.nodeId), keyframeId: first },
      { type: 'KeyframeMoved', target: propertyTarget(setup.nodeId), keyframeId: second },
    ])
  })

  it('rejects an invalid batch wholly with the engine unchanged', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new MoveKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        moves: [
          { keyframeId: first, newTime: 3 },
          { keyframeId: 'ghost', newTime: 4 },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.time).toBe(1)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('SetKeyframeValueCommand', () => {
  it('changes a property value with a target-carrying event and inverse old value', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetKeyframeValueCommand({
        target: propertyTarget(setup.nodeId),
        keyframeId,
        newValue: 42,
      }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.value).toBe(42)
    expect(inverse).toEqual({ target: propertyTarget(setup.nodeId), keyframeId, oldValue: 10 })
    expect(events).toEqual([
      { type: 'KeyframeValueChanged', target: propertyTarget(setup.nodeId), keyframeId },
    ])
  })

  it('rejects a value invalid for the property or kind', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId, 'opacity'), 1, 0.5)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new SetKeyframeValueCommand({
        target: propertyTarget(setup.nodeId, 'opacity'),
        keyframeId,
        newValue: 2,
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.engine.getKeyframes(setup.nodeId, 'opacity')[0]?.value).toBe(0.5)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('ScaleKeyframesCommand', () => {
  it('scales around the pivot and records inverse old times that restore the originals exactly', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const second = addKeyframe(setup, propertyTarget(setup.nodeId), 2, 20)
    const third = addKeyframe(setup, propertyTarget(setup.nodeId), 4, 40)

    const result = setup.dispatcher.dispatch(
      new ScaleKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        keyframeIds: [first, second, third],
        pivot: 0,
        factor: 2,
      }),
    )

    const inverse = expectOk(result)
    expect(
      setup.engine.getKeyframes(setup.nodeId, 'positionX').map((keyframe) => keyframe.time),
    ).toEqual([2, 4, 8])
    expect(inverse.moves).toEqual([
      { keyframeId: first, oldTime: 1 },
      { keyframeId: second, oldTime: 2 },
      { keyframeId: third, oldTime: 4 },
    ])
    expect(setup.undoStack.entries[0]).toMatchObject({
      type: 'ScaleKeyframes',
      parameters: { target: propertyTarget(setup.nodeId), pivot: 0, factor: 2 },
    })
  })

  it('the inverse payload reproduces the original times exactly', () => {
    const setup = setupWithNode()
    const ids = [1, 2, 4, 7].map((time) =>
      addKeyframe(setup, propertyTarget(setup.nodeId), time, time),
    )

    const inverse = expectOk(
      setup.dispatcher.dispatch(
        new ScaleKeyframesCommand({
          target: propertyTarget(setup.nodeId),
          keyframeIds: ids,
          pivot: 3,
          factor: 1.5,
        }),
      ),
    )
    expect(
      setup.engine.getKeyframes(setup.nodeId, 'positionX').map((keyframe) => keyframe.time),
    ).not.toEqual([1, 2, 4, 7])
    for (const move of inverse.moves) {
      expectOk(
        setup.dispatcher.dispatch(
          new MoveKeyframesCommand({
            target: propertyTarget(setup.nodeId),
            moves: [{ keyframeId: move.keyframeId, newTime: move.oldTime }],
          }),
        ),
      )
    }
    expect(
      setup.engine.getKeyframes(setup.nodeId, 'positionX').map((keyframe) => keyframe.time),
    ).toEqual([1, 2, 4, 7])
  })

  it('rejects a scale pushing times out of bounds with the engine unchanged', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new ScaleKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        keyframeIds: [first],
        pivot: 0,
        factor: 20,
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.time).toBe(1)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('PasteKeyframesCommand', () => {
  it('pastes a payload at the origin time, recording the created keyframes as inverse', () => {
    const setup = setupWithNode()
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new PasteKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        payload: {
          keyframes: [
            {
              time: 0,
              value: 10,
              interpolation: 'hold',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
            {
              time: 1,
              value: 20,
              interpolation: 'bezier',
              tangentIn: { time: -0.5, value: 2 },
              tangentOut: { time: 0.5, value: 2 },
            },
          ],
        },
        atTime: 3,
      }),
    )

    const inverse = expectOk(result)
    expect(inverse.keyframes).toHaveLength(2)
    expect(
      setup.engine.getKeyframes(setup.nodeId, 'positionX').map((keyframe) => keyframe.time),
    ).toEqual([3, 4])
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[1]?.interpolation).toBe('bezier')
    expect(events).toEqual([
      {
        type: 'KeyframeAdded',
        target: propertyTarget(setup.nodeId),
        keyframeId: inverse.keyframes[0]?.keyframeId,
      },
      {
        type: 'KeyframeAdded',
        target: propertyTarget(setup.nodeId),
        keyframeId: inverse.keyframes[1]?.keyframeId,
      },
    ])
  })

  it('pastes onto a material track with per-kind validation', () => {
    const setup = setupWithMaterialNode()
    const target: KeyframeTarget = { kind: 'node', nodeId: setup.nodeId, parameter: 'uGlow' }

    const inverse = expectOk(
      setup.dispatcher.dispatch(
        new PasteKeyframesCommand({
          target,
          payload: {
            keyframes: [
              {
                time: 0,
                value: 0.5,
                interpolation: 'linear',
                tangentIn: { time: 0, value: 0 },
                tangentOut: { time: 0, value: 0 },
              },
            ],
          },
          atTime: 2,
        }),
      ),
    )
    expect(inverse.keyframes).toHaveLength(1)
  })

  it('rejects a paste colliding with an existing keyframe with the engine unchanged', () => {
    const setup = setupWithNode()
    addKeyframe(setup, propertyTarget(setup.nodeId), 3, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new PasteKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        payload: {
          keyframes: [
            {
              time: 0,
              value: 99,
              interpolation: 'linear',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
          ],
        },
        atTime: 3,
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(1)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('DuplicateKeyframesCommand', () => {
  it('duplicates a selection just after its last keyframe, recording the copies as inverse', () => {
    const setup = setupWithNode()
    const first = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const second = addKeyframe(setup, propertyTarget(setup.nodeId), 3, 30)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new DuplicateKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        keyframeIds: [first, second],
      }),
    )

    const inverse = expectOk(result)
    expect(inverse.keyframes).toHaveLength(2)
    expect(
      setup.engine.getKeyframes(setup.nodeId, 'positionX').map((keyframe) => keyframe.time),
    ).toEqual([1, 3, 3 + 1 / 60, 5 + 1 / 60])
    expect(events).toEqual([
      {
        type: 'KeyframeAdded',
        target: propertyTarget(setup.nodeId),
        keyframeId: inverse.keyframes[0]?.keyframeId,
      },
      {
        type: 'KeyframeAdded',
        target: propertyTarget(setup.nodeId),
        keyframeId: inverse.keyframes[1]?.keyframeId,
      },
    ])
    expect(setup.undoStack.entries[0]).toMatchObject({
      type: 'DuplicateKeyframes',
      parameters: { target: propertyTarget(setup.nodeId), keyframeIds: [first, second] },
    })
  })

  it('rejects a duplicate running past the slide duration', () => {
    const setup = setupWithNode()
    const duration = setup.engine.project?.slides[0]?.duration ?? 0
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), duration, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new DuplicateKeyframesCommand({
        target: propertyTarget(setup.nodeId),
        keyframeIds: [keyframeId],
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(1)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})

describe('SetKeyframeInterpolationCommand and SetKeyframeTangentsCommand', () => {
  it('set interpolation and emit KeyframeInterpolationChanged with the target and old value', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({
        target: propertyTarget(setup.nodeId),
        keyframeId,
        interpolation: 'bezier',
      }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.interpolation).toBe('bezier')
    expect(inverse).toEqual({
      target: propertyTarget(setup.nodeId),
      keyframeId,
      oldInterpolation: 'linear',
    })
    expect(events).toEqual([
      { type: 'KeyframeInterpolationChanged', target: propertyTarget(setup.nodeId), keyframeId },
    ])
  })

  it('rejects an unknown interpolation with the engine unchanged', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({
        target: propertyTarget(setup.nodeId),
        keyframeId,
        interpolation: 'nonexistent' as never,
      }),
    )

    expect(result.ok).toBe(false)
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('set tangents and emit KeyframeTangentsChanged with the target and old tangents', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetKeyframeTangentsCommand({
        target: propertyTarget(setup.nodeId),
        keyframeId,
        tangentIn: { time: -0.5, value: 2 },
        tangentOut: { time: 0.5, value: 2 },
      }),
    )

    const inverse = expectOk(result)
    const keyframe = setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]
    expect(keyframe?.tangentIn).toEqual({ time: -0.5, value: 2 })
    expect(keyframe?.tangentOut).toEqual({ time: 0.5, value: 2 })
    expect(inverse).toEqual({
      target: propertyTarget(setup.nodeId),
      keyframeId,
      oldTangentIn: { time: 0, value: 0 },
      oldTangentOut: { time: 0, value: 0 },
    })
    expect(events).toEqual([
      { type: 'KeyframeTangentsChanged', target: propertyTarget(setup.nodeId), keyframeId },
    ])
  })

  it('set interpolation and tangents on material keyframes with the parameter target', () => {
    const setup = setupWithMaterialNode()
    const target: KeyframeTarget = { kind: 'node', nodeId: setup.nodeId, parameter: 'uGlow' }
    const keyframeId = addKeyframe(setup, target, 1, 0.5)
    const events = collectEvents(setup.engine)

    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({ target, keyframeId, interpolation: 'hold' }),
      ),
    )
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target,
          keyframeId,
          tangentIn: { time: -0.1, value: 1 },
          tangentOut: { time: 0.1, value: 1 },
        }),
      ),
    )
    expect(events).toEqual([
      { type: 'KeyframeInterpolationChanged', target, keyframeId },
      { type: 'KeyframeTangentsChanged', target, keyframeId },
    ])
  })

  it('set parametric interpolation (bounce) on a node property', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)

    const result = setup.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({
        target: propertyTarget(setup.nodeId),
        keyframeId,
        interpolation: 'bounce',
      }),
    )

    const inverse = expectOk(result)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.interpolation).toBe('bounce')
    expect(inverse).toEqual({
      target: propertyTarget(setup.nodeId),
      keyframeId,
      oldInterpolation: 'linear',
    })
  })

  it('set parametric interpolation (elastic) on a continuous material parameter', () => {
    const setup = setupWithMaterialNode()
    const target: KeyframeTarget = { kind: 'node', nodeId: setup.nodeId, parameter: 'uGlow' }
    const keyframeId = addKeyframe(setup, target, 1, 0.5)

    const result = setup.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({ target, keyframeId, interpolation: 'elastic' }),
    )

    const inverse = expectOk(result)
    expect(inverse).toEqual({
      target,
      keyframeId,
      oldInterpolation: 'linear',
    })
  })

  it('rejects parametric interpolation on a discrete material parameter', () => {
    const setup = setupWithMaterialNode()
    const target: KeyframeTarget = { kind: 'node', nodeId: setup.nodeId, parameter: 'uSteps' }
    const keyframeId = addKeyframe(setup, target, 1, 2)

    const result = setup.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({ target, keyframeId, interpolation: 'spring' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('discrete material kind')
    }
  })
})

describe('gesture grouping', () => {
  it('a multi-target gesture dispatches as one transaction: one history entry, one event per keyframe', () => {
    const setup = setupWithNode()
    const other = expectOk(
      setup.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: setup.engine.project?.slides[0]?.scene.id ?? '',
          parentId: setup.engine.project?.slides[0]?.scene.root.id ?? '',
          name: 'B',
        }),
      ),
    ).nodeId
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new TransactionCommand([
        new AddKeyframeCommand({ target: propertyTarget(setup.nodeId), time: 1, value: 10 }),
        new AddKeyframeCommand({ target: propertyTarget(other), time: 2, value: 20 }),
      ]),
    )

    const inverse = expectOk(result)
    const keyframeIds = inverse.children.map(
      (child) => (child.inverse as { keyframe: { keyframeId: string } }).keyframe.keyframeId,
    )
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')).toHaveLength(1)
    expect(setup.engine.getKeyframes(other, 'positionX')).toHaveLength(1)
    expect(events).toEqual([
      { type: 'KeyframeAdded', target: propertyTarget(setup.nodeId), keyframeId: keyframeIds[0] },
      { type: 'KeyframeAdded', target: propertyTarget(other), keyframeId: keyframeIds[1] },
    ])
  })
})

describe('undo replay for interpolation and tangent commands', () => {
  it('undoing SetKeyframeInterpolationCommand restores the previous interpolation', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)

    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({
          target: propertyTarget(setup.nodeId),
          keyframeId,
          interpolation: 'bezier',
        }),
      ),
    )
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.interpolation).toBe('bezier')

    // Replay the inverse: set interpolation back to the old value
    const entry = setup.undoStack.entries[0]
    const inverse = entry.inverse as {
      target: KeyframeTarget
      keyframeId: string
      oldInterpolation: 'hold' | 'linear' | 'bezier'
    }
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({
          target: inverse.target,
          keyframeId: inverse.keyframeId,
          interpolation: inverse.oldInterpolation,
        }),
      ),
    )
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.interpolation).toBe('linear')
  })

  it('undoing SetKeyframeTangentsCommand restores the previous tangents', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)

    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: propertyTarget(setup.nodeId),
          keyframeId,
          tangentIn: { time: -0.5, value: 2 },
          tangentOut: { time: 0.5, value: 2 },
        }),
      ),
    )
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.tangentIn).toEqual({
      time: -0.5,
      value: 2,
    })

    // Replay the inverse: restore previous tangents
    const entry = setup.undoStack.entries[0]
    const inverse = entry.inverse as {
      target: KeyframeTarget
      keyframeId: string
      oldTangentIn: KeyframeTangent
      oldTangentOut: KeyframeTangent
    }
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: inverse.target,
          keyframeId: inverse.keyframeId,
          tangentIn: inverse.oldTangentIn,
          tangentOut: inverse.oldTangentOut,
        }),
      ),
    )
    const kf = setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]
    expect(kf?.tangentIn).toEqual({ time: 0, value: 0 })
    expect(kf?.tangentOut).toEqual({ time: 0, value: 0 })
  })

  it('double-click tangent reset undo restores previous tangents', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)

    // Set tangents to non-zero
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: propertyTarget(setup.nodeId),
          keyframeId,
          tangentIn: { time: -0.3, value: 1.5 },
          tangentOut: { time: 0.3, value: 1.5 },
        }),
      ),
    )
    // Simulate double-click reset: set tangents to ZERO_TANGENT
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: propertyTarget(setup.nodeId),
          keyframeId,
          tangentIn: { time: 0, value: 0 },
          tangentOut: { time: 0, value: 0 },
        }),
      ),
    )
    expect(setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]?.tangentIn).toEqual({
      time: 0,
      value: 0,
    })

    // Replay the double-click reset's inverse to restore previous tangents
    const entry = setup.undoStack.entries[0]
    const inverse = entry.inverse as {
      target: KeyframeTarget
      keyframeId: string
      oldTangentIn: KeyframeTangent
      oldTangentOut: KeyframeTangent
    }
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: inverse.target,
          keyframeId: inverse.keyframeId,
          tangentIn: inverse.oldTangentIn,
          tangentOut: inverse.oldTangentOut,
        }),
      ),
    )
    const kf = setup.engine.getKeyframes(setup.nodeId, 'positionX')[0]
    expect(kf?.tangentIn).toEqual({ time: -0.3, value: 1.5 })
    expect(kf?.tangentOut).toEqual({ time: 0.3, value: 1.5 })
  })

  it('undo produces bit-identical state for interpolation change', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const before = JSON.stringify(setup.engine.toJSON())

    // Change interpolation
    const inverse = expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({
          target: propertyTarget(setup.nodeId),
          keyframeId,
          interpolation: 'bezier',
        }),
      ),
    )
    // Undo
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({
          target: inverse.target,
          keyframeId: inverse.keyframeId,
          interpolation: inverse.oldInterpolation,
        }),
      ),
    )
    expect(JSON.stringify(setup.engine.toJSON())).toBe(before)
  })

  it('undo produces bit-identical state for tangent change', () => {
    const setup = setupWithNode()
    const keyframeId = addKeyframe(setup, propertyTarget(setup.nodeId), 1, 10)
    const before = JSON.stringify(setup.engine.toJSON())

    // Change tangents
    const inverse = expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: propertyTarget(setup.nodeId),
          keyframeId,
          tangentIn: { time: -0.5, value: 2 },
          tangentOut: { time: 0.5, value: 2 },
        }),
      ),
    )
    // Undo
    expectOk(
      setup.dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: inverse.target,
          keyframeId: inverse.keyframeId,
          tangentIn: inverse.oldTangentIn,
          tangentOut: inverse.oldTangentOut,
        }),
      ),
    )
    expect(JSON.stringify(setup.engine.toJSON())).toBe(before)
  })
})
