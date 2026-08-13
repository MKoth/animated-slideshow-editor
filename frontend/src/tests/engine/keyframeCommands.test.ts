import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteKeyframeCommand,
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

describe('AddKeyframeCommand', () => {
  it('adds a keyframe, emits KeyframeAdded, records parameters and inverse, and logs it', () => {
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
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId, property: 'positionX', time: 2.5, value: 100 }),
    )

    const inverse = expectOk(result)
    const keyframes = system.engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes).toHaveLength(1)
    expect(keyframes[0]?.time).toBe(2.5)
    expect(keyframes[0]?.value).toBe(100)
    expect(keyframes[0]?.id).toBe(inverse.keyframeId)
    expect(events).toEqual([
      { type: 'KeyframeAdded', nodeId, property: 'positionX', keyframeId: inverse.keyframeId },
    ])
    expect(inverse).toEqual({
      nodeId,
      property: 'positionX',
      keyframeId: inverse.keyframeId,
      time: 2.5,
      value: 100,
    })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'AddKeyframe',
      parameters: { nodeId, property: 'positionX', time: 2.5, value: 100 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `AddKeyframe nodeId=${nodeId} property=positionX time=2.5 value=100`,
    )
  })

  it('allows animating the camera over its five properties but not rotation', () => {
    const { system, slide } = setupWithNode()
    const cameraId = slide.scene.camera.id

    const ok = expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId: cameraId, property: 'positionX', time: 1, value: 50 }),
      ),
    )
    expect(system.engine.getKeyframes(cameraId, 'positionX')).toHaveLength(1)
    expect(ok.keyframeId).toBeTruthy()

    const blocked = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId: cameraId, property: 'rotation', time: 1, value: 0.5 }),
    )
    expect(blocked.ok).toBe(false)
    expect(system.engine.getKeyframes(cameraId, 'rotation')).toHaveLength(0)
  })

  it('rejects a nonexistent node and leaves the engine unchanged', () => {
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId: 'ghost', property: 'positionX', time: 1, value: 10 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a time outside [0, slide duration] and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const duration = system.engine.project?.slides[0]?.duration ?? 0
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const negative = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId, property: 'positionX', time: -0.01, value: 10 }),
    )
    const beyond = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId, property: 'positionX', time: duration + 0.01, value: 10 }),
    )

    expect(negative.ok).toBe(false)
    expect(beyond.ok).toBe(false)
    expect(system.engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('accepts keyframe times at the slide duration boundaries', () => {
    const { system, nodeId } = setupWithNode()
    const duration = system.engine.project?.slides[0]?.duration ?? 0

    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 0, value: 10 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: duration, value: 20 }),
      ),
    )

    const times = system.engine.getKeyframes(nodeId, 'positionX').map((keyframe) => keyframe.time)
    expect(times).toEqual([0, duration])
  })

  it('rejects an opacity outside [0, 1] and a non-finite value', () => {
    const { system, nodeId } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const high = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId, property: 'opacity', time: 1, value: 1.5 }),
    )
    const nan = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: Number.NaN }),
    )

    expect(high.ok).toBe(false)
    if (!high.ok) {
      expect(high.error.message).toMatch(/opacity/i)
    }
    expect(nan.ok).toBe(false)
    if (!nan.ok) {
      expect(nan.error.message).toMatch(/finite/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'opacity')).toHaveLength(0)
    expect(system.engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a keyframe at a time already occupied on the same property', () => {
    const { system, nodeId } = setupWithNode()
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 99 }),
    )

    expect(result.ok).toBe(false)
    expect(system.engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(system.engine.getKeyframes(nodeId, 'positionX')[0]?.value).toBe(10)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('allows keyframes at the same time on different properties of the same node', () => {
    const { system, nodeId } = setupWithNode()

    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'positionX', time: 1, value: 10 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({ nodeId, property: 'rotation', time: 1, value: 0.5 }),
      ),
    )

    expect(system.engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(system.engine.getKeyframes(nodeId, 'rotation')).toHaveLength(1)
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new AddKeyframeCommand({ nodeId: 'n1', property: 'scaleY', time: 3, value: 2 }).toJSON(),
    ).toEqual({ type: 'AddKeyframe', nodeId: 'n1', property: 'scaleY', time: 3, value: 2 })
  })
})
describe('DeleteKeyframeCommand', () => {
  it('deletes a keyframe, emits KeyframeRemoved, records inverse, and logs it', () => {
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
      new DeleteKeyframeCommand({ nodeId, property: 'positionX', keyframeId }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(events).toEqual([{ type: 'KeyframeRemoved', nodeId, property: 'positionX', keyframeId }])
    expect(inverse).toEqual({ nodeId, property: 'positionX', keyframeId, time: 1, value: 10 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'DeleteKeyframe',
      parameters: { nodeId, property: 'positionX', keyframeId },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `DeleteKeyframe nodeId=${nodeId} property=positionX keyframeId=${keyframeId}`,
    )
  })

  it('rejects an unknown keyframe and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new DeleteKeyframeCommand({ nodeId, property: 'positionX', keyframeId: 'ghost' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/keyframe.*not found/i)
    }
    expect(system.engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new DeleteKeyframeCommand({ nodeId: 'n1', property: 'rotation', keyframeId: 'k1' }).toJSON(),
    ).toEqual({ type: 'DeleteKeyframe', nodeId: 'n1', property: 'rotation', keyframeId: 'k1' })
  })
})
