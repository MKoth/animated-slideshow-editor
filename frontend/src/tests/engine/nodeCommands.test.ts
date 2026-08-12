import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  RenameNodeCommand,
  SetOpacityCommand,
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
  return { system, nodeId }
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('RenameNodeCommand', () => {
  it('renames a node, emits NodeRenamed, records parameters and inverse, and logs it', () => {
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
          name: 'Old',
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new RenameNodeCommand({ nodeId, name: 'New' }))

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).name).toBe('New')
    expect(events).toEqual([{ type: 'NodeRenamed', nodeId }])
    expect(inverse).toEqual({ nodeId, oldName: 'Old' })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'RenameNode',
      parameters: { nodeId, name: 'New' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`RenameNode nodeId=${nodeId} name=New`)
  })

  it('rejects an empty name and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new RenameNodeCommand({ nodeId, name: '  ' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/name/i)
    }
    expect(system.engine.getNode(nodeId).name).toBe('A')
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new RenameNodeCommand({ nodeId: 'ghost', name: 'X' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new RenameNodeCommand({ nodeId: 'n1', name: 'New name' }).toJSON()).toEqual({
      type: 'RenameNode',
      nodeId: 'n1',
      name: 'New name',
    })
  })
})

describe('SetOpacityCommand', () => {
  it('sets opacity, emits OpacityChanged, records parameters and inverse, and logs it', () => {
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
          opacity: 1,
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new SetOpacityCommand({ nodeId, opacity: 0.5 }))

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).opacity).toBe(0.5)
    expect(events).toEqual([{ type: 'OpacityChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldOpacity: 1 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetOpacity',
      parameters: { nodeId, opacity: 0.5 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`SetOpacity nodeId=${nodeId} opacity=0.5`)
  })

  it('rejects an opacity outside [0, 1] and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new SetOpacityCommand({ nodeId, opacity: 1.5 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/opacity/i)
    }
    expect(system.engine.getNode(nodeId).opacity).toBe(1)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a non-finite opacity and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithNode()

    const result = system.dispatcher.dispatch(
      new SetOpacityCommand({ nodeId, opacity: Number.NaN }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/opacity/i)
    }
    expect(system.engine.getNode(nodeId).opacity).toBe(1)
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new SetOpacityCommand({ nodeId: 'ghost', opacity: 1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new SetOpacityCommand({ nodeId: 'n1', opacity: 0.25 }).toJSON()).toEqual({
      type: 'SetOpacity',
      nodeId: 'n1',
      opacity: 0.25,
    })
  })
})
