import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteKeyframeCommand,
  DeleteNodeCommand,
  MoveKeyframeCommand,
  SetKeyframeValueCommand,
  BatchMoveKeyframesCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  return { system, nodeId, slide }
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('keyframe tracks are implicit', () => {
  it('a track is born with its first keyframe and disappears with its last', () => {
    const { system, nodeId } = setupWithNode()
    expect(system.engine.getKeyframes(nodeId, 'rotation')).toHaveLength(0)

    const { keyframeId } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'rotation', time: 0.5, value: 1 }),
      ),
    )
    expect(system.engine.getKeyframes(nodeId, 'rotation')).toHaveLength(1)

    expectOk(
      system.dispatcher.dispatch(
        new DeleteKeyframeCommand({ nodeId, property: 'rotation', keyframeId }),
      ),
    )
    expect(system.engine.getKeyframes(nodeId, 'rotation')).toHaveLength(0)
  })

  it('deleting one of several keyframes keeps the track', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'scaleY', time: 1, value: 1 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'scaleY', time: 2, value: 2 }),
      ),
    )

    expectOk(
      system.dispatcher.dispatch(
        new DeleteKeyframeCommand({ nodeId, property: 'scaleY', keyframeId: first }),
      ),
    )

    expect(system.engine.getKeyframes(nodeId, 'scaleY')).toHaveLength(1)
    expect(system.engine.getKeyframes(nodeId, 'scaleY')[0]?.value).toBe(2)
  })
})

describe('MoveKeyframeCommand', () => {
  it('moves a keyframe in time, emits KeyframeMoved, records inverse, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    const { keyframeId } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new MoveKeyframeCommand({ nodeId, property: 'positionX', keyframeId, newTime: 4 }),
    )

    const inverse = expectOk(result)
    const keyframes = system.engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes).toHaveLength(1)
    expect(keyframes[0]?.time).toBe(4)
    expect(keyframes[0]?.value).toBe(10)
    expect(events).toEqual([{ type: 'KeyframeMoved', nodeId, property: 'positionX', keyframeId }])
    expect(inverse).toEqual({ nodeId, property: 'positionX', keyframeId, oldTime: 1 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'MoveKeyframe',
      parameters: { nodeId, property: 'positionX', keyframeId, newTime: 4 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `MoveKeyframe nodeId=${nodeId} property=positionX keyframeId=${keyframeId} newTime=4`,
    )
  })

  it('rejects a move beyond the slide duration and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const duration = system.engine.project?.slides[0]?.duration ?? 0
    const { keyframeId } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new MoveKeyframeCommand({ nodeId, property: 'positionX', keyframeId, newTime: duration + 1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/within/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.time).toBe(1)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects moving a keyframe onto another keyframe of the same property', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 3, value: 30 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new MoveKeyframeCommand({ nodeId, property: 'positionX', keyframeId: first, newTime: 3 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/already has a keyframe/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.time).toBe(1)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new MoveKeyframeCommand({
        nodeId: 'n1',
        property: 'positionX',
        keyframeId: 'k1',
        newTime: 5,
      }).toJSON(),
    ).toEqual({
      type: 'MoveKeyframe',
      nodeId: 'n1',
      property: 'positionX',
      keyframeId: 'k1',
      newTime: 5,
    })
  })
})

describe('SetKeyframeValueCommand', () => {
  it('changes a keyframe value, emits KeyframeValueChanged, records inverse, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    const { keyframeId } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new SetKeyframeValueCommand({ nodeId, property: 'positionX', keyframeId, newValue: 42 }),
    )

    const inverse = expectOk(result)
    const keyframes = system.engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes[0]?.value).toBe(42)
    expect(keyframes[0]?.time).toBe(1)
    expect(events).toEqual([
      { type: 'KeyframeValueChanged', nodeId, property: 'positionX', keyframeId },
    ])
    expect(inverse).toEqual({ nodeId, property: 'positionX', keyframeId, oldValue: 10 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetKeyframeValue',
      parameters: { nodeId, property: 'positionX', keyframeId, newValue: 42 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `SetKeyframeValue nodeId=${nodeId} property=positionX keyframeId=${keyframeId} newValue=42`,
    )
  })

  it('rejects a value invalid for the property and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'opacity', time: 1, value: 0.5 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new SetKeyframeValueCommand({ nodeId, property: 'opacity', keyframeId, newValue: 2 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/opacity/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'opacity')[0]?.value).toBe(0.5)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new SetKeyframeValueCommand({
        nodeId: 'n1',
        property: 'scaleX',
        keyframeId: 'k1',
        newValue: 3,
      }).toJSON(),
    ).toEqual({
      type: 'SetKeyframeValue',
      nodeId: 'n1',
      property: 'scaleX',
      keyframeId: 'k1',
      newValue: 3,
    })
  })
})

describe('BatchMoveKeyframesCommand', () => {
  it('moves several keyframes as one gesture with one history entry and one event per keyframe', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: nodeA } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    const { nodeId: nodeB } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
        }),
      ),
    )
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId: nodeA, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const { keyframeId: second } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId: nodeB, property: 'opacity', time: 2, value: 0.5 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId: nodeA, property: 'positionX', keyframeId: first, newTime: 3 },
          { nodeId: nodeB, property: 'opacity', keyframeId: second, newTime: 5 },
        ],
      }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getKeyframes(nodeA, 'positionX')[0]?.time).toBe(3)
    expect(system.engine.getKeyframes(nodeB, 'opacity')[0]?.time).toBe(5)
    expect(events).toEqual([
      { type: 'KeyframeMoved', nodeId: nodeA, property: 'positionX', keyframeId: first },
      { type: 'KeyframeMoved', nodeId: nodeB, property: 'opacity', keyframeId: second },
    ])
    expect(inverse).toEqual({
      moves: [
        { nodeId: nodeA, property: 'positionX', keyframeId: first, oldTime: 1 },
        { nodeId: nodeB, property: 'opacity', keyframeId: second, oldTime: 2 },
      ],
    })
    expect(system.undoStack.entries).toHaveLength(undoCount + 1)
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'BatchMoveKeyframes',
      parameters: {
        moves: [
          { nodeId: nodeA, property: 'positionX', keyframeId: first, newTime: 3 },
          { nodeId: nodeB, property: 'opacity', keyframeId: second, newTime: 5 },
        ],
      },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `BatchMoveKeyframes moves=[${JSON.stringify({
        nodeId: nodeA,
        property: 'positionX',
        keyframeId: first,
        newTime: 3,
      })},${JSON.stringify({
        nodeId: nodeB,
        property: 'opacity',
        keyframeId: second,
        newTime: 5,
      })}]`,
    )
  })

  it('rejects the whole batch when one move is invalid and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionY', time: 2, value: 20 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId, property: 'positionX', keyframeId: first, newTime: 3 },
          { nodeId, property: 'positionY', keyframeId: 'ghost', newTime: 4 },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/keyframe.*not found/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.time).toBe(1)
    expect(system.engine.getKeyframes(nodeId, 'positionY')[0]?.time).toBe(2)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects two keyframes moving onto the same time of the same property', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const { keyframeId: second } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 2, value: 20 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId, property: 'positionX', keyframeId: first, newTime: 5 },
          { nodeId, property: 'positionX', keyframeId: second, newTime: 5 },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/same time/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.time).toBe(1)
    expect(system.engine.getKeyframes(nodeId, 'positionX')[1]?.time).toBe(2)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a batch move beyond the slide duration and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const duration = system.engine.project?.slides[0]?.duration ?? 0
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const { keyframeId: second } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionY', time: 2, value: 20 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId, property: 'positionX', keyframeId: first, newTime: 3 },
          { nodeId, property: 'positionY', keyframeId: second, newTime: duration + 1 },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/within/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.time).toBe(1)
    expect(system.engine.getKeyframes(nodeId, 'positionY')[0]?.time).toBe(2)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new BatchMoveKeyframesCommand({
        moves: [
          { nodeId: 'n1', property: 'positionX', keyframeId: 'k1', newTime: 3 },
          { nodeId: 'n1', property: 'positionY', keyframeId: 'k2', newTime: 4 },
        ],
      }).toJSON(),
    ).toEqual({
      type: 'BatchMoveKeyframes',
      moves: [
        { nodeId: 'n1', property: 'positionX', keyframeId: 'k1', newTime: 3 },
        { nodeId: 'n1', property: 'positionY', keyframeId: 'k2', newTime: 4 },
      ],
    })
  })
})

describe('keyframe validation matrix', () => {
  it('allows keyframing all six properties of a text node', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Label',
          components: {
            text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'center' },
          },
        }),
      ),
    )

    const properties = [
      'positionX',
      'positionY',
      'rotation',
      'scaleX',
      'scaleY',
      'opacity',
    ] as const

    for (const property of properties) {
      expectOk(
        system.dispatcher.dispatch(
          new AddKeyframeCommand({
            nodeId,
            property,
            time: 1,
            value: property === 'opacity' ? 0.5 : 1,
          }),
        ),
      )
    }

    for (const property of properties) {
      expect(system.engine.getKeyframes(nodeId, property)).toHaveLength(1)
    }
  })

  it('rejects the camera rotation property for every keyframe command', () => {
    const { system, slide } = setupWithNode()
    const cameraId = slide.scene.camera.id
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const add = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId: cameraId, property: 'rotation', time: 1, value: 0.5 }),
    )
    const del = system.dispatcher.dispatch(
      new DeleteKeyframeCommand({ nodeId: cameraId, property: 'rotation', keyframeId: 'k' }),
    )
    const move = system.dispatcher.dispatch(
      new MoveKeyframeCommand({
        nodeId: cameraId,
        property: 'rotation',
        keyframeId: 'k',
        newTime: 2,
      }),
    )
    const setValue = system.dispatcher.dispatch(
      new SetKeyframeValueCommand({
        nodeId: cameraId,
        property: 'rotation',
        keyframeId: 'k',
        newValue: 1,
      }),
    )

    for (const result of [add, del, move, setValue]) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toMatch(/rotation/i)
      }
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('keeps keyframe ids stable and unique across mutations', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId: first } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const { keyframeId: second } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionY', time: 2, value: 20 }),
      ),
    )
    expect(first).not.toBe(second)

    expectOk(
      system.dispatcher.dispatch(
        new MoveKeyframeCommand({ nodeId, property: 'positionX', keyframeId: first, newTime: 5 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new SetKeyframeValueCommand({
          nodeId,
          property: 'positionY',
          keyframeId: second,
          newValue: 99,
        }),
      ),
    )

    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.id).toBe(first)
    expect(system.engine.getKeyframes(nodeId, 'positionY')[0]?.id).toBe(second)
  })

  it('keeps tracks sorted by time as keyframes are added and moved', () => {
    const { system, nodeId } = setupWithNode()
    const { keyframeId: middle } = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 2, value: 20 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 0, value: 0 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 4, value: 40 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new MoveKeyframeCommand({ nodeId, property: 'positionX', keyframeId: middle, newTime: 1 }),
      ),
    )

    const times = system.engine.getKeyframes(nodeId, 'positionX').map((keyframe) => keyframe.time)
    expect(times).toEqual([0, 1, 4])
  })
})

describe('keyframe lifecycle with nodes', () => {
  it('removes a node keyframes when the node is deleted', () => {
    const { system, nodeId, slide } = setupWithNode()
    const child = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: nodeId,
          name: 'Child',
        }),
      ),
    ).nodeId
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId: child, property: 'rotation', time: 2, value: 0.5 }),
      ),
    )

    system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId }))

    expect(() => system.engine.getKeyframes(nodeId, 'positionX')).toThrow(/node.*not found/i)
    expect(() => system.engine.getKeyframes(child, 'rotation')).toThrow(/node.*not found/i)
  })

  it('keeps keyframes of other nodes when one node is deleted', () => {
    const { system, nodeId, slide } = setupWithNode()
    const { nodeId: other } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
        }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId: other, property: 'positionX', time: 1, value: 10 }),
      ),
    )

    system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId }))

    expect(system.engine.getKeyframes(other, 'positionX')).toHaveLength(1)
  })
})

describe('slide duration placeholder', () => {
  it('creates slides with the default 10 second duration', () => {
    const { system } = setupWithNode()
    expect(system.engine.project?.slides[0]?.duration).toBe(10)
  })
})

describe('unknown animation property at runtime', () => {
  it('rejects a property outside the uniform six with the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        nodeId,
        property: 'content' as never,
        time: 1,
        value: 10,
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/unknown animation property/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})
