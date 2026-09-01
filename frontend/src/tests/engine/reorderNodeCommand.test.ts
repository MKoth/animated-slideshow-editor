import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  ReorderNodeCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithSiblings(log?: CommandLogger) {
  const system = createCommandSystem(log)
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const create = (name: string): string => {
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name,
        }),
      ),
    )
    return nodeId
  }
  return {
    system,
    rootId: slide.scene.root.id,
    cameraId: slide.scene.camera.id,
    a: create('A'),
    b: create('B'),
    c: create('C'),
    d: create('D'),
  }
}

function siblingNames(system: ReturnType<typeof createCommandSystem>): string[] {
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return slide.scene.root.children
    .filter((node) => !node.components.camera)
    .map((node) => node.name)
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('ReorderNodeCommand', () => {
  it('moves a node to an explicit sibling index, emits NodeOrderChanged, and records inverse data and a log entry', () => {
    const log = vi.fn()
    const { system, rootId, a } = setupWithSiblings(log)
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: a, index: 3 }))

    const inverse = expectOk(result)
    expect(siblingNames(system)).toEqual(['B', 'C', 'A', 'D'])
    expect(events).toEqual([{ type: 'NodeOrderChanged', nodeId: a }])
    expect(inverse).toEqual({ nodeId: a, parentId: rootId, oldIndex: 1 })
    expect(system.undoStack.entries[0]).toMatchObject({
      id: expect.any(String),
      type: 'ReorderNode',
      parameters: { nodeId: a, index: 3 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`ReorderNode nodeId=${a} index=3`)
  })

  it('moves a node to the front and to the back by index', () => {
    const { system, rootId, c } = setupWithSiblings()

    const toFront = expectOk(
      system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: c, index: 1 })),
    )
    expect(siblingNames(system)).toEqual(['C', 'A', 'B', 'D'])
    expect(toFront).toEqual({ nodeId: c, parentId: rootId, oldIndex: 3 })

    const toBack = expectOk(
      system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: c, index: 3 })),
    )
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
    expect(toBack).toEqual({ nodeId: c, parentId: rootId, oldIndex: 1 })
  })

  it('moves a node right after the camera without displacing it', () => {
    const { system, a, b } = setupWithSiblings()
    const { nodeId: e } = expectOk(
      (() => {
        const slide = system.engine.project?.slides[0]
        if (!slide) {
          throw new Error('expected a slide')
        }
        return system.dispatcher.dispatch(
          new CreateNodeCommand({
            sceneId: slide.scene.id,
            parentId: slide.scene.root.id,
            name: 'E',
          }),
        )
      })(),
    )
    expectOk(system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: b, index: 4 })))
    expectOk(system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: e, index: 1 })))

    expect(system.engine.getNode(a).parent?.children.map((node) => node.name)).toEqual([
      'Camera',
      'E',
      'A',
      'C',
      'D',
      'B',
    ])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new ReorderNodeCommand({ nodeId: 'n1', index: 2 }).toJSON()).toEqual({
      type: 'ReorderNode',
      nodeId: 'n1',
      index: 2,
    })
  })

  it('rejects a nonexistent node and leaves engine, history, events, and log unchanged', () => {
    const log = vi.fn()
    const { system } = setupWithSiblings()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: 'ghost', index: 2 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects the root node', () => {
    const { system, rootId } = setupWithSiblings()

    const result = system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: rootId, index: 2 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/root/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('rejects the camera node', () => {
    const { system, cameraId } = setupWithSiblings()

    const result = system.dispatcher.dispatch(
      new ReorderNodeCommand({ nodeId: cameraId, index: 2 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
  })

  it.each([[-1], [5], [1.5]])(
    'rejects a non-viable index %d and leaves the engine unchanged',
    (index) => {
      const { system, a } = setupWithSiblings()
      const undoCount = system.undoStack.entries.length

      const result = system.dispatcher.dispatch(
        new ReorderNodeCommand({ nodeId: a, index: index as number }),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toMatch(/index.*out of bounds/i)
      }
      expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
      expect(system.undoStack.entries).toHaveLength(undoCount)
    },
  )

  it('rejects moving a node to the index it already occupies', () => {
    const { system, b } = setupWithSiblings()
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new ReorderNodeCommand({ nodeId: b, index: 2 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/already at index/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
    expect(system.undoStack.entries).toHaveLength(undoCount)
  })
})
