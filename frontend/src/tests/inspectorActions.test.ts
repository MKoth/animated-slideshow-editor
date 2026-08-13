import { describe, expect, it } from 'vitest'
import type { DispatchCommand } from '../engine/commands'
import {
  CreateAssetInstanceCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CommandDispatcher,
  UndoStack,
} from '../engine/commands'
import { createEngine } from '../engine/internal'
import {
  applyNodePosition,
  applyNodeRotationDegrees,
  applyNodeScale,
  formatDecimal,
  parseFiniteNumber,
  radiansToDegrees,
  readNodeWorld,
  resetNodeTransform,
  rotationDegreesToRadians,
} from '../app/inspectorActions'

interface Harness {
  dispatch: DispatchCommand
  undoStack: UndoStack
  engine: ReturnType<typeof createEngine>
  nodeId: string
}

function mount(): Harness {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const definition = engine.defineAsset('Boy')
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        definitionId: definition.id,
        name: 'Boy',
        position: { x: 10, y: 20 },
        rotation: 0.5,
        scaleX: 2,
        scaleY: 3,
      }),
    ),
  )
  return { dispatch: (command) => dispatcher.dispatch(command), undoStack, engine, nodeId }
}

function expectOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error?.message ?? 'unknown error'}`)
  }
  return result.inverse as T
}

describe('parseFiniteNumber', () => {
  it('parses a plain decimal string', () => {
    expect(parseFiniteNumber('  -12.5 ', 'X')).toBe(-12.5)
  })

  it('rejects empty and whitespace-only strings', () => {
    expect(() => parseFiniteNumber('', 'X')).toThrow(/X must be a number/)
    expect(() => parseFiniteNumber('   ', 'X')).toThrow(/X must be a number/)
  })

  it('rejects NaN and Infinity with a meaningful error', () => {
    expect(() => parseFiniteNumber('abc', 'X')).toThrow(/X must be a finite number/)
    expect(() => parseFiniteNumber('NaN', 'Rotation')).toThrow(/Rotation must be a finite number/)
    expect(() => parseFiniteNumber('Infinity', 'Scale X')).toThrow(
      /Scale X must be a finite number/,
    )
  })
})

describe('rotation unit conversion', () => {
  it('converts degrees to radians and normalizes beyond ±360°', () => {
    expect(rotationDegreesToRadians(90)).toBeCloseTo(Math.PI / 2, 10)
    expect(rotationDegreesToRadians(450)).toBeCloseTo(Math.PI / 2, 10)
    expect(rotationDegreesToRadians(-405)).toBeCloseTo(-Math.PI / 4, 10)
    expect(rotationDegreesToRadians(360)).toBe(0)
    expect(rotationDegreesToRadians(-180)).toBeCloseTo(-Math.PI, 10)
  })

  it('converts radians back to degrees', () => {
    expect(radiansToDegrees(Math.PI / 2)).toBe(90)
    expect(radiansToDegrees(0)).toBe(0)
    expect(radiansToDegrees(Math.PI)).toBe(180)
  })

  it('formats decimals without trailing zeros', () => {
    expect(formatDecimal(12)).toBe('12')
    expect(formatDecimal(-4.5)).toBe('-4.5')
    expect(formatDecimal(1 / 3)).toBe('0.3333')
  })
})

describe('applyNodePosition', () => {
  it('dispatches a MoveNodeCommand and records the old position as inverse', () => {
    const { dispatch, undoStack, engine, nodeId } = mount()
    const before = undoStack.entries.length

    const result = applyNodePosition(engine, dispatch, nodeId, 100, -40)

    expect(result.ok).toBe(true)
    expect(engine.getNode(nodeId).transform.x).toBe(100)
    expect(engine.getNode(nodeId).transform.y).toBe(-40)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('MoveNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldX: 10, oldY: 20 })
  })
})

describe('applyNodeRotationDegrees', () => {
  it('dispatches a RotateNodeCommand with the normalized radians value', () => {
    const { dispatch, undoStack, engine, nodeId } = mount()

    applyNodeRotationDegrees(engine, dispatch, nodeId, 450)

    expect(engine.getNode(nodeId).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(undoStack.entries[0].type).toBe('RotateNode')
    expect(undoStack.entries[0].parameters.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldRotation: 0.5 })
  })
})

describe('applyNodeScale', () => {
  it('dispatches a ScaleNodeCommand with independent X and Y values', () => {
    const { dispatch, undoStack, engine, nodeId } = mount()

    const result = applyNodeScale(engine, dispatch, nodeId, 4, 0.5)

    expect(result.ok).toBe(true)
    expect(engine.getNode(nodeId).transform).toMatchObject({ scaleX: 4, scaleY: 0.5 })
    expect(undoStack.entries[0].type).toBe('ScaleNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldScaleX: 2, oldScaleY: 3 })
  })

  it('rejects zero scale without dispatching anything', () => {
    const { dispatch, undoStack, engine, nodeId } = mount()
    const before = undoStack.entries.length

    expect(() => applyNodeScale(engine, dispatch, nodeId, 0, 1)).toThrow(/Scale X must not be zero/)
    expect(() => applyNodeScale(engine, dispatch, nodeId, 1, 0)).toThrow(/Scale Y must not be zero/)

    expect(engine.getNode(nodeId).transform).toMatchObject({ scaleX: 2, scaleY: 3 })
    expect(undoStack.entries).toHaveLength(before)
  })

  it('accepts negative scale (mirror) as a finite non-zero value', () => {
    const { dispatch, engine, nodeId } = mount()

    const result = applyNodeScale(engine, dispatch, nodeId, -1, -2)

    expect(result.ok).toBe(true)
    expect(engine.getNode(nodeId).transform).toMatchObject({ scaleX: -1, scaleY: -2 })
  })
})

describe('resetNodeTransform', () => {
  it('returns a moved/scaled/rotated node to identity as one composite transaction', () => {
    const { dispatch, undoStack, engine, nodeId } = mount()
    const before = undoStack.entries.length

    const result = resetNodeTransform(engine, dispatch, nodeId)
    if (!result) {
      throw new Error('expected a transaction result')
    }

    expect(result.ok).toBe(true)
    expect(engine.getNode(nodeId).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(undoStack.entries).toHaveLength(before + 1)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('Transaction')
    const children = entry.parameters.commands as { type: string }[]
    expect(children.map((child) => child.type)).toEqual(['MoveNode', 'RotateNode', 'ScaleNode'])
    const inverses = (entry.inverse as { children: { inverse: unknown }[] }).children.map(
      (child) => child.inverse,
    )
    expect(inverses).toEqual([
      { nodeId, oldX: 10, oldY: 20 },
      { nodeId, oldRotation: 0.5 },
      { nodeId, oldScaleX: 2, oldScaleY: 3 },
    ])
  })

  it('records nothing when the transform is already identity', () => {
    const { dispatch, undoStack, engine, nodeId } = mount()

    applyNodePosition(engine, dispatch, nodeId, 0, 0)
    applyNodeRotationDegrees(engine, dispatch, nodeId, 0)
    const result = applyNodeScale(engine, dispatch, nodeId, 1, 1)
    expect(result.ok).toBe(true)
    const before = undoStack.entries.length

    const reset = resetNodeTransform(engine, dispatch, nodeId)

    expect(reset).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })
})

describe('world-unit editing under a transformed parent', () => {
  interface Parented {
    parentId: string
    childId: string
    engine: ReturnType<typeof createEngine>
    dispatch: DispatchCommand
    undoStack: UndoStack
  }

  function mountParented(): Parented {
    const engine = createEngine()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack)
    dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
    dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: {
        x: 100,
        y: 50,
        rotation: Math.PI / 2,
        scaleX: 2,
        scaleY: 2,
      },
    })
    const child = engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    return {
      parentId: parent.id,
      childId: child.id,
      engine,
      dispatch: (command) => dispatcher.dispatch(command),
      undoStack,
    }
  }

  it('reads the child position in world units (parent rotated and scaled)', () => {
    const { engine, childId } = mountParented()

    const reading = readNodeWorld(engine, childId)

    expect(reading).not.toBeNull()
    expect(reading?.world.x).toBeCloseTo(60, 10)
    expect(reading?.world.y).toBeCloseTo(70, 10)
    expect(reading?.world.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(reading?.world.scaleX).toBeCloseTo(2, 10)
    expect(reading?.world.scaleY).toBeCloseTo(2, 10)
  })

  it('converts a world position edit back into the local transform', () => {
    const { engine, dispatch, undoStack, childId } = mountParented()
    const before = undoStack.entries.length

    const result = applyNodePosition(engine, dispatch, childId, 60, 30)

    expect(result.ok).toBe(true)
    expect(engine.getNode(childId).transform.x).toBeCloseTo(-10, 10)
    expect(engine.getNode(childId).transform.y).toBeCloseTo(20, 10)
    expect(undoStack.entries).toHaveLength(before + 1)
  })

  it('converts a world rotation edit back into the local transform', () => {
    const { engine, dispatch, childId } = mountParented()

    applyNodeRotationDegrees(engine, dispatch, childId, 0)

    expect(engine.getNode(childId).transform.rotation).toBeCloseTo(-Math.PI / 2, 10)
  })

  it('converts a world scale edit back into the local transform', () => {
    const { engine, dispatch, childId } = mountParented()

    applyNodeScale(engine, dispatch, childId, 3, 1)

    expect(engine.getNode(childId).transform.scaleX).toBeCloseTo(1.5, 10)
    expect(engine.getNode(childId).transform.scaleY).toBeCloseTo(0.5, 10)
  })

  it('resets a parented node to world identity through local transforms', () => {
    const { engine, dispatch, undoStack, childId } = mountParented()
    const before = undoStack.entries.length

    const result = resetNodeTransform(engine, dispatch, childId)
    if (!result) {
      throw new Error('expected a transaction result')
    }

    expect(result.ok).toBe(true)
    const transform = engine.getNode(childId).transform
    expect(transform.x).toBeCloseTo(-25, 10)
    expect(transform.y).toBeCloseTo(50, 10)
    expect(transform.rotation).toBeCloseTo(-Math.PI / 2, 10)
    expect(transform.scaleX).toBeCloseTo(0.5, 10)
    expect(transform.scaleY).toBeCloseTo(0.5, 10)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })
})
