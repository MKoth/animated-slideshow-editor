import { beforeEach, describe, expect, it } from 'vitest'
import type { DispatchCommand } from '../engine/commands'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
} from '../engine/commands'
import { createEngine } from '../engine/internal'
import {
  applyNodeField,
  applyNodeFieldAutoKey,
  applyNodeOpacity,
  applyNodeOpacityAutoKey,
  formatDecimal,
  parseFiniteNumber,
  radiansToDegrees,
  readEvaluatedNodeWorld,
  readStoredNodeWorld,
  resetNodesTransform,
  resetNodesTransformAutoKey,
  rotationDegreesToRadians,
} from '../app/inspectorActions'
import { usePlaybackController } from '../stores/playbackStore'
import { mountInspector, createNamedNode } from './inspectorHarness'

function scrub(engine: ReturnType<typeof createEngine>, time: number): void {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  usePlaybackController.getState().setCurrentTime(slide.id, time, slide.duration)
}

interface Parented {
  parentId: string
  childId: string
  engine: ReturnType<typeof createEngine>
  dispatch: DispatchCommand
  undoStack: UndoStack
}

function mountParented(rotation = Math.PI / 2): Parented {
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
      rotation,
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

beforeEach(() => {
  usePlaybackController.setState({ currentTimes: {} })
})

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

describe('applyNodeFieldAutoKey', () => {
  it('creates a position keyframe with the requested world value at the playhead', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    scrub(engine, 2)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'x', 100)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters).toMatchObject({
      target: { kind: 'node', nodeId, property: 'positionX' },
      time: 2,
      value: 100,
    })
    expect(engine.evaluateNode(nodeId, 2).transform.x).toBe(100)
  })

  it('normalizes a rotation edit into the keyframe value', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    scrub(engine, 0)

    applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'rotation', 450)

    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters.target).toEqual({
      kind: 'node',
      nodeId,
      property: 'rotation',
    })
    expect(undoStack.entries[0].parameters.value).toBeCloseTo(Math.PI / 2, 10)
    expect(engine.evaluateNode(nodeId, 0).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
  })

  it('edits scale X independently of scale Y through keyframes', () => {
    const { dispatch, engine, nodeId } = mountInspector()
    scrub(engine, 0)

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'scaleX', 4)

    expect(result?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 0).transform.scaleX).toBe(4)
    expect(engine.evaluateNode(nodeId, 0).transform.scaleY).toBe(3)
  })

  it('accepts negative scale (mirror) as a finite non-zero value', () => {
    const { dispatch, engine, nodeId } = mountInspector()
    scrub(engine, 0)

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'scaleX', -1)

    expect(result?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 0).transform.scaleX).toBe(-1)
  })

  it('rejects zero scale without dispatching anything', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    scrub(engine, 0)
    const before = undoStack.entries.length

    expect(() => applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'scaleX', 0)).toThrow(
      /Scale X must not be zero/,
    )

    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'scaleX')).toHaveLength(0)
  })
})

describe('applyNodeField (base mode)', () => {
  it('dispatches a MoveNode with inverse data for an X edit, touching no keyframes', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [nodeId], 'x', 100)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('MoveNode')
    expect(entry.parameters).toMatchObject({ nodeId, x: 100, y: 20 })
    expect(entry.inverse).toEqual({ nodeId, oldX: 10, oldY: 20 })
    expect(engine.getNode(nodeId).transform.x).toBe(100)
    expect(engine.getNode(nodeId).transform.y).toBe(20)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
  })

  it('dispatches a RotateNode with inverse data for a rotation edit', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [nodeId], 'rotation', 90)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('RotateNode')
    expect(undoStack.entries[0].parameters.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldRotation: 0.5 })
    expect(engine.getNode(nodeId).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
  })

  it('dispatches a ScaleNode with inverse data for a scale X edit, keeping Y', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()

    const result = applyNodeField(engine, dispatch, [nodeId], 'scaleX', 4)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries[0].type).toBe('ScaleNode')
    expect(undoStack.entries[0].parameters).toMatchObject({ nodeId, scaleX: 4, scaleY: 3 })
    expect(undoStack.entries[0].inverse).toEqual({
      nodeId,
      oldScaleX: 2,
      oldScaleY: 3,
    })
  })

  it('returns null and records nothing when the value is unchanged', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [nodeId], 'x', 10)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('rejects zero scale without dispatching anything', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    expect(() => applyNodeField(engine, dispatch, [nodeId], 'scaleX', 0)).toThrow(
      /Scale X must not be zero/,
    )

    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getNode(nodeId).transform.scaleX).toBe(2)
  })

  it('composes one Transaction of per-node MoveNode commands for a multi-selection', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid', { transform: { x: 5 } })
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [nodeId, secondId], 'x', 55)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = undoStack.entries[0].parameters.commands as {
      type: string
      nodeId: string
    }[]
    expect(children.map((child) => child.type)).toEqual(['MoveNode', 'MoveNode'])
    expect(children.map((child) => child.nodeId)).toEqual([nodeId, secondId])
    expect(engine.getNode(nodeId).transform.x).toBe(55)
    expect(engine.getNode(secondId).transform.x).toBe(55)
  })

  it('converts a world position edit back into the stored local value under a parent', () => {
    const { engine, dispatch, undoStack, childId } = mountParented(0)
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [childId], 'x', 60)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].parameters).toMatchObject({ nodeId: childId, x: -20, y: 20 })
    expect(engine.getNode(childId).transform.x).toBe(-20)
  })
})

describe('applyNodeOpacity (base mode)', () => {
  it('dispatches a clamped SetOpacityCommand with inverse data', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    engine.setOpacity(nodeId, 0.4)
    const before = undoStack.entries.length

    const result = applyNodeOpacity(engine, dispatch, [nodeId], 1.5)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('SetOpacity')
    expect(undoStack.entries[0].parameters).toMatchObject({ nodeId, opacity: 1 })
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldOpacity: 0.4 })
    expect(engine.getNode(nodeId).opacity).toBe(1)
    expect(engine.getKeyframes(nodeId, 'opacity')).toHaveLength(0)
  })

  it('returns null and records nothing when the value is unchanged', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    engine.setOpacity(nodeId, 0.7)
    const before = undoStack.entries.length

    const result = applyNodeOpacity(engine, dispatch, [nodeId], 0.7)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('composes one Transaction of per-node SetOpacityCommand for a multi-selection', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid', { opacity: 0.4 })
    const before = undoStack.entries.length

    const result = applyNodeOpacity(engine, dispatch, [nodeId, secondId], 0.75)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = undoStack.entries[0].parameters.commands as {
      type: string
      nodeId: string
      opacity: number
    }[]
    expect(children.map((child) => child.type)).toEqual(['SetOpacity', 'SetOpacity'])
    expect(children.map((child) => child.opacity)).toEqual([0.75, 0.75])
    expect(engine.getNode(nodeId).opacity).toBe(0.75)
    expect(engine.getNode(secondId).opacity).toBe(0.75)
  })
})

describe('resetNodesTransform (base mode)', () => {
  it('resets a transformed node through Move/Rotate/Scale commands with inverse data', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = resetNodesTransform(engine, dispatch, [nodeId])

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = undoStack.entries[0].parameters.commands as {
      type: string
      nodeId: string
    }[]
    expect(children.map((child) => child.type)).toEqual(['MoveNode', 'RotateNode', 'ScaleNode'])
    const inverse = undoStack.entries[0].inverse as { children: { inverse: unknown }[] }
    expect(inverse.children.map((child) => child.inverse)).toEqual([
      { nodeId, oldX: 10, oldY: 20 },
      { nodeId, oldRotation: 0.5 },
      { nodeId, oldScaleX: 2, oldScaleY: 3 },
    ])
    expect(engine.getNode(nodeId).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
  })

  it('records nothing when the transform is already identity', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const cleanId = createNamedNode(engine, 'Clean')
    const before = undoStack.entries.length

    const result = resetNodesTransform(engine, dispatch, [cleanId])

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('resets every selected node through stored commands in one Transaction', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid', { transform: { x: 3, y: 4 } })
    const before = undoStack.entries.length

    const result = resetNodesTransform(engine, dispatch, [nodeId, secondId])

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = undoStack.entries[0].parameters.commands as { type: string }[]
    expect(children.map((child) => child.type)).toEqual([
      'MoveNode',
      'RotateNode',
      'ScaleNode',
      'MoveNode',
      'RotateNode',
      'ScaleNode',
    ])
  })
})

describe('readStoredNodeWorld (base mode)', () => {
  it('reads the stored world, ignoring keyframes and the playhead', () => {
    const { engine, dispatch, nodeId } = mountInspector()
    dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, property: 'positionX' },
        time: 0,
        value: 200,
      }),
    )
    dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, property: 'positionX' },
        time: 2,
        value: 400,
      }),
    )
    scrub(engine, 1)

    const reading = readStoredNodeWorld(engine, nodeId)

    expect(reading?.world.x).toBe(10)
    expect(reading?.world.y).toBe(20)
  })

  it('returns null for a node that is not part of any slide', () => {
    const engine = createEngine()
    expect(readStoredNodeWorld(engine, 'ghost')).toBeNull()
  })
})

describe('applyNodeOpacityAutoKey', () => {
  it('creates a clamped opacity keyframe at the playhead', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const nodeId = createNamedNode(engine, 'Kid', { opacity: 0.5 })
    scrub(engine, 1)

    const result = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], 1.5)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters.value).toBe(1)
    expect(engine.evaluateNode(nodeId, 1).opacity).toBe(1)
  })

  it('updates the keyframe under the playhead', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const nodeId = createNamedNode(engine, 'Kid', { opacity: 0.5 })
    dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, property: 'opacity' },
        time: 1,
        value: 0.5,
      }),
    )
    scrub(engine, 1)

    const result = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], 0.25)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries[0].type).toBe('SetKeyframeValue')
    expect(engine.evaluateNode(nodeId, 1).opacity).toBe(0.25)
  })
})

describe('resetNodesTransformAutoKey', () => {
  it('returns a moved/scaled/rotated node to identity as keyframes at the playhead', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    scrub(engine, 3)
    const before = undoStack.entries.length

    const result = resetNodesTransformAutoKey(engine, dispatch, [nodeId])
    if (!result) {
      throw new Error('expected a transaction result')
    }

    expect(result.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = undoStack.entries[0].parameters.commands as {
      type: string
      target: { property: string }
    }[]
    expect(children.map((child) => child.type)).toEqual([
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
    ])
    expect(children.map((child) => child.target.property)).toEqual([
      'positionX',
      'positionY',
      'rotation',
      'scaleX',
      'scaleY',
    ])
    expect(engine.evaluateNode(nodeId, 3).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('records nothing when the transform is already identity', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const cleanId = createNamedNode(engine, 'Clean')
    scrub(engine, 0)
    const before = undoStack.entries.length

    const reset = resetNodesTransformAutoKey(engine, dispatch, [cleanId])

    expect(reset).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })
})

describe('world-unit editing under a transformed parent', () => {
  it('reads the child position in world units (parent rotated and scaled)', () => {
    const { engine, childId } = mountParented()
    scrub(engine, 0)

    const reading = readEvaluatedNodeWorld(engine, childId)

    expect(reading).not.toBeNull()
    expect(reading?.world.x).toBeCloseTo(60, 10)
    expect(reading?.world.y).toBeCloseTo(70, 10)
    expect(reading?.world.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(reading?.world.scaleX).toBeCloseTo(2, 10)
    expect(reading?.world.scaleY).toBeCloseTo(2, 10)
  })

  it('converts a world position edit back into the local keyframe value', () => {
    const { engine, dispatch, undoStack, childId } = mountParented(0)
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [childId], 'x', 60)

    expect(result?.ok).toBe(true)
    const keyframe = engine.getKeyframes(childId, 'positionX')[0]
    expect(keyframe?.value).toBeCloseTo(-20, 10)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
  })

  it('converts a world rotation edit back into the local keyframe value', () => {
    const { engine, dispatch, childId } = mountParented()
    scrub(engine, 0)

    applyNodeFieldAutoKey(engine, dispatch, [childId], 'rotation', 0)

    expect(engine.getKeyframes(childId, 'rotation')[0]?.value).toBeCloseTo(-Math.PI / 2, 10)
  })

  it('converts a world scale edit back into the local keyframe value', () => {
    const { engine, dispatch, childId } = mountParented()
    scrub(engine, 0)

    applyNodeFieldAutoKey(engine, dispatch, [childId], 'scaleX', 3)

    expect(engine.getKeyframes(childId, 'scaleX')[0]?.value).toBeCloseTo(1.5, 10)
  })

  it('resets a parented node to world identity through local keyframe values', () => {
    const { engine, dispatch, undoStack, childId } = mountParented()
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = resetNodesTransformAutoKey(engine, dispatch, [childId])
    if (!result) {
      throw new Error('expected a transaction result')
    }

    expect(result.ok).toBe(true)
    expect(engine.getKeyframes(childId, 'positionX')[0]?.value).toBeCloseTo(-25, 10)
    expect(engine.getKeyframes(childId, 'positionY')[0]?.value).toBeCloseTo(50, 10)
    expect(engine.getKeyframes(childId, 'rotation')[0]?.value).toBeCloseTo(-Math.PI / 2, 10)
    expect(engine.getKeyframes(childId, 'scaleX')[0]?.value).toBeCloseTo(0.5, 10)
    expect(engine.getKeyframes(childId, 'scaleY')[0]?.value).toBeCloseTo(0.5, 10)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })

  it('reflects parent animation in the world read', () => {
    const { engine, dispatch, childId } = mountParented(0)
    dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: childId, property: 'positionX' },
        time: 0,
        value: 10,
      }),
    )
    dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: childId, property: 'positionX' },
        time: 2,
        value: 30,
      }),
    )
    scrub(engine, 1)

    const reading = readEvaluatedNodeWorld(engine, childId)

    // child world x interpolates 120 -> 160 while the parent is static
    expect(reading?.world.x).toBeCloseTo(140, 10)
  })
})
