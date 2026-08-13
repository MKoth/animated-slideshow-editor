import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyNodeFieldAutoKey,
  applyNodeName,
  applyNodeOpacityAutoKey,
  resetNodesTransformAutoKey,
} from '../app/inspectorActions'
import { usePlaybackController } from '../stores/playbackStore'
import {
  createNamedNode,
  mountInspector,
  transactionChildInverses,
  transactionChildTypes,
} from './inspectorHarness'

function scrub(engine: ReturnType<typeof mountInspector>['engine'], time: number): void {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  usePlaybackController.getState().setCurrentTime(slide.id, time, slide.duration)
}

beforeEach(() => {
  usePlaybackController.setState({ currentTimes: {} })
})

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

describe('applyNodeOpacityAutoKey', () => {
  it('clamps values above 1 and below 0 into keyframes at the playhead', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const nodeId = createNamedNode(engine, 'Kid', { opacity: 0.5 })
    scrub(engine, 1)

    const high = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], 1.5)
    expect(high?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 1).opacity).toBe(1)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters).toMatchObject({ nodeId, property: 'opacity', value: 1 })

    const low = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], -2)
    expect(low?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 1).opacity).toBe(0)
    expect(undoStack.entries[0].type).toBe('SetKeyframeValue')
    expect(undoStack.entries[0].parameters.newValue).toBe(0)
  })

  it('returns null and records nothing when the value is unchanged', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const nodeId = createNamedNode(engine, 'Kid', { opacity: 0.7 })
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], 0.7)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('composes one Transaction of per-object keyframe commands for a multi-selection', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid', { opacity: 0.4 })
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = applyNodeOpacityAutoKey(engine, dispatch, [nodeId, secondId], 0.75)

    expect(result?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0.75)
    expect(engine.evaluateNode(secondId, 0).opacity).toBe(0.75)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual(['AddKeyframe', 'AddKeyframe'])
    expect(transactionChildInverses(undoStack, 0)).toEqual([
      { nodeId, property: 'opacity', keyframeId: expect.any(String), time: 0, value: 0.75 },
      {
        nodeId: secondId,
        property: 'opacity',
        keyframeId: expect.any(String),
        time: 0,
        value: 0.75,
      },
    ])
  })
})

describe('applyNodeFieldAutoKey', () => {
  it('applies an X edit to every selected node in one Transaction', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId, secondId], 'x', 55)

    expect(result?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 0).transform.x).toBe(55)
    expect(engine.evaluateNode(secondId, 0).transform.x).toBe(55)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual(['AddKeyframe', 'AddKeyframe'])
    expect(transactionChildInverses(undoStack, 0)).toEqual([
      { nodeId, property: 'positionX', keyframeId: expect.any(String), time: 0, value: 55 },
      {
        nodeId: secondId,
        property: 'positionX',
        keyframeId: expect.any(String),
        time: 0,
        value: 55,
      },
    ])
  })

  it('applies a rotation edit in degrees, normalized, to every selected node', () => {
    const { dispatch, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    scrub(engine, 0)

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId, secondId], 'rotation', 450)

    expect(result?.ok).toBe(true)
    expect(engine.evaluateNode(nodeId, 0).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(engine.evaluateNode(secondId, 0).transform.rotation).toBeCloseTo(Math.PI / 2, 10)
  })

  it('rejects a zero scale for a multi edit without dispatching anything', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid')
    scrub(engine, 0)
    const before = undoStack.entries.length

    expect(() => applyNodeFieldAutoKey(engine, dispatch, [nodeId, secondId], 'scaleX', 0)).toThrow(
      /Scale X must not be zero/,
    )

    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'scaleX')).toHaveLength(0)
  })

  it('returns null when every node already has the value', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'x', 10)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })
})

describe('resetNodesTransformAutoKey', () => {
  it('resets every selected node through keyframes in one Transaction', () => {
    const { dispatch, undoStack, engine, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Kid', {
      transform: { x: 3, y: 4, rotation: 0.2, scaleX: 2, scaleY: 2 },
    })
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = resetNodesTransformAutoKey(engine, dispatch, [nodeId, secondId])

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(transactionChildTypes(undoStack, 0)).toEqual([
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
    ])
    expect(engine.evaluateNode(nodeId, 0).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('returns null when every node is already at identity', () => {
    const { dispatch, undoStack, engine } = mountInspector()
    const cleanId = createNamedNode(engine, 'Clean')
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = resetNodesTransformAutoKey(engine, dispatch, [cleanId])

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })
})
