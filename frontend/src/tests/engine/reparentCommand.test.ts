import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import { identityTransform } from '../../engine/transform'
import { worldTransformOf } from '../../engine/worldTransform'
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
    expect(inverse).toEqual({ nodeId: aId, oldParentId: rootId, oldTransform: identityTransform() })
    expect(system.undoStack.entries[0]).toMatchObject({
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

  it('serializes to JSON with the index when one is given', () => {
    expect(new ReparentNodeCommand({ nodeId: 'n1', parentId: 'p1', index: 2 }).toJSON()).toEqual({
      type: 'ReparentNode',
      nodeId: 'n1',
      parentId: 'p1',
      index: 2,
    })
  })

  it('reparents a node into an exact slot when an index is given', () => {
    const { system, rootId, aId, bId } = setupWithNodes()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: cId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: bId, name: 'B1' }),
      ),
    )
    const { nodeId: dId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: bId, name: 'B2' }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: bId, index: 1 }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getNode(aId).parent?.id).toBe(bId)
    expect(system.engine.getNode(bId).children.map((child) => child.id)).toEqual([cId, aId, dId])
    expect(system.engine.getNode(rootId).children.map((child) => child.id)).not.toContain(aId)
    expect(inverse).toEqual({ nodeId: aId, oldParentId: rootId, oldTransform: identityTransform() })
    expect(system.undoStack.entries[0]).toMatchObject({
      id: expect.any(String),
      type: 'ReparentNode',
      parameters: { nodeId: aId, parentId: bId, index: 1 },
      inverse,
    })
    expect(events).toEqual([
      { type: 'NodeReparented', nodeId: aId },
      { type: 'NodeOrderChanged', nodeId: aId },
    ])
  })

  it('accepts an index that equals the append position without reordering', () => {
    const { system, rootId, aId, bId } = setupWithNodes()
    const { nodeId: cId } = expectOk(
      (() => {
        const slide = system.engine.project?.slides[0]
        if (!slide) {
          throw new Error('expected a slide')
        }
        return system.dispatcher.dispatch(
          new CreateNodeCommand({ sceneId: slide.scene.id, parentId: bId, name: 'B1' }),
        )
      })(),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: bId, index: 1 }),
    )

    expect(result.ok).toBe(true)
    expect(system.engine.getNode(bId).children.map((child) => child.id)).toEqual([cId, aId])
    expect(system.engine.getNode(rootId).children.map((child) => child.id)).not.toContain(aId)
    expect(events).toEqual([{ type: 'NodeReparented', nodeId: aId }])
  })

  it('rejects an out-of-bounds index and leaves the engine unchanged', () => {
    const { system, aId, bId, rootId } = setupWithNodes()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: bId, index: 5 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/index.*out of bounds/i)
    }
    expect(system.engine.getNode(aId).parent?.id).toBe(rootId)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a negative index and leaves the engine unchanged', () => {
    const { system, aId, bId, rootId } = setupWithNodes()
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: bId, index: -1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/index.*out of bounds/i)
    }
    expect(system.engine.getNode(aId).parent?.id).toBe(rootId)
    expect(system.undoStack.entries).toHaveLength(undoCount)
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

  it('keeps the world transform when the node moves under an offset parent', () => {
    const { system } = setupWithNodes()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: cId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'C',
          transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: dId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'D',
          transform: { x: 30, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const scene = system.engine.getScene(slide.scene.id)
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: cId, parentId: dId }),
    )

    expect(result.ok).toBe(true)
    expect(system.engine.getNode(cId).transform).toEqual({
      x: -20,
      y: -20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(worldTransformOf(scene, cId)).toEqual({
      x: 10,
      y: 20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(events).toEqual([
      { type: 'NodeReparented', nodeId: cId },
      { type: 'TransformChanged', nodeId: cId },
    ])
  })

  it('keeps the world transform when unparenting back to the root', () => {
    const { system, rootId } = setupWithNodes()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: dId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'D',
          transform: { x: 30, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: cId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: dId,
          name: 'C',
          transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const scene = system.engine.getScene(slide.scene.id)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: cId, parentId: rootId }),
    )

    expect(result.ok).toBe(true)
    expect(system.engine.getNode(cId).transform).toEqual({
      x: 40,
      y: 60,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(worldTransformOf(scene, cId)).toEqual({
      x: 40,
      y: 60,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('keeps the world rotation and scale across a scaled and rotated parent', () => {
    const { system } = setupWithNodes()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: dId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'D',
          transform: { x: 100, y: 0, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 },
        }),
      ),
    )
    const { nodeId: cId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'C',
          transform: { x: 5, y: 5, rotation: 0.3, scaleX: 1.5, scaleY: 1.5 },
        }),
      ),
    )
    const scene = system.engine.getScene(slide.scene.id)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: cId, parentId: dId }),
    )

    expect(result.ok).toBe(true)
    const local = system.engine.getNode(cId).transform
    expect(local.x).toBeCloseTo(2.5, 5)
    expect(local.y).toBeCloseTo(47.5, 5)
    expect(local.rotation).toBeCloseTo(0.3 - Math.PI / 2, 5)
    expect(local.scaleX).toBeCloseTo(0.75, 5)
    expect(local.scaleY).toBeCloseTo(0.75, 5)
    const world = worldTransformOf(scene, cId)
    if (!world) {
      throw new Error('expected a world transform')
    }
    expect(world.x).toBeCloseTo(5, 5)
    expect(world.y).toBeCloseTo(5, 5)
    expect(world.rotation).toBeCloseTo(0.3, 5)
    expect(world.scaleX).toBeCloseTo(1.5, 5)
    expect(world.scaleY).toBeCloseTo(1.5, 5)
  })

  it('leaves the transform untouched when nothing changes (no extra event)', () => {
    const { system, aId, bId } = setupWithNodes()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: aId, parentId: bId }),
    )

    expect(result.ok).toBe(true)
    expect(system.engine.getNode(aId).transform).toEqual(identityTransform())
    expect(events).toEqual([{ type: 'NodeReparented', nodeId: aId }])
  })
})
