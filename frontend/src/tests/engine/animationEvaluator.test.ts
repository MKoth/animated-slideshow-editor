import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import type { EnginePublic } from '../../engine'
import type { AnimationProperty, EvaluatedNodeScratch } from '../../engine'
import { evaluatedNodeScratch } from '../../engine/animationEvaluator'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveNodeCommand,
  SetOpacityCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function addKeyframe(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  property: AnimationProperty,
  time: number,
  value: number,
): void {
  expectOk(
    system.dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
    ),
  )
}

function setup() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const node = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  return { system, slide, nodeId: node.nodeId, cameraId: slide.scene.camera.id }
}

function evaluate(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  time: number,
  target?: EvaluatedNodeScratch,
) {
  return system.engine.evaluateNode(nodeId, time, target)
}

describe('AnimationEvaluator', () => {
  it('interpolates linearly between two keyframes at the beginning, middle, and end', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 1, 10)
    addKeyframe(system, nodeId, 'positionX', 3, 30)

    expect(evaluate(system, nodeId, 1).transform.x).toBe(10)
    expect(evaluate(system, nodeId, 1.5).transform.x).toBe(15)
    expect(evaluate(system, nodeId, 2).transform.x).toBe(20)
    expect(evaluate(system, nodeId, 3).transform.x).toBe(30)
  })

  it('holds the first keyframe value constant before the first keyframe', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 2, 5)
    addKeyframe(system, nodeId, 'positionX', 8, 15)

    expect(evaluate(system, nodeId, 0).transform.x).toBe(5)
    expect(evaluate(system, nodeId, 1).transform.x).toBe(5)
  })

  it('holds the last keyframe value constant after the last keyframe', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 2, 5)
    addKeyframe(system, nodeId, 'positionX', 8, 15)

    expect(evaluate(system, nodeId, 9).transform.x).toBe(15)
    expect(evaluate(system, nodeId, 10).transform.x).toBe(15)
  })

  it('a single keyframe holds its value everywhere in the slide', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 5, 7)

    expect(evaluate(system, nodeId, 0).transform.x).toBe(7)
    expect(evaluate(system, nodeId, 10).transform.x).toBe(7)
  })

  it('keeps the stored static value for properties without keyframes', () => {
    const { system } = setup()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId: staticNodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Static',
          transform: { x: 42, y: -7, rotation: 0.5, scaleX: 2, scaleY: 0.5 },
          opacity: 0.8,
        }),
      ),
    )
    addKeyframe(system, staticNodeId, 'positionX', 0, 100)

    const state = evaluate(system, staticNodeId, 10)
    expect(state.transform.x).toBe(100)
    expect(state.transform.y).toBe(-7)
    expect(state.transform.rotation).toBe(0.5)
    expect(state.transform.scaleX).toBe(2)
    expect(state.transform.scaleY).toBe(0.5)
    expect(state.opacity).toBe(0.8)
  })

  it('combines animated and static properties seamlessly per node', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 1, 10)
    addKeyframe(system, nodeId, 'positionX', 3, 30)
    addKeyframe(system, nodeId, 'scaleY', 0, 2)
    addKeyframe(system, nodeId, 'scaleY', 10, 4)

    const state = evaluate(system, nodeId, 2)
    expect(state.transform.x).toBe(20)
    expect(state.transform.scaleY).toBe(2.4)
    expect(state.transform.y).toBe(0)
    expect(state.transform.scaleX).toBe(1)
    expect(state.opacity).toBe(1)
  })

  it('evaluates multiple nodes independently', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const first = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'First',
          transform: { x: 1, y: 1, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const second = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Second',
          transform: { x: 50, y: 50, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const firstId = first.nodeId
    const secondId = second.nodeId
    addKeyframe(system, firstId, 'positionX', 0, 0)
    addKeyframe(system, firstId, 'positionX', 10, 100)
    addKeyframe(system, secondId, 'positionX', 0, 500)
    addKeyframe(system, secondId, 'positionX', 10, 900)

    const firstState = evaluate(system, firstId, 5)
    const secondState = evaluate(system, secondId, 5)
    expect(firstState.transform.x).toBe(50)
    expect(firstState.transform.y).toBe(1)
    expect(secondState.transform.x).toBe(700)
    expect(secondState.transform.y).toBe(50)
  })

  it('keeps opacity within [0, 1] across interpolation', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'opacity', 0, 0.25)
    addKeyframe(system, nodeId, 'opacity', 10, 1)

    expect(evaluate(system, nodeId, 0).opacity).toBe(0.25)
    expect(evaluate(system, nodeId, 5).opacity).toBe(0.625)
    expect(evaluate(system, nodeId, 10).opacity).toBe(1)
    for (const time of [1, 2.5, 7.75, 9]) {
      const opacity = evaluate(system, nodeId, time).opacity
      expect(opacity).toBeGreaterThanOrEqual(0)
      expect(opacity).toBeLessThanOrEqual(1)
    }
  })

  it('evaluates the camera node like any node, with rotation staying static', () => {
    const { system, cameraId } = setup()
    addKeyframe(system, cameraId, 'positionX', 0, 0)
    addKeyframe(system, cameraId, 'positionX', 10, 200)
    addKeyframe(system, cameraId, 'scaleX', 0, 1)
    addKeyframe(system, cameraId, 'scaleX', 10, 2)

    const state = evaluate(system, cameraId, 5)
    expect(state.transform.x).toBe(100)
    expect(state.transform.scaleX).toBe(1.5)
    expect(state.transform.rotation).toBe(0)
    expect(state.transform.y).toBe(0)
  })

  it('evaluates times outside [0, duration] as constant holds', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 1, 10)
    addKeyframe(system, nodeId, 'positionX', 3, 30)

    expect(evaluate(system, nodeId, -5).transform.x).toBe(10)
    expect(evaluate(system, nodeId, 50).transform.x).toBe(30)
  })

  it('rejects non-finite evaluation times', () => {
    const { system, nodeId } = setup()
    expect(() => evaluate(system, nodeId, Number.NaN)).toThrow()
    expect(() => evaluate(system, nodeId, Number.POSITIVE_INFINITY)).toThrow()
  })

  it('never mutates node or keyframe data', () => {
    const { system, nodeId } = setup()
    expectOk(system.dispatcher.dispatch(new SetOpacityCommand({ nodeId, opacity: 0.7 })))
    expectOk(system.dispatcher.dispatch(new MoveNodeCommand({ nodeId, x: 5, y: 6 })))
    addKeyframe(system, nodeId, 'positionX', 1, 10)
    addKeyframe(system, nodeId, 'opacity', 2, 0.5)
    const keyframes = system.engine.getKeyframes(nodeId, 'positionX')
    const keyframe = keyframes[0]
    if (!keyframe) {
      throw new Error('expected a keyframe')
    }
    const before = JSON.stringify(system.engine.toJSON())

    evaluate(system, nodeId, 0)
    evaluate(system, nodeId, 1.5)
    evaluate(system, nodeId, 10)

    expect(JSON.stringify(system.engine.toJSON())).toBe(before)
    expect(keyframe.time).toBe(1)
    expect(keyframe.value).toBe(10)
    const node = system.engine.getNode(nodeId)
    expect(node.transform).toEqual({ x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1 })
    expect(node.opacity).toBe(0.7)
  })

  it('writes into a provided scratch target without creating a new object', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 1, 10)
    addKeyframe(system, nodeId, 'positionX', 3, 30)

    const target = evaluatedNodeScratch()
    const first = system.engine.evaluateNode(nodeId, 2, target)
    expect(first).toBe(target)
    expect(target.transform.x).toBe(20)
    expect(target.opacity).toBe(1)

    const second = system.engine.evaluateNode(nodeId, 3, target)
    expect(second).toBe(target)
    expect(target.transform.x).toBe(30)
  })

  it('is exposed on the engine read API', () => {
    const { system, nodeId } = setup()
    addKeyframe(system, nodeId, 'positionX', 0, 10)
    addKeyframe(system, nodeId, 'positionX', 10, 20)

    const engine: EnginePublic = system.engine
    expect(engine.evaluateNode(nodeId, 5).transform.x).toBe(15)
  })
})
