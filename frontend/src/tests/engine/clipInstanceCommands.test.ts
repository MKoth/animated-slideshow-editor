import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
  CreateClipCommand,
  CreateNodeCommand,
  AssignClipCommand,
  RemoveClipCommand,
  MoveClipLayerCommand,
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
  SetClipInstanceEnabledCommand,
  OverrideClipParamCommand,
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

function setupBase(): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  return { engine, dispatcher, undoStack }
}

function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

function createTestClip(setup: Setup): string {
  const inverse = expectOk(
    setup.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'TestClip',
        duration: 2,
        category: 'test',
        params: [{ key: 'gain', label: 'Gain', kind: 'float', default: 1 }],
        channels: [{ property: 'positionX', paramKey: 'gain' }, { property: 'opacity' }],
      }),
    ),
  )
  return inverse.clipId
}

function createTestNode(setup: Setup): string {
  const slide = setup.engine.project?.slides[0]
  if (!slide) throw new Error('expected a slide')
  const node = expectOk(
    setup.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'TestNode',
      }),
    ),
  )
  return node.nodeId
}

describe('AssignClipCommand', () => {
  it('assigns a clip instance to a node with inverse data and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new AssignClipCommand({
        nodeId,
        clipId,
        startTime: 1,
        speed: 2,
        enabled: false,
        paramOverrides: { gain: 0.5 },
      }),
    )

    const inverse = expectOk(result)
    expect(inverse.instanceId).toBeTruthy()
    expect(setup.engine.getClipInstances(nodeId)).toHaveLength(1)
    const instance = setup.engine.getClipInstances(nodeId)[0]!
    expect(instance.clipId).toBe(clipId)
    expect(instance.startTime).toBe(1)
    expect(instance.speed).toBe(2)
    expect(instance.enabled).toBe(false)
    expect(instance.paramOverrides.gain).toBe(0.5)
    expect(events).toEqual([{ type: 'ClipInstanceAdded', nodeId, instanceId: inverse.instanceId }])
  })

  it('rejects unknown clip id', () => {
    const setup = setupBase()
    const nodeId = createTestNode(setup)
    const result = setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId: 'ghost' }))
    expect(result.ok).toBe(false)
  })

  it('rejects negative start time', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const result = setup.dispatcher.dispatch(
      new AssignClipCommand({ nodeId, clipId, startTime: -1 }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects negative speed', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const result = setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId, speed: -1 }))
    expect(result.ok).toBe(false)
  })
})

describe('RemoveClipCommand', () => {
  it('removes a clip instance with inverse data and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(new RemoveClipCommand({ nodeId, instanceId }))

    const inverse = expectOk(result)
    expect(setup.engine.getClipInstances(nodeId)).toHaveLength(0)
    expect(inverse.instanceId).toBe(instanceId)
    expect(inverse.layerIndex).toBe(0)
    expect(events).toEqual([{ type: 'ClipInstanceRemoved', nodeId, instanceId }])
  })

  it('rejects unknown instance id', () => {
    const setup = setupBase()
    const nodeId = createTestNode(setup)
    const result = setup.dispatcher.dispatch(new RemoveClipCommand({ nodeId, instanceId: 'ghost' }))
    expect(result.ok).toBe(false)
  })
})

describe('MoveClipLayerCommand', () => {
  it('moves a clip instance layer with inverse data and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const first = expectOk(setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })))
    const second = expectOk(setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })))
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new MoveClipLayerCommand({ nodeId, instanceId: second.instanceId, newIndex: 0 }),
    )

    const inverse = expectOk(result)
    expect(inverse.oldIndex).toBe(1)
    const instances = setup.engine.getClipInstances(nodeId)
    expect(instances[0]!.id).toBe(second.instanceId)
    expect(instances[1]!.id).toBe(first.instanceId)
    expect(events).toEqual([{ type: 'ClipLayerMoved', nodeId, instanceId: second.instanceId }])
  })

  it('rejects out-of-bounds index', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    const result = setup.dispatcher.dispatch(
      new MoveClipLayerCommand({ nodeId, instanceId, newIndex: 5 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('SetClipInstanceStartTimeCommand', () => {
  it('changes start time with inverse and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId, startTime: 0 })),
    )
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetClipInstanceStartTimeCommand({ nodeId, instanceId, startTime: 3 }),
    )

    const inverse = expectOk(result)
    expect(inverse.oldStartTime).toBe(0)
    expect(setup.engine.getClipInstance(nodeId, instanceId).startTime).toBe(3)
    expect(events).toEqual([{ type: 'ClipInstanceTimeChanged', nodeId, instanceId }])
  })

  it('rejects negative start time', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    const result = setup.dispatcher.dispatch(
      new SetClipInstanceStartTimeCommand({ nodeId, instanceId, startTime: -1 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('SetClipInstanceSpeedCommand', () => {
  it('changes speed with inverse and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId, speed: 1 })),
    )
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetClipInstanceSpeedCommand({ nodeId, instanceId, speed: 2.5 }),
    )

    const inverse = expectOk(result)
    expect(inverse.oldSpeed).toBe(1)
    expect(setup.engine.getClipInstance(nodeId, instanceId).speed).toBe(2.5)
    expect(events).toEqual([{ type: 'ClipInstanceSpeedChanged', nodeId, instanceId }])
  })

  it('rejects negative speed', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    const result = setup.dispatcher.dispatch(
      new SetClipInstanceSpeedCommand({ nodeId, instanceId, speed: -1 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('SetClipInstanceEnabledCommand', () => {
  it('toggles enabled with inverse and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId, enabled: true })),
    )
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new SetClipInstanceEnabledCommand({ nodeId, instanceId, enabled: false }),
    )

    const inverse = expectOk(result)
    expect(inverse.oldEnabled).toBe(true)
    expect(setup.engine.getClipInstance(nodeId, instanceId).enabled).toBe(false)
    expect(events).toEqual([{ type: 'ClipInstanceEnabledChanged', nodeId, instanceId }])
  })
})

describe('OverrideClipParamCommand', () => {
  it('sets a param override with inverse and event', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    const events = collectEvents(setup.engine)

    const result = setup.dispatcher.dispatch(
      new OverrideClipParamCommand({ nodeId, instanceId, paramKey: 'gain', value: 0.5 }),
    )

    const inverse = expectOk(result)
    expect(inverse.hadOldValue).toBe(false)
    expect(setup.engine.getClipInstance(nodeId, instanceId).paramOverrides.gain).toBe(0.5)
    expect(events).toEqual([{ type: 'ClipParamOverridden', nodeId, instanceId, paramKey: 'gain' }])
  })

  it('replaces an existing override with inverse old value', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(
        new AssignClipCommand({ nodeId, clipId, paramOverrides: { gain: 0.5 } }),
      ),
    )

    const result = setup.dispatcher.dispatch(
      new OverrideClipParamCommand({ nodeId, instanceId, paramKey: 'gain', value: 2 }),
    )

    const inverse = expectOk(result)
    expect(inverse.hadOldValue).toBe(true)
    expect(inverse.oldValue).toBe(0.5)
    expect(setup.engine.getClipInstance(nodeId, instanceId).paramOverrides.gain).toBe(2)
  })

  it('rejects unknown param key on the clip', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    const { instanceId } = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    const result = setup.dispatcher.dispatch(
      new OverrideClipParamCommand({ nodeId, instanceId, paramKey: 'ghost', value: 1 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('clip instance undo', () => {
  it('assign and remove round-trip through undo', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)

    const assignInverse = expectOk(
      setup.dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId })),
    )
    expect(setup.engine.getClipInstances(nodeId)).toHaveLength(1)

    const removeInverse = expectOk(
      setup.dispatcher.dispatch(
        new RemoveClipCommand({ nodeId, instanceId: assignInverse.instanceId }),
      ),
    )
    expect(setup.engine.getClipInstances(nodeId)).toHaveLength(0)

    setup.dispatcher.dispatch(
      new RemoveClipCommand({
        nodeId,
        instanceId: removeInverse.instance.id,
      }),
    )
  })
})

describe('clip instance serialization', () => {
  it('serializes and deserializes clip instances through the project', () => {
    const setup = setupBase()
    const clipId = createTestClip(setup)
    const nodeId = createTestNode(setup)
    expectOk(
      setup.dispatcher.dispatch(
        new AssignClipCommand({
          nodeId,
          clipId,
          startTime: 1.5,
          speed: 2,
          enabled: false,
          paramOverrides: { gain: 0.75 },
        }),
      ),
    )

    const json = setup.engine.toJSON()
    expect(json.slides[0]?.scene.nodes.some((n) => n.clipInstances?.length === 1)).toBe(true)

    const engine2 = createEngine()
    engine2.restoreFromJSON(json)
    const instances = engine2.getClipInstances(nodeId)
    expect(instances).toHaveLength(1)
    expect(instances[0]!.clipId).toBe(clipId)
    expect(instances[0]!.startTime).toBe(1.5)
    expect(instances[0]!.speed).toBe(2)
    expect(instances[0]!.enabled).toBe(false)
    expect(instances[0]!.paramOverrides.gain).toBe(0.75)
  })
})
