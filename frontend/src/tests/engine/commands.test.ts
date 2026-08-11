import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { Command, CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  DeleteSlideCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupProjectWithSlide() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  const { slideId } = expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.getSlide(slideId)
  return {
    system,
    slideId,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
    cameraId: slide.scene.camera.id,
  }
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('command dispatcher', () => {
  it('executes a CreateProject command, records the undo stack, emits the event, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new CreateProjectCommand({ name: 'My Lesson', author: 'Tester' }),
    )

    expect(result).toEqual({ ok: true, inverse: { projectId: expect.any(String) } })
    expect(system.engine.project?.name).toBe('My Lesson')
    expect(system.engine.project?.author).toBe('Tester')
    const { projectId } = expectOk(result)
    expect(events).toEqual([{ type: 'ProjectCreated', projectId }])
    expect(system.undoStack.entries).toHaveLength(1)
    expect(system.undoStack.entries[0]).toEqual({
      id: expect.any(String),
      type: 'CreateProject',
      parameters: { name: 'My Lesson', author: 'Tester' },
      inverse: { projectId },
    })
    expect(log).toHaveBeenCalledWith('CreateProject name=My Lesson author=Tester')
  })

  it('rejects a second project without changing engine, undo stack, events, or log', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'One' })))
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Two' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/already exists/)
    }
    expect(system.engine.project?.name).toBe('One')
    expect(system.undoStack.entries).toHaveLength(1)
    expect(events).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('rejects a project with an empty name', () => {
    const system = createCommandSystem()

    const result = system.dispatcher.dispatch(new CreateProjectCommand({ name: '  ' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/name/i)
    }
    expect(system.engine.project).toBeNull()
  })

  it('records the undo stack newest first across command types', () => {
    const { system, sceneId, rootId } = setupProjectWithSlide()

    expectOk(
      system.dispatcher.dispatch(new CreateNodeCommand({ sceneId, parentId: rootId, name: 'A' })),
    )

    expect(system.undoStack.entries.map((entry) => entry.type)).toEqual([
      'CreateNode',
      'CreateSlide',
      'CreateProject',
    ])
  })

  it('logs every executed command with its parameters', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S' })))

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'CreateProject name=P',
      'CreateSlide name=S',
    ])
  })

  it('returns a failure result when a command throws during execution', () => {
    const system = createCommandSystem()
    const exploding: Command<never> = {
      type: 'Explode',
      parameters: { n: 1 },
      validate: () => undefined,
      execute: () => {
        throw new Error('boom')
      },
      toJSON: () => ({ type: 'Explode', n: 1 }),
    }

    const result = system.dispatcher.dispatch(exploding)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toBe('boom')
    }
    expect(system.undoStack.entries).toEqual([])
  })
})

describe('CreateSlideCommand', () => {
  it('creates a slide through the dispatcher and emits SlideCreated', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Intro' }))

    const { slideId } = expectOk(result)
    expect(system.engine.project?.slides.map((slide) => slide.name)).toEqual(['Intro'])
    expect(events).toEqual([{ type: 'SlideCreated', slideId }])
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'CreateSlide',
      parameters: { name: 'Intro' },
      inverse: { slideId },
    })
  })

  it('rejects a slide with an empty name', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new CreateSlideCommand({ name: '' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/name/i)
    }
    expect(system.engine.project?.slides).toEqual([])
    expect(system.undoStack.entries).toHaveLength(1)
    expect(events).toEqual([])
  })

  it('rejects a slide when no project exists', () => {
    const system = createCommandSystem()

    const result = system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Orphan' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/project/i)
    }
    expect(system.undoStack.entries).toEqual([])
  })
})

describe('DeleteSlideCommand', () => {
  it('removes a slide and records its removal snapshot as inverse', () => {
    const { system, slideId } = setupProjectWithSlide()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId }))

    const inverse = expectOk(result)
    expect(system.engine.project?.slides).toEqual([])
    expect(events).toEqual([{ type: 'SlideRemoved', slideId }])
    expect(inverse).toMatchObject({ slideId })
    expect(inverse.slideJSON).toMatchObject({ id: slideId, name: 'S1' })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'DeleteSlide',
      parameters: { slideId },
    })
  })

  it('rejects deleting a slide that does not exist', () => {
    const { system } = setupProjectWithSlide()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: 'ghost' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
    expect(system.engine.project?.slides).toHaveLength(1)
    expect(system.undoStack.entries).toHaveLength(2)
    expect(events).toEqual([])
  })

  it('rejects deleting a slide when no project exists', () => {
    const system = createCommandSystem()

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: 'x' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/project/i)
    }
  })
})

describe('CreateNodeCommand', () => {
  it('creates a node under the given parent and emits NodeCreated', () => {
    const { system, sceneId, rootId } = setupProjectWithSlide()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId, parentId: rootId, name: 'Fox' }),
    )

    const { nodeId } = expectOk(result)
    const node = system.engine.getNode(nodeId)
    expect(node.name).toBe('Fox')
    expect(node.parent?.id).toBe(rootId)
    expect(system.engine.getScene(sceneId).root.children.some((child) => child.id === nodeId)).toBe(
      true,
    )
    expect(events).toEqual([{ type: 'NodeCreated', nodeId }])
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'CreateNode',
      parameters: { sceneId, parentId: rootId, name: 'Fox' },
      inverse: { nodeId },
    })
  })

  it('creates a node with a requested id, transform, and visibility', () => {
    const { system, sceneId, rootId } = setupProjectWithSlide()

    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId,
          parentId: rootId,
          name: 'Hidden',
          id: 'node-custom',
          visible: false,
          transform: { x: 10, y: 20, rotation: 0, scaleX: 2, scaleY: 1 },
        }),
      ),
    )

    const node = system.engine.getNode(nodeId)
    expect(nodeId).toBe('node-custom')
    expect(node.visible).toBe(false)
    expect(node.transform).toEqual({ x: 10, y: 20, rotation: 0, scaleX: 2, scaleY: 1 })
  })

  it('rejects a node whose parent does not exist', () => {
    const { system, sceneId } = setupProjectWithSlide()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId, parentId: 'ghost', name: 'A' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/parent.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(2)
    expect(events).toEqual([])
  })

  it('rejects a node in a scene that does not exist', () => {
    const { system, rootId } = setupProjectWithSlide()

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: 'ghost-scene', parentId: rootId, name: 'A' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/scene.*not found/i)
    }
  })

  it('rejects a node with an empty name', () => {
    const { system, sceneId, rootId } = setupProjectWithSlide()

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId, parentId: rootId, name: ' ' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/name/i)
    }
  })

  it('rejects a node whose requested id is already taken', () => {
    const { system, sceneId, rootId, cameraId } = setupProjectWithSlide()

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId, parentId: rootId, name: 'Dup', id: cameraId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(new RegExp(`already exists`))
    }
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('rejects a second camera node in the same scene', () => {
    const { system, sceneId, rootId } = setupProjectWithSlide()

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId,
        parentId: rootId,
        name: 'Camera 2',
        components: { camera: { kind: 'camera' } },
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    const command = new CreateNodeCommand({
      sceneId: 'scene-1',
      parentId: 'root-1',
      name: 'A',
      visible: false,
    })

    expect(command.toJSON()).toEqual({
      type: 'CreateNode',
      sceneId: 'scene-1',
      parentId: 'root-1',
      name: 'A',
      visible: false,
    })
  })
})

describe('DeleteNodeCommand', () => {
  it('removes a node subtree and records it as inverse', () => {
    const { system, sceneId, rootId } = setupProjectWithSlide()
    const { nodeId: aId } = expectOk(
      system.dispatcher.dispatch(new CreateNodeCommand({ sceneId, parentId: rootId, name: 'A' })),
    )
    const { nodeId: bId } = expectOk(
      system.dispatcher.dispatch(new CreateNodeCommand({ sceneId, parentId: aId, name: 'B' })),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId: aId }))

    const inverse = expectOk(result)
    expect(system.engine.getScene(sceneId).root.children.some((child) => child.id === aId)).toBe(
      false,
    )
    expect(events).toEqual([{ type: 'NodeRemoved', nodeId: aId }])
    expect(inverse).toMatchObject({ nodeId: aId, parentId: rootId })
    expect(inverse.nodes.map((node) => node.id).sort()).toEqual([aId, bId].sort())
    expect(system.undoStack.entries[0]).toMatchObject({ type: 'DeleteNode' })
  })

  it('rejects deleting the root node', () => {
    const { system, rootId } = setupProjectWithSlide()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId: rootId }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/root/i)
    }
    expect(events).toEqual([])
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('rejects deleting the camera node', () => {
    const { system, cameraId } = setupProjectWithSlide()

    const result = system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId: cameraId }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
  })

  it('rejects deleting a node that does not exist', () => {
    const { system } = setupProjectWithSlide()

    const result = system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId: 'ghost' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
  })
})
