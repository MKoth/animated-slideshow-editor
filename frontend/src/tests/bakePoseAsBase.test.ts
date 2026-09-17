import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import {
  AddClipChannelCommand,
  AddClipKeyframeCommand,
  AddKeyframeCommand,
  AssignClipCommand,
  CommandDispatcher,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetShadowEffectCommand,
  SetSlideDurationCommand,
  UndoStack,
} from '../engine/commands'
import { defaultTableComponent } from '../engine/defaultTable'
import { DEFAULT_SHADOW_EFFECT } from '../engine/shadowEffect'
import { normalizeRotation } from '../engine/transform'
import { executeBakePoseAsBase } from '../app/bakePoseAsBaseAction'

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
}

function expectOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) throw new Error(`expected a successful command, got: ${result.error?.message}`)
  return result.inverse as T
}

function setupEngine(): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  const slideId = expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))).slideId
  expectOk(dispatcher.dispatch(new SetSlideDurationCommand({ slideId, duration: 10 })))
  return { engine, dispatcher, undoStack }
}

function createNode(
  setup: Setup,
  name: string,
  transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
): string {
  const slide = setup.engine.getActiveSlide()!
  return expectOk(
    setup.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
        transform,
      }),
    ),
  ).nodeId
}

function bake(setup: Setup, rootNodeIds: readonly string[], time: number) {
  return executeBakePoseAsBase(
    setup.engine,
    setup.dispatcher.dispatch.bind(setup.dispatcher),
    setup.undoStack,
    { rootNodeIds, time },
  )
}

function expectBakeOk(result: ReturnType<typeof bake>): Extract<typeof result, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result
}

function poseSnapshot(engine: Engine, nodeId: string, time: number): string {
  const state = engine.evaluateNode(nodeId, time)
  return JSON.stringify({
    x: state.transform.x,
    y: state.transform.y,
    rotation: state.transform.rotation,
    scaleX: state.transform.scaleX,
    scaleY: state.transform.scaleY,
    opacity: state.opacity,
    zIndex: engine.evaluateZIndex(nodeId, time),
  })
}

describe('executeBakePoseAsBase', () => {
  it('bakes a clip-driven pose into rest, keeps the clip, and fixes the quiet tail', () => {
    const setup = setupEngine()
    const { engine, dispatcher, undoStack } = setup
    const nodeId = createNode(setup, 'Hand', { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 })
    const clipId = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 2, category: '' })),
    ).clipId
    expectOk(
      dispatcher.dispatch(
        new AddClipChannelCommand({ clipId, channel: { property: 'positionX' } }),
      ),
    )
    const target = { kind: 'clip', clipId, channel: 'positionX' } as const
    expectOk(dispatcher.dispatch(new AddClipKeyframeCommand({ target, time: 0, value: 10 })))
    expectOk(dispatcher.dispatch(new AddClipKeyframeCommand({ target, time: 1, value: 50 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId, clipId, startTime: 0, speed: 1 })))

    expect(engine.evaluateNode(nodeId, 1).transform.x).toBeCloseTo(30, 9)
    expect(engine.evaluateNode(nodeId, 3).transform.x).toBe(100)

    const baseline = undoStack.entries.length
    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.bakedNodeCount).toBe(1)
    expect(result.valueCount).toBe(1)
    expect(result.skipped).toEqual([])

    expect(engine.getNode(nodeId).transform.x).toBeCloseTo(30, 9)
    expect(engine.getNode(nodeId).transform.y).toBe(100)
    expect(engine.getNode(nodeId).clipInstances).toHaveLength(1)
    // Animated frame renders identically; the tail now falls back to the baked base.
    expect(engine.evaluateNode(nodeId, 1).transform.x).toBeCloseTo(30, 9)
    expect(engine.evaluateNode(nodeId, 3).transform.x).toBeCloseTo(30, 9)
    expect(undoStack.entries.length).toBe(baseline + 1)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.getNode(nodeId).transform.x).toBe(100)
    expect(engine.evaluateNode(nodeId, 3).transform.x).toBe(100)
  })

  it('keeps every animated frame identical while rebasing node keyframes', () => {
    const setup = setupEngine()
    const { engine, dispatcher } = setup
    const nodeId = createNode(setup, 'Limb')
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property: 'rotation' },
          time: 0,
          value: 0,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property: 'rotation' },
          time: 2,
          value: 90,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property: 'scaleX' },
          time: 0,
          value: 1,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property: 'scaleX' },
          time: 2,
          value: 2,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property: 'opacity' },
          time: 0,
          value: 1,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId, property: 'opacity' },
          time: 2,
          value: 0.5,
        }),
      ),
    )
    engine.addKeyframe({ kind: 'zIndex', nodeId }, 0, 7)
    engine.addKeyframe({ kind: 'zIndex', nodeId }, 2, 9)

    const times = [0, 0.5, 1, 1.5, 2]
    const snapshots = new Map(times.map((time) => [time, poseSnapshot(engine, nodeId, time)]))
    const posed = engine.evaluateNode(nodeId, 1)
    const posedZIndex = engine.evaluateZIndex(nodeId, 1)

    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.bakedNodeCount).toBe(1)
    expect(result.valueCount).toBe(4)

    for (const time of times) {
      expect(poseSnapshot(engine, nodeId, time)).toBe(snapshots.get(time))
    }
    // Keyframed tracks keep extrapolating to their own values (rebase, not freeze).
    expect(engine.evaluateZIndex(nodeId, 3)).toBe(9)

    const node = engine.getNode(nodeId)
    // Rest rotation is stored wrapped to [-π, π] by setTransform; same angle.
    expect(node.transform.rotation).toBeCloseTo(normalizeRotation(posed.transform.rotation), 9)
    expect(node.transform.scaleX).toBeCloseTo(posed.transform.scaleX, 9)
    expect(node.opacity).toBeCloseTo(posed.opacity, 9)
    expect(node.zIndex).toBe(posedZIndex)
  })

  it('bakes material parameter keyframes into the rest override', () => {
    const setup = setupEngine()
    const { engine } = setup
    const nodeId = createNode(setup, 'Box')
    engine.registerMaterialDefinition('mat-params', 'Params', [
      { key: 'uGlow', kind: 'float', default: 0.5 },
    ])
    engine.assignMaterial(nodeId, 'mat-params')
    engine.addKeyframe({ kind: 'node', nodeId, parameter: 'uGlow' }, 1, 0.9)

    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.valueCount).toBe(1)
    expect(engine.getNode(nodeId).material.overrides.uGlow).toBe(0.9)
    expect(engine.evaluateMaterialOverrides(nodeId, 1).uGlow).toBe(0.9)
  })

  it('bakes circle keyframes into the circle component', () => {
    const setup = setupEngine()
    const { engine } = setup
    const slide = engine.getActiveSlide()!
    const nodeId = expectOk(
      setup.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Wedge',
          components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
        }),
      ),
    ).nodeId
    engine.addKeyframe({ kind: 'circle', nodeId, property: 'radius' }, 1, 40)

    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.valueCount).toBe(1)
    expect(engine.getNode(nodeId).components.circle?.radius).toBe(40)
    expect(engine.evaluateCircle(nodeId, 1)?.radius).toBe(40)
  })

  it('bakes table keyframes into the table component', () => {
    const setup = setupEngine()
    const { engine } = setup
    const slide = engine.getActiveSlide()!
    const nodeId = expectOk(
      setup.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Grid',
          components: { table: defaultTableComponent() },
        }),
      ),
    ).nodeId
    engine.addKeyframe({ kind: 'table', nodeId, property: 'borderRadius' }, 1, 8)

    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.valueCount).toBe(1)
    expect(engine.getNode(nodeId).components.table?.borderRadius).toBe(8)
    expect(engine.getNode(nodeId).components.table?.padding).toBe(0)
    expect(engine.evaluateTable(nodeId, 1)?.borderRadius).toBe(8)
  })

  it('bakes shadow keyframes, rebasing opacity through node opacity', () => {
    const setup = setupEngine()
    const { engine, dispatcher } = setup
    const slide = engine.getActiveSlide()!
    const groupId = createNode(setup, 'Shadowed')
    expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: groupId, name: 'Child' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new SetShadowEffectCommand({
          nodeId: groupId,
          shadowEffect: { ...DEFAULT_SHADOW_EFFECT, auto: false },
        }),
      ),
    )
    engine.addKeyframe({ kind: 'node', nodeId: groupId, property: 'opacity' }, 1, 0.5)
    engine.addKeyframe({ kind: 'shadow', nodeId: groupId, property: 'blur' }, 1, 20)
    engine.addKeyframe({ kind: 'shadow', nodeId: groupId, property: 'opacity' }, 1, 0.5)
    expect(engine.evaluateShadow(groupId, 1)?.opacity).toBeCloseTo(0.25, 9)

    const result = expectBakeOk(bake(setup, [groupId], 1))
    expect(result.valueCount).toBe(3)
    const restShadow = engine.getNode(groupId).shadowEffect
    expect(restShadow?.blur).toBe(20)
    expect(restShadow?.opacity).toBeCloseTo(0.5, 9)
    expect(engine.getNode(groupId).opacity).toBeCloseTo(0.5, 9)
    expect(engine.evaluateShadow(groupId, 1)?.opacity).toBeCloseTo(0.25, 9)
    expect(engine.evaluateShadow(groupId, 1)?.blur).toBe(20)
  })

  it('collapses nested roots and merges multiple subtrees into one undo step', () => {
    const setup = setupEngine()
    const { engine, dispatcher, undoStack } = setup
    const slide = engine.getActiveSlide()!
    const parentId = createNode(setup, 'Parent')
    const childId = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId, name: 'Child2' }),
      ),
    ).nodeId
    engine.addKeyframe({ kind: 'node', nodeId: parentId, property: 'positionX' }, 1, 10)
    engine.addKeyframe({ kind: 'node', nodeId: childId, property: 'positionY' }, 1, 20)

    const baseline = undoStack.entries.length
    const result = expectBakeOk(bake(setup, [parentId, childId, parentId], 1))
    expect(result.bakedNodeCount).toBe(2)
    expect(result.valueCount).toBe(2)
    expect(engine.getNode(parentId).transform.x).toBe(10)
    expect(engine.getNode(childId).transform.y).toBe(20)
    expect(undoStack.entries.length).toBe(baseline + 1)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.getNode(parentId).transform.x).toBe(0)
    expect(engine.getNode(childId).transform.y).toBe(0)
  })

  it('reports animated state without a rest counterpart as skipped', () => {
    const setup = setupEngine()
    const { engine } = setup
    const nodeId = createNode(setup, 'Mirrored')
    engine.addKeyframe({ kind: 'symmetry', nodeId }, 1, { axis: 'x', factor: 1 })

    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.bakedNodeCount).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatch(/symmetry/)
  })

  it('reports non-uniform group scale instead of coercing the group', () => {
    const setup = setupEngine()
    const { engine } = setup
    const slide = engine.getActiveSlide()!
    const groupId = createNode(setup, 'Rig')
    expectOk(
      setup.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: groupId,
          name: 'Child',
        }),
      ),
    )
    engine.addKeyframe({ kind: 'node', nodeId: groupId, property: 'scaleX' }, 1, 2)
    engine.addKeyframe({ kind: 'node', nodeId: groupId, property: 'scaleY' }, 1, 1)

    const result = expectBakeOk(bake(setup, [groupId], 1))
    expect(result.skipped.some((entry) => /non-uniform group scale/.test(entry))).toBe(true)
    expect(engine.getNode(groupId).transform.scaleX).toBe(1)
    expect(engine.getNode(groupId).transform.scaleY).toBe(1)
  })

  it('is a no-op when the pose already matches rest', () => {
    const setup = setupEngine()
    const { engine, undoStack } = setup
    const nodeId = createNode(setup, 'Still', { x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1 })

    const baseline = undoStack.entries.length
    const result = expectBakeOk(bake(setup, [nodeId], 1))
    expect(result.bakedNodeCount).toBe(0)
    expect(result.valueCount).toBe(0)
    expect(result.message).toMatch(/Nothing to bake/)
    expect(undoStack.entries.length).toBe(baseline)
    expect(engine.getNode(nodeId).transform.x).toBe(5)
  })

  it('fails for an unknown root', () => {
    const setup = setupEngine()
    const result = bake(setup, ['missing'], 0)
    expect(result.ok).toBe(false)
  })
})
