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
import { usePlaybackController } from '../stores/playbackStore'
import {
  applyNodeFieldAutoKey,
  applyNodeOpacityAutoKey,
  readEvaluatedNodeWorld,
  resetNodesTransformAutoKey,
} from '../app/inspectorActions'
import { evaluatedWorldTransformOf } from '../engine/worldTransform'
import {
  addKeyframeAtPlayhead,
  addPoseKeyframesAtPlayhead,
  evaluatedPropertyValue,
  propertyStateOf,
} from '../app/keyframeActions'
import { createNamedNode, mountInspector } from './inspectorHarness'

type Engine = ReturnType<typeof createEngine>

function scrub(engine: Engine, time: number): void {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  usePlaybackController.getState().setCurrentTime(slide.id, time, slide.duration)
}

function slideOf(engine: Engine): { id: string; duration: number } {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return slide
}

function addKeyframe(
  dispatch: DispatchCommand,
  nodeId: string,
  property: string,
  time: number,
  value: number,
): void {
  const result = dispatch(
    new AddKeyframeCommand({
      target: { kind: 'node', nodeId, property: property as 'positionX' },
      time,
      value,
    }),
  )
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error?.message}`)
  }
}

beforeEach(() => {
  usePlaybackController.setState({ currentTimes: {} })
})

describe('applyNodeFieldAutoKey', () => {
  it('creates a keyframe at the playhead time when the property is static', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    scrub(engine, 2.5)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'x', 100)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('AddKeyframe')
    expect(entry.parameters).toMatchObject({
      target: { kind: 'node', nodeId, property: 'positionX' },
      time: 2.5,
      value: 100,
    })
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(engine.evaluateNode(nodeId, 2.5).transform.x).toBe(100)
    expect(engine.getNode(nodeId).transform.x).toBe(10)
  })

  it('updates the keyframe under the playhead instead of creating a new one', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    addKeyframe(dispatch, nodeId, 'positionX', 2.5, 10)
    scrub(engine, 2.5)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'x', 42)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('SetKeyframeValue')
    expect(entry.parameters).toMatchObject({
      target: { kind: 'node', nodeId, property: 'positionX' },
      keyframeId: expect.any(String),
      newValue: 42,
    })
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(engine.evaluateNode(nodeId, 2.5).transform.x).toBe(42)
  })

  it('composes mixed add/update edits for multiple nodes into one transaction', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    const secondId = createNamedNode(engine, 'Second', { transform: { x: 5 } })
    addKeyframe(dispatch, secondId, 'positionX', 1, 5)
    scrub(engine, 1)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId, secondId], 'x', 99)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('Transaction')
    const children = entry.parameters.commands as { type: string }[]
    expect(children.map((child) => child.type)).toEqual(['AddKeyframe', 'SetKeyframeValue'])
    expect(engine.evaluateNode(nodeId, 1).transform.x).toBe(99)
    expect(engine.evaluateNode(secondId, 1).transform.x).toBe(99)
  })

  it('records nothing when the edit leaves the effective value unchanged', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    scrub(engine, 3)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'x', 10)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
  })

  it('records nothing when the edit matches the keyframe value under the playhead', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    addKeyframe(dispatch, nodeId, 'positionX', 2, 7)
    scrub(engine, 2)
    const before = undoStack.entries.length

    const result = applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'x', 7)

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
  })

  it('rejects zero scale without dispatching anything', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    scrub(engine, 1)
    const before = undoStack.entries.length

    expect(() => applyNodeFieldAutoKey(engine, dispatch, [nodeId], 'scaleX', 0)).toThrow(
      /Scale X must not be zero/,
    )

    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'scaleX')).toHaveLength(0)
  })

  it('stores the world-to-local converted value in the keyframe under a transformed parent', () => {
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
      transform: { x: 100, y: 50, rotation: 0, scaleX: 2, scaleY: 2 },
    })
    const child = engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    scrub(engine, 2)
    const dispatch: DispatchCommand = (command) => dispatcher.dispatch(command)

    const result = applyNodeFieldAutoKey(engine, dispatch, [child.id], 'x', 160)

    expect(result?.ok).toBe(true)
    const keyframe = engine.getKeyframes(child.id, 'positionX')[0]
    expect(keyframe?.value).toBeCloseTo(30, 10)
    expect(keyframe?.time).toBe(2)
    expect(engine.evaluateNode(child.id, 2).transform.x).toBeCloseTo(30, 10)
  })
})

describe('applyNodeOpacityAutoKey', () => {
  it('creates a clamped opacity keyframe at the playhead time', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    engine.setOpacity(nodeId, 0.4)
    scrub(engine, 1.5)

    const result = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], 1.5)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters).toMatchObject({
      target: { kind: 'node', nodeId, property: 'opacity' },
      time: 1.5,
      value: 1,
    })
    expect(engine.evaluateNode(nodeId, 1.5).opacity).toBe(1)
  })

  it('updates the opacity keyframe under the playhead', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    addKeyframe(dispatch, nodeId, 'opacity', 2, 0.5)
    scrub(engine, 2)

    const result = applyNodeOpacityAutoKey(engine, dispatch, [nodeId], 0.25)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries[0].type).toBe('SetKeyframeValue')
    expect(engine.evaluateNode(nodeId, 2).opacity).toBe(0.25)
    expect(engine.getKeyframes(nodeId, 'opacity')).toHaveLength(1)
  })
})

describe('resetNodesTransformAutoKey', () => {
  it('resets a node through five keyframes at the playhead', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    scrub(engine, 4)

    const result = resetNodesTransformAutoKey(engine, dispatch, [nodeId])

    expect(result?.ok).toBe(true)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = undoStack.entries[0].parameters.commands as {
      type: string
      target: { property: string }
      time: number
      value: number
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
    for (const child of children) {
      expect(child.time).toBe(4)
    }
    expect(engine.evaluateNode(nodeId, 4).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('records nothing when every property is already at its reset value', () => {
    const { engine, dispatch, undoStack } = mountInspector()
    const cleanId = createNamedNode(engine, 'Clean', {})
    scrub(engine, 0)
    const before = undoStack.entries.length

    const result = resetNodesTransformAutoKey(engine, dispatch, [cleanId])

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
  })

  it('resets a parented node to world identity through local keyframe values', () => {
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
      transform: { x: 100, y: 50, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 },
    })
    const child = engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    scrub(engine, 2)
    const dispatch: DispatchCommand = (command) => dispatcher.dispatch(command)

    const result = resetNodesTransformAutoKey(engine, dispatch, [child.id])

    expect(result?.ok).toBe(true)
    const keyframes = engine.getKeyframes(child.id, 'positionX')
    expect(keyframes[0]?.value).toBeCloseTo(-25, 10)
    expect(engine.getKeyframes(child.id, 'positionY')[0]?.value).toBeCloseTo(50, 10)
    expect(engine.evaluateNode(child.id, 2).transform).toMatchObject({
      x: expect.closeTo(-25, 10),
      y: expect.closeTo(50, 10),
    })
  })
})

describe('readEvaluatedNodeWorld', () => {
  it('reads the evaluated world at the playhead time', () => {
    const { engine, dispatch, nodeId } = mountInspector()
    addKeyframe(dispatch, nodeId, 'positionX', 0, 10)
    addKeyframe(dispatch, nodeId, 'positionX', 2, 30)
    scrub(engine, 1)

    const reading = readEvaluatedNodeWorld(engine, nodeId)

    expect(reading?.world.x).toBeCloseTo(20, 10)
    expect(reading?.world.y).toBe(20)
  })

  it('returns null for a node that is not part of any slide', () => {
    const engine = createEngine()
    expect(readEvaluatedNodeWorld(engine, 'ghost')).toBeNull()
  })
})

describe('evaluatedWorldTransformOf', () => {
  it('composes evaluated parent transforms into the world read', () => {
    const { engine, dispatch, nodeId } = mountInspector()
    addKeyframe(dispatch, nodeId, 'positionX', 0, 10)
    addKeyframe(dispatch, nodeId, 'positionX', 2, 30)
    scrub(engine, 1)

    const world = evaluatedWorldTransformOf(engine, nodeId, 1)

    expect(world?.x).toBeCloseTo(20, 10)
    expect(world?.rotation).toBeCloseTo(0.5, 10)
    expect(world?.scaleX).toBeCloseTo(2, 10)
  })
})

describe('evaluatedPropertyValue', () => {
  it('reads the interpolated local value of each property', () => {
    const { engine, dispatch, nodeId } = mountInspector()
    addKeyframe(dispatch, nodeId, 'positionX', 0, 10)
    addKeyframe(dispatch, nodeId, 'positionX', 2, 30)
    addKeyframe(dispatch, nodeId, 'opacity', 0, 1)
    addKeyframe(dispatch, nodeId, 'opacity', 2, 0.5)

    expect(evaluatedPropertyValue(engine, nodeId, 'positionX', 1)).toBe(20)
    expect(evaluatedPropertyValue(engine, nodeId, 'opacity', 1)).toBeCloseTo(0.75, 10)
    expect(evaluatedPropertyValue(engine, nodeId, 'positionY', 1)).toBe(20)
  })
})

describe('propertyStateOf', () => {
  it('reports static, animated and on-keyframe states', () => {
    const { engine, dispatch, nodeId } = mountInspector()

    expect(propertyStateOf(engine, nodeId, 'positionX', 0)).toBe('static')

    addKeyframe(dispatch, nodeId, 'positionX', 2, 10)

    expect(propertyStateOf(engine, nodeId, 'positionX', 1)).toBe('animated')
    expect(propertyStateOf(engine, nodeId, 'positionX', 2)).toBe('onKeyframe')
  })

  it('returns null for the camera rotation (not animatable)', () => {
    const { engine } = mountInspector()
    const cameraId = engine.project?.slides[0]?.scene.camera.id
    if (!cameraId) {
      throw new Error('expected a camera')
    }
    expect(propertyStateOf(engine, cameraId, 'rotation', 0)).toBeNull()
  })
})

describe('addKeyframeAtPlayhead', () => {
  it('creates a keyframe at the playhead with the evaluated value', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    const slide = slideOf(engine)
    addKeyframe(dispatch, nodeId, 'positionX', 0, 10)
    addKeyframe(dispatch, nodeId, 'positionX', 2, 30)
    scrub(engine, 1)
    const before = undoStack.entries.length

    const result = addKeyframeAtPlayhead(engine, dispatch, slide.id, nodeId, 'positionX')

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters).toMatchObject({
      target: { kind: 'node', nodeId, property: 'positionX' },
      time: 1,
      value: 20,
    })
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(3)
  })

  it('does nothing when a keyframe already sits exactly at the playhead', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    const slide = slideOf(engine)
    addKeyframe(dispatch, nodeId, 'positionX', 2, 10)
    scrub(engine, 2)
    const before = undoStack.entries.length

    const result = addKeyframeAtPlayhead(engine, dispatch, slide.id, nodeId, 'positionX')

    expect(result).toBeNull()
    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
  })
})

describe('addPoseKeyframesAtPlayhead', () => {
  it('pins every animatable property at the evaluated value, skipping occupied times', () => {
    const { engine, dispatch, undoStack, nodeId } = mountInspector()
    const slide = slideOf(engine)
    addKeyframe(dispatch, nodeId, 'positionX', 1, 10)
    scrub(engine, 1)
    const before = undoStack.entries.length

    const result = addPoseKeyframesAtPlayhead(engine, dispatch, slide.id, nodeId)

    expect(result?.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('Transaction')
    const children = entry.parameters.commands as { type: string; target: { property: string } }[]
    expect(children.map((child) => child.target.property)).toEqual([
      'positionY',
      'rotation',
      'scaleX',
      'scaleY',
      'opacity',
    ])
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(1)
    expect(engine.getKeyframes(nodeId, 'opacity')).toHaveLength(1)
  })

  it('pins five properties for the camera (no rotation)', () => {
    const { engine, dispatch, undoStack } = mountInspector()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const cameraId = slide.scene.camera.id
    scrub(engine, 0)

    const result = addPoseKeyframesAtPlayhead(engine, dispatch, slide.id, cameraId)

    expect(result?.ok).toBe(true)
    const entry = undoStack.entries[0]
    expect(entry.type).toBe('Transaction')
    const children = entry.parameters.commands as { type: string; target: { property: string } }[]
    expect(children.map((child) => child.target.property)).not.toContain('rotation')
    expect(children).toHaveLength(5)
  })
})
