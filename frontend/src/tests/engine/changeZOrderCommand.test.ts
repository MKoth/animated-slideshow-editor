import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  ChangeZOrderCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
  Z_ORDER_MODES,
} from '../../engine/commands'
import type { ZOrderMode } from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithSiblings() {
  const system = createCommandSystem()
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

describe('ChangeZOrderCommand', () => {
  it.each([
    ['bringForward', 'A', ['B', 'A', 'C', 'D']],
    ['sendBackward', 'D', ['A', 'B', 'D', 'C']],
    ['bringToFront', 'A', ['B', 'C', 'D', 'A']],
    ['sendToBack', 'D', ['D', 'A', 'B', 'C']],
  ])(
    '%s on %s reorders siblings, emits NodeOrderChanged, and records inverse data and a log entry',
    (mode, nodeName, expected) => {
      const log = vi.fn()
      const system = createCommandSystem(log)
      expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
      expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
      const slide = system.engine.project?.slides[0]
      if (!slide) {
        throw new Error('expected a slide')
      }
      const ids: Record<string, string> = {}
      for (const name of ['A', 'B', 'C', 'D']) {
        ids[name] = expectOk(
          system.dispatcher.dispatch(
            new CreateNodeCommand({
              sceneId: slide.scene.id,
              parentId: slide.scene.root.id,
              name,
            }),
          ),
        ).nodeId
      }
      const events = collectEvents(system)

      const result = system.dispatcher.dispatch(
        new ChangeZOrderCommand({ nodeId: ids[nodeName], mode: mode as ZOrderMode }),
      )

      const inverse = expectOk(result)
      expect(siblingNames(system)).toEqual(expected)
      expect(events).toEqual([{ type: 'NodeOrderChanged', nodeId: ids[nodeName] }])
      expect(inverse.nodeId).toBe(ids[nodeName])
      expect(inverse.parentId).toBe(slide.scene.root.id)
      expect(system.undoStack.entries[0]).toMatchObject({
        type: 'ChangeZOrder',
        parameters: { nodeId: ids[nodeName], mode },
        inverse,
      })
      expect(log).toHaveBeenCalledWith(`ChangeZOrder nodeId=${ids[nodeName]} mode=${mode}`)
      expect(inverse.oldIndex).toBeGreaterThanOrEqual(0)
    },
  )

  it('brings a middle node to the front and records its original index as inverse data', () => {
    const { system, rootId, a, c } = setupWithSiblings()

    const inverse = expectOk(
      system.dispatcher.dispatch(new ChangeZOrderCommand({ nodeId: c, mode: 'bringToFront' })),
    )

    expect(inverse).toEqual({ nodeId: c, parentId: rootId, oldIndex: 3 })
    expect(siblingNames(system)).toEqual(['A', 'B', 'D', 'C'])
    expect(system.engine.getNode(a).parent?.children.map((node) => node.name)).toEqual([
      'Camera',
      'A',
      'B',
      'D',
      'C',
    ])
  })

  it('sends a middle node to the back and records its original index as inverse data', () => {
    const { system, rootId, b } = setupWithSiblings()

    const inverse = expectOk(
      system.dispatcher.dispatch(new ChangeZOrderCommand({ nodeId: b, mode: 'sendToBack' })),
    )

    expect(inverse).toEqual({ nodeId: b, parentId: rootId, oldIndex: 2 })
    expect(siblingNames(system)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('rejects an unknown mode and leaves the engine unchanged', () => {
    const { system, a } = setupWithSiblings()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ChangeZOrderCommand({ nodeId: a, mode: 'spin' as ZOrderMode }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mode/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { system } = setupWithSiblings()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ChangeZOrderCommand({ nodeId: 'ghost', mode: 'bringForward' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects the root node', () => {
    const { system, rootId } = setupWithSiblings()

    const result = system.dispatcher.dispatch(
      new ChangeZOrderCommand({ nodeId: rootId, mode: 'bringToFront' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/root/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('rejects the camera node', () => {
    const { system, cameraId } = setupWithSiblings()

    const result = system.dispatcher.dispatch(
      new ChangeZOrderCommand({ nodeId: cameraId, mode: 'bringToFront' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
  })

  it.each([
    ['bringForward', 'D', 'front'],
    ['bringToFront', 'D', 'front'],
    ['sendBackward', 'A', 'back'],
    ['sendToBack', 'A', 'back'],
  ])('rejects a no-op %s on %s and leaves the engine unchanged', (mode, nodeName, edge) => {
    const { system, a, b, c, d } = setupWithSiblings()
    const ids = { A: a, B: b, C: c, D: d }
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ChangeZOrderCommand({
        nodeId: ids[nodeName as 'A' | 'B' | 'C' | 'D'],
        mode: mode as ZOrderMode,
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(new RegExp(edge))
    }
    expect(siblingNames(system)).toEqual(['A', 'B', 'C', 'D'])
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new ChangeZOrderCommand({ nodeId: 'n1', mode: 'bringToFront' }).toJSON()).toEqual({
      type: 'ChangeZOrder',
      nodeId: 'n1',
      mode: 'bringToFront',
    })
  })

  it('exports the canonical mode list', () => {
    expect(Z_ORDER_MODES).toEqual(['bringForward', 'sendBackward', 'bringToFront', 'sendToBack'])
  })
})
