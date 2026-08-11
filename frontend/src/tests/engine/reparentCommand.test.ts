import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  ReparentNodeCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithNodes() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId: aId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  const { nodeId: bId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'B' }),
    ),
  )
  return {
    system,
    rootId: slide.scene.root.id,
    cameraId: slide.scene.camera.id,
    aId,
    bId,
  }
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('ReparentNodeCommand', () => {
  it('moves a node under a new parent, records parameters and inverse, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: aId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    const { nodeId: bId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
        }),
      ),
    )
    const rootId = slide.scene.root.id
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: bId }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getNode(aId).parent?.id).toBe(bId)
    expect(system.engine.getNode(bId).children.map((child) => child.id)).toEqual([aId])
    expect(system.engine.getNode(rootId).children.map((child) => child.id)).not.toContain(aId)
    expect(inverse).toEqual({ nodeId: aId, oldParentId: rootId })
    expect(system.undoStack.entries[0]).toEqual({
      id: expect.any(String),
      type: 'ReparentNode',
      parameters: { nodeId: aId, parentId: bId },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`ReparentNode nodeId=${aId} parentId=${bId}`)
    expect(events).toEqual([{ type: 'NodeReparented', nodeId: aId }])
  })

  it('moves a node with its entire subtree intact', () => {
    const { system, aId, bId } = setupWithNodes()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: childId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: aId, name: 'Child' }),
      ),
    )

    expectOk(system.dispatcher.dispatch(new ReparentNodeCommand({ nodeId: aId, parentId: bId })))

    expect(system.engine.getNode(childId).parent?.id).toBe(aId)
    expect(system.engine.getNode(aId).children.map((child) => child.id)).toEqual([childId])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new ReparentNodeCommand({ nodeId: 'n1', parentId: 'p1' }).toJSON()).toEqual({
      type: 'ReparentNode',
      nodeId: 'n1',
      parentId: 'p1',
    })
  })

  it('rejects a nonexistent node and leaves engine, history, events, and log unchanged', () => {
    const log = vi.fn()
    const { system, rootId, aId } = setupWithNodes()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: 'ghost', parentId: rootId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.engine.getNode(aId).parent?.id).toBe(rootId)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects reparenting the root node', () => {
    const { system, rootId, aId } = setupWithNodes()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: rootId, parentId: aId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/root/i)
    }
    expect(system.engine.getNode(rootId).parent).toBeNull()
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects reparenting to a parent that does not exist', () => {
    const { system, rootId, aId } = setupWithNodes()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: 'ghost' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/parent.*not found/i)
    }
    expect(system.engine.getNode(aId).parent?.id).toBe(rootId)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects reparenting a node to itself', () => {
    const { system, aId } = setupWithNodes()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: aId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/itself|descendant/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects reparenting a node into its own descendant (cycle)', () => {
    const { system, aId } = setupWithNodes()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: childId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: aId, name: 'A-child' }),
      ),
    )
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: childId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/descendant/i)
    }
    expect(system.engine.getNode(aId).parent?.id).toBe(slide.scene.root.id)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects reparenting the camera node', () => {
    const { system, cameraId, bId } = setupWithNodes()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: cameraId, parentId: bId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })
})
