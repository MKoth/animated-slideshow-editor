import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import {
  CommandDispatcher,
  CreateAssetInstanceCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setup(log?: CommandLogger) {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const definition = engine.defineAsset('Boy')
  return {
    engine,
    undoStack,
    dispatcher,
    slide,
    definition,
    definitionId: definition.id,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
  }
}

function collectEvents(engine: ReturnType<typeof createEngine>): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

describe('CreateAssetInstanceCommand', () => {
  it('creates instance, node, and attachment with new ids and placement defaults, emits NodeCreated, and never modifies the definition', () => {
    const log = vi.fn()
    const { engine, undoStack, dispatcher, slide, definition } = setup(log)
    const events = collectEvents(engine)

    const inverse = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          definitionId: definition.id,
          name: 'Boy',
          position: { x: 12, y: 34 },
        }),
      ),
    )

    const node = engine.getNode(inverse.nodeId)
    expect(inverse).toEqual({ nodeId: expect.any(String) })
    expect(node.id).not.toBe(definition.id)
    expect(engine.getScene(slide.scene.id).getNode(node.id)).toBe(node)
    expect(node.components.assetInstance).toEqual({
      kind: 'assetInstance',
      assetDefinitionId: definition.id,
    })
    expect(node.name).toBe('Boy')
    expect(node.transform).toEqual({ x: 12, y: 34, rotation: 0, scaleX: 1, scaleY: 1 })
    expect(node.opacity).toBe(1)
    expect(node.visible).toBe(true)
    expect(node.parent?.id).toBe(slide.scene.root.id)
    expect(events).toEqual([{ type: 'NodeCreated', nodeId: node.id }])
    expect(undoStack.entries[0]).toMatchObject({
      type: 'CreateAssetInstance',
      parameters: {
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        definitionId: definition.id,
        name: 'Boy',
        position: { x: 12, y: 34 },
      },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `CreateAssetInstance sceneId=${slide.scene.id} parentId=${slide.scene.root.id} ` +
        `definitionId=${definition.id} name=Boy position={"x":12,"y":34}`,
    )
    expect(engine.getAssetDefinition(definition.id).name).toBe('Boy')
  })

  it('rejects a nonexistent definition, leaving the engine, history, events, and log untouched', () => {
    const log = vi.fn()
    const { engine, undoStack, dispatcher, slide } = setup(log)
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        definitionId: 'ghost',
        name: 'Boy',
        position: { x: 0, y: 0 },
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/definition.*not found/i)
    }
    expect(slide.scene.root.children).toHaveLength(1)
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('rejects an unknown parent, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, sceneId, definitionId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId,
        parentId: 'ghost',
        definitionId,
        name: 'Boy',
        position: { x: 0, y: 0 },
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/parent.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects an unknown scene, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, rootId, definitionId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: 'ghost',
        parentId: rootId,
        definitionId,
        name: 'Boy',
        position: { x: 0, y: 0 },
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/scene.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects an empty name, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, sceneId, rootId, definitionId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId,
        parentId: rootId,
        definitionId,
        name: '   ',
        position: { x: 0, y: 0 },
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/name/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a non-finite position, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, sceneId, rootId, definitionId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId,
        parentId: rootId,
        definitionId,
        name: 'Boy',
        position: { x: Number.NaN, y: 0 },
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/finite/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('suffixes duplicate names within the slide: Boy, Boy (2), Boy (3)', () => {
    const { engine, dispatcher, sceneId, rootId, definitionId } = setup()

    const first = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )
    const second = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )
    const third = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )

    expect(engine.getNode(first.nodeId).name).toBe('Boy')
    expect(engine.getNode(second.nodeId).name).toBe('Boy (2)')
    expect(engine.getNode(third.nodeId).name).toBe('Boy (3)')
  })

  it('keeps an explicitly requested free suffixed name, and bumps a taken one', () => {
    const { engine, dispatcher, sceneId, rootId, definitionId } = setup()
    const first = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )
    const second = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy (2)',
          position: { x: 0, y: 0 },
        }),
      ),
    )
    const third = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy (2)',
          position: { x: 0, y: 0 },
        }),
      ),
    )
    const fourth = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )

    expect(engine.getNode(first.nodeId).name).toBe('Boy')
    expect(engine.getNode(second.nodeId).name).toBe('Boy (2)')
    expect(engine.getNode(third.nodeId).name).toBe('Boy (3)')
    expect(engine.getNode(fourth.nodeId).name).toBe('Boy (4)')
  })

  it('enforces uniqueness across the whole slide tree, not just the parent', () => {
    const { engine, dispatcher, sceneId, rootId, definitionId } = setup()
    const { nodeId: groupId } = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId,
          parentId: rootId,
          name: 'Group',
        }),
      ),
    )
    dispatcher.dispatch(new CreateNodeCommand({ sceneId, parentId: groupId, name: 'Boy' }))

    const created = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )

    expect(engine.getNode(created.nodeId).name).toBe('Boy (2)')
  })

  it('allows the same name again in a different slide', () => {
    const { engine, dispatcher, sceneId, rootId, definitionId } = setup()
    expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )
    const { slideId } = expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' })))
    const slide = engine.getSlide(slideId)

    const created = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          definitionId,
          name: 'Boy',
          position: { x: 0, y: 0 },
        }),
      ),
    )

    expect(engine.getNode(created.nodeId).name).toBe('Boy')
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new CreateAssetInstanceCommand({
        sceneId: 's1',
        parentId: 'n1',
        definitionId: 'd1',
        name: 'Boy',
        position: { x: 1, y: 2 },
      }).toJSON(),
    ).toEqual({
      type: 'CreateAssetInstance',
      sceneId: 's1',
      parentId: 'n1',
      definitionId: 'd1',
      name: 'Boy',
      position: { x: 1, y: 2 },
    })
  })
})

describe('CreateAssetInstanceCommand transform parameters', () => {
  it('creates the instance with the given rotation and scale when provided', () => {
    const { engine, dispatcher, sceneId, rootId, definitionId } = setup()
    const events = collectEvents(engine)

    const { nodeId } = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 12, y: 34 },
          rotation: 0.5,
          scaleX: 2,
          scaleY: 3,
        }),
      ),
    )

    expect(engine.getNode(nodeId).transform).toEqual({
      x: 12,
      y: 34,
      rotation: 0.5,
      scaleX: 2,
      scaleY: 3,
    })
    expect(events).toEqual([{ type: 'NodeCreated', nodeId }])
  })

  it('includes the transform parameters in the record and the log when provided', () => {
    const log = vi.fn()
    const { dispatcher, undoStack, sceneId, rootId, definitionId } = setup(log)
    const { nodeId } = expectOk(
      dispatcher.dispatch(
        new CreateAssetInstanceCommand({
          sceneId,
          parentId: rootId,
          definitionId,
          name: 'Boy',
          position: { x: 12, y: 34 },
          rotation: 0.5,
          scaleX: 2,
          scaleY: 3,
        }),
      ),
    )

    expect(undoStack.entries[0]).toMatchObject({
      type: 'CreateAssetInstance',
      parameters: {
        sceneId,
        parentId: rootId,
        definitionId,
        name: 'Boy',
        position: { x: 12, y: 34 },
        rotation: 0.5,
        scaleX: 2,
        scaleY: 3,
      },
      inverse: { nodeId },
    })
    expect(log).toHaveBeenCalledWith(
      `CreateAssetInstance sceneId=${sceneId} parentId=${rootId} definitionId=${definitionId} ` +
        `name=Boy position={"x":12,"y":34} rotation=0.5 scaleX=2 scaleY=3`,
    )
  })

  it('rejects a non-finite rotation, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, sceneId, rootId, definitionId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId,
        parentId: rootId,
        definitionId,
        name: 'Boy',
        position: { x: 0, y: 0 },
        rotation: Number.NaN,
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/finite/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a non-finite scale, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, sceneId, rootId, definitionId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId,
        parentId: rootId,
        definitionId,
        name: 'Boy',
        position: { x: 0, y: 0 },
        scaleX: Number.POSITIVE_INFINITY,
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/finite/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})
