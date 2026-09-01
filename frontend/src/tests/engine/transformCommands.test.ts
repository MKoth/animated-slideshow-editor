import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  SetVisibilityCommand,
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
  const cameraId = slide.scene.camera.id
  return { system, nodeId, cameraId }
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('MoveNodeCommand', () => {
  it('moves a node, emits TransformChanged, records parameters and inverse, and logs it', () => {
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
          transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new MoveNodeCommand({ nodeId, x: 100, y: -40 }))

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).transform).toEqual({
      x: 100,
      y: -40,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(events).toEqual([{ type: 'TransformChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldX: 10, oldY: 20 })
    expect(system.undoStack.entries[0]).toMatchObject({
      id: expect.any(String),
      type: 'MoveNode',
      parameters: { nodeId, x: 100, y: -40 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`MoveNode nodeId=${nodeId} x=100 y=-40`)
  })

  it('rejects a nonexistent node with a descriptive error and leaves everything unchanged', () => {
    const log = vi.fn()
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new MoveNodeCommand({ nodeId: 'ghost', x: 1, y: 1 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects non-finite coordinates', () => {
    const { system, nodeId } = setupWithNode()

    const result = system.dispatcher.dispatch(new MoveNodeCommand({ nodeId, x: Number.NaN, y: 1 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/x/i)
    }
    expect(system.engine.getNode(nodeId).transform.x).toBe(0)
    expect(system.undoStack.entries).toHaveLength(3)
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new MoveNodeCommand({ nodeId: 'n1', x: 5, y: 6 }).toJSON()).toEqual({
      type: 'MoveNode',
      nodeId: 'n1',
      x: 5,
      y: 6,
    })
  })
})

describe('RotateNodeCommand', () => {
  it('rotates a node, emits TransformChanged, records parameters and inverse, and logs it', () => {
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
          transform: { x: 0, y: 0, rotation: 0.5, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new RotateNodeCommand({ nodeId, rotation: 1.25 }))

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).transform.rotation).toBe(1.25)
    expect(events).toEqual([{ type: 'TransformChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldRotation: 0.5 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'RotateNode',
      parameters: { nodeId, rotation: 1.25 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`RotateNode nodeId=${nodeId} rotation=1.25`)
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new RotateNodeCommand({ nodeId: 'ghost', rotation: 1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a non-finite rotation', () => {
    const { system, nodeId } = setupWithNode()

    const result = system.dispatcher.dispatch(
      new RotateNodeCommand({ nodeId, rotation: Number.POSITIVE_INFINITY }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/rotation/i)
    }
    expect(system.undoStack.entries).toHaveLength(3)
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new RotateNodeCommand({ nodeId: 'n1', rotation: 2 }).toJSON()).toEqual({
      type: 'RotateNode',
      nodeId: 'n1',
      rotation: 2,
    })
  })
})

describe('rotation normalization', () => {
  it('stores rotations normalized into the [-π, π] range', () => {
    const { system, nodeId } = setupWithNode()

    expectOk(system.dispatcher.dispatch(new RotateNodeCommand({ nodeId, rotation: Math.PI * 1.5 })))

    expect(system.engine.getNode(nodeId).transform.rotation).toBeCloseTo(-Math.PI / 2, 10)
  })

  it('normalizes 450° to 90° and -405° to -45°', () => {
    const { system, nodeId } = setupWithNode()

    expectOk(
      system.dispatcher.dispatch(
        new RotateNodeCommand({ nodeId, rotation: (450 * Math.PI) / 180 }),
      ),
    )
    expect(system.engine.getNode(nodeId).transform.rotation).toBeCloseTo(Math.PI / 2, 10)

    expectOk(
      system.dispatcher.dispatch(
        new RotateNodeCommand({ nodeId, rotation: (-405 * Math.PI) / 180 }),
      ),
    )
    expect(system.engine.getNode(nodeId).transform.rotation).toBeCloseTo(-Math.PI / 4, 10)
  })

  it('records the inverse baseline from the normalized previous value', () => {
    const { system, nodeId } = setupWithNode()
    expectOk(system.dispatcher.dispatch(new RotateNodeCommand({ nodeId, rotation: 2 * Math.PI })))

    expect(system.engine.getNode(nodeId).transform.rotation).toBe(0)
    expect(system.undoStack.entries[0].type).toBe('RotateNode')
    expect(system.undoStack.entries[0].inverse).toMatchObject({ nodeId, oldRotation: 0 })
  })
})

describe('ScaleNodeCommand', () => {
  it('scales a node, emits TransformChanged, records parameters and inverse, and logs it', () => {
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
          transform: { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 3 },
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new ScaleNodeCommand({ nodeId, scaleX: 4, scaleY: 0.5 }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).transform).toMatchObject({ scaleX: 4, scaleY: 0.5 })
    expect(events).toEqual([{ type: 'TransformChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldScaleX: 2, oldScaleY: 3 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'ScaleNode',
      parameters: { nodeId, scaleX: 4, scaleY: 0.5 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`ScaleNode nodeId=${nodeId} scaleX=4 scaleY=0.5`)
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new ScaleNodeCommand({ nodeId: 'ghost', scaleX: 2, scaleY: 2 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects non-finite scale values', () => {
    const { system, nodeId } = setupWithNode()

    const result = system.dispatcher.dispatch(
      new ScaleNodeCommand({ nodeId, scaleX: Number.NaN, scaleY: 2 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/scale/i)
    }
    expect(system.undoStack.entries).toHaveLength(3)
  })

  it('accepts finite scale values including zero and negative (mirror)', () => {
    const { system, nodeId } = setupWithNode()

    const result = system.dispatcher.dispatch(
      new ScaleNodeCommand({ nodeId, scaleX: 0, scaleY: -1 }),
    )

    expect(result.ok).toBe(true)
    expect(system.engine.getNode(nodeId).transform).toMatchObject({ scaleX: 0, scaleY: -1 })
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new ScaleNodeCommand({ nodeId: 'n1', scaleX: 2, scaleY: 3 }).toJSON()).toEqual({
      type: 'ScaleNode',
      nodeId: 'n1',
      scaleX: 2,
      scaleY: 3,
    })
  })
})

describe('SetVisibilityCommand', () => {
  it('hides and shows a node, emits VisibilityChanged, records parameters and inverse, and logs it', () => {
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
          visible: true,
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new SetVisibilityCommand({ nodeId, visible: false }))

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).visible).toBe(false)
    expect(events).toEqual([{ type: 'VisibilityChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldVisible: true })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetVisibility',
      parameters: { nodeId, visible: false },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`SetVisibility nodeId=${nodeId} visible=false`)
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { system } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      new SetVisibilityCommand({ nodeId: 'ghost', visible: false }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new SetVisibilityCommand({ nodeId: 'n1', visible: true }).toJSON()).toEqual({
      type: 'SetVisibility',
      nodeId: 'n1',
      visible: true,
    })
  })
})

describe('transform commands and the camera node', () => {
  it('moves and scales the camera node like any node (pan and zoom)', () => {
    const { system, cameraId } = setupWithNode()
    const events = collectEvents(system)

    expectOk(system.dispatcher.dispatch(new MoveNodeCommand({ nodeId: cameraId, x: 120, y: 60 })))
    expectOk(
      system.dispatcher.dispatch(new ScaleNodeCommand({ nodeId: cameraId, scaleX: 2, scaleY: 2 })),
    )

    expect(system.engine.getNode(cameraId).transform).toEqual({
      x: 120,
      y: 60,
      rotation: 0,
      scaleX: 2,
      scaleY: 2,
    })
    expect(events).toEqual([
      { type: 'TransformChanged', nodeId: cameraId },
      { type: 'TransformChanged', nodeId: cameraId },
    ])
  })

  it('rejects any rotation change to the camera node', () => {
    const { system, cameraId } = setupWithNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length
    const before = system.engine.getNode(cameraId).transform

    const result = system.dispatcher.dispatch(
      new RotateNodeCommand({ nodeId: cameraId, rotation: 0.5 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
    expect(system.engine.getNode(cameraId).transform).toEqual(before)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('allows rotating the camera node to its current value (no-op, no lock violation)', () => {
    const { system, cameraId } = setupWithNode()

    const result = system.dispatcher.dispatch(
      new RotateNodeCommand({ nodeId: cameraId, rotation: 0 }),
    )

    expect(result.ok).toBe(true)
    expect(system.engine.getNode(cameraId).transform.rotation).toBe(0)
  })

  it('runs every command through the dispatcher without touching engine write methods', () => {
    const { system, nodeId } = setupWithNode()

    expectOk(system.dispatcher.dispatch(new MoveNodeCommand({ nodeId, x: 1, y: 1 })))
    expectOk(system.dispatcher.dispatch(new RotateNodeCommand({ nodeId, rotation: 0.5 })))
    expectOk(system.dispatcher.dispatch(new ScaleNodeCommand({ nodeId, scaleX: 2, scaleY: 2 })))
    expectOk(system.dispatcher.dispatch(new SetVisibilityCommand({ nodeId, visible: false })))

    expect(system.engine.getNode(nodeId).transform).toEqual({
      x: 1,
      y: 1,
      rotation: 0.5,
      scaleX: 2,
      scaleY: 2,
    })
    expect(system.engine.getNode(nodeId).visible).toBe(false)
    expect(system.undoStack.entries.map((entry) => entry.type)).toEqual([
      'SetVisibility',
      'ScaleNode',
      'RotateNode',
      'MoveNode',
      'CreateNode',
      'CreateSlide',
      'CreateProject',
    ])
  })
})
