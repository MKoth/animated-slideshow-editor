import { describe, expect, it } from 'vitest'
import {
  applyNodeField,
  applyNodeName,
  applyNodeOpacity,
  applyNodePosition,
  applyNodeRotationDegrees,
  applyNodeScale,
  resetNodesTransform,
} from '../app/inspectorActions'
import {
  createNamedNode,
  mountInspector,
  transactionChildInverses,
  transactionChildTypes,
} from './inspectorHarness'

describe('applyNodeName', () => {
  it('renames a single node and records the old name as inverse', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = applyNodeName(engine, dispatch, [nodeId], 'Hero')

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).name).toBe('Hero')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('RenameNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldName: 'Boy' })
  })

  it('returns null and records nothing when the name is unchanged', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = applyNodeName(engine, dispatch, [nodeId], 'Boy')

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('rejects empty and whitespace-only names without dispatching', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    expect(() => applyNodeName(engine, dispatch, [nodeId], '')).toThrow(
      /Node name must not be empty/,
    )
    expect(() => applyNodeName(engine, dispatch, [nodeId], '   ')).toThrow(
      /Node name must not be empty/,
    )

    expect(engine.getNode(nodeId).name).toBe('Boy')
    expect(undoStack.entries).toHaveLength(before)
  })

  it('trims surrounding whitespace from the requested name', () => {
    const { dispatch, engine, nodeId } = mountInspector()

    applyNodeName(engine, dispatch, [nodeId], '  Hero  ')

    expect(engine.getNode(nodeId).name).toBe('Hero')
  })

  it('composes one Transaction of per-object RenameNode commands for a multi-selection', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    const before = undoStack.entries.length

    const result = applyNodeName(engine, dispatch, [nodeId, secondId], 'Hero')

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).name).toBe('Hero')
    expect(engine.getNode(secondId).name).toBe('Hero (2)')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual(['RenameNode', 'RenameNode'])
    expect(transactionChildInverses(undoStack, 0)).toEqual([
      { nodeId, oldName: 'Boy' },
      { nodeId: secondId, oldName: 'Kid' },
    ])
  })

  it('auto-suffixes duplicates against the other selected objects within the slide', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    const before = undoStack.entries.length

    const result = applyNodeName(engine, dispatch, [nodeId, secondId], 'Boy')

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).name).toBe('Boy')
    expect(engine.getNode(secondId).name).toBe('Boy (2)')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildInverses(undoStack, 0)).toEqual([{ nodeId: secondId, oldName: 'Kid' }])
  })

  it('suffixes only within each slide when the selection spans slides', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    const slideTwo = engine.createSlide('S2')
    const thirdId = engine.createNode(slideTwo.scene.id, slideTwo.scene.root.id, 'Kid').id
    const before = undoStack.entries.length

    const result = applyNodeName(engine, dispatch, [nodeId, secondId, thirdId], 'Girl')

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).name).toBe('Girl')
    expect(engine.getNode(secondId).name).toBe('Girl (2)')
    expect(engine.getNode(thirdId).name).toBe('Girl')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(undoStack.entries[0].parameters.commands).toHaveLength(3)
  })
})

describe('applyNodeOpacity', () => {
  it('clamps values above 1 and below 0 for a single node', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const nodeId = createNamedNode(engine, 'Kid', { opacity: 0.5 })

    const high = applyNodeOpacity(engine, dispatch, [nodeId], 1.5)
    expect(high?.ok).toBe(true)
    expect(engine.getNode(nodeId).opacity).toBe(1)
    expect(undoStack.entries[0].type).toBe('SetOpacity')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldOpacity: 0.5 })

    const low = applyNodeOpacity(engine, dispatch, [nodeId], -2)
    expect(low?.ok).toBe(true)
    expect(engine.getNode(nodeId).opacity).toBe(0)
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldOpacity: 1 })
  })

  it('returns null and records nothing when the value is unchanged', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const nodeId = createNamedNode(engine, 'Kid', { opacity: 0.7 })
    const before = undoStack.entries.length

    const result = applyNodeOpacity(engine, dispatch, [nodeId], 0.7)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('composes one Transaction of per-object SetOpacity commands for a multi-selection', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid', { opacity: 0.4 })
    const before = undoStack.entries.length

    const result = applyNodeOpacity(engine, dispatch, [nodeId, secondId], 0.75)

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).opacity).toBe(0.75)
    expect(engine.getNode(secondId).opacity).toBe(0.75)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual(['SetOpacity', 'SetOpacity'])
    expect(transactionChildInverses(undoStack, 0)).toEqual([
      { nodeId, oldOpacity: 1 },
      { nodeId: secondId, oldOpacity: 0.4 },
    ])
  })
})

describe('applyNodeField', () => {
  it('applies an X edit to every selected node in one Transaction, preserving each node Y', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [nodeId, secondId], 'x', 55)

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).transform).toMatchObject({ x: 55, y: 20 })
    expect(engine.getNode(secondId).transform).toMatchObject({ x: 55, y: 0 })
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual(['MoveNode', 'MoveNode'])
    expect(transactionChildInverses(undoStack, 0)).toEqual([
      { nodeId, oldX: 10, oldY: 20 },
      { nodeId: secondId, oldX: 0, oldY: 0 },
    ])
  })

  it('applies a rotation edit in degrees, normalized, to every selected node', () => {
    const { dispatch, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')

    const result = applyNodeField(engine, dispatch, [nodeId, secondId], 'rotation', 450)

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(engine.getNode(secondId).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
  })

  it('rejects a zero scale for a multi edit without dispatching anything', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    const before = undoStack.entries.length

    expect(() => applyNodeField(engine, dispatch, [nodeId, secondId], 'scaleX', 0)).toThrow(
      /Scale X must not be zero/,
    )

    expect(engine.getNode(nodeId).transform).toMatchObject({ scaleX: 2, scaleY: 3 })
    expect(undoStack.entries).toHaveLength(before)
  })

  it('returns null when every node already has the value', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const before = undoStack.entries.length

    const result = applyNodeField(engine, dispatch, [nodeId], 'x', 10)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })
})

describe('resetNodesTransform', () => {
  it('resets every selected node in one Transaction, skipping nodes already at identity', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    const before = undoStack.entries.length

    const result = resetNodesTransform(engine, dispatch, [nodeId, secondId])

    expect(result?.ok).toBe(true)
    expect(engine.getNode(nodeId).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(engine.getNode(secondId).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual(['MoveNode', 'RotateNode', 'ScaleNode'])
  })

  it('returns null when every node is already at identity', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    applyNodePosition(engine, dispatch, nodeId, 0, 0)
    applyNodeRotationDegrees(engine, dispatch, nodeId, 0)
    applyNodeScale(engine, dispatch, nodeId, 1, 1)
    const before = undoStack.entries.length

    const result = resetNodesTransform(engine, dispatch, [nodeId])

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })
})
