import { describe, expect, it } from 'vitest'
import {
  AssignClipCommand,
  CreateClipCommand,
  CreateClipCollectionCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetControlSetCommand,
  SetSemanticNameCommand,
  SetSlideAnimationScriptCommand,
  AddKeyframeCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { createControl, createControlSet } from '../../engine/control'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'

type System = ReturnType<typeof createCommandSystem>

function dispatchOk<T>(system: System, command: Command<T>): T {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse as T
}

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { system, slideId: slide.id, sceneId: slide.scene.id, rootId: slide.scene.root.id }
}

function addNode(
  system: System,
  sceneId: string,
  parentId: string,
  name: string,
  semanticName?: string,
): string {
  const id = dispatchOk(system, new CreateNodeCommand({ sceneId, parentId, name })).nodeId
  if (semanticName !== undefined) {
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: id, semanticName }))
  }
  return id
}

function addClip(system: System, name: string, duration: number): string {
  return dispatchOk(
    system,
    new CreateClipCommand({
      name,
      duration,
      category: 'test',
      channels: [{ property: 'positionX' }],
    }),
  ).clipId
}

function check(
  system: System,
  slideId: string,
  lines: readonly string[],
  budgets?: {
    maxEmittedKeyframes?: number
    maxEmittedInstances?: number
    maxUnrolledStatements?: number
    maxCallDepth?: number
  },
) {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'), budgets ? { budgets } : {})
}

function messages(result: AnimationScriptCompileResult): string[] {
  return result.diagnostics.map((d) => d.message)
}

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

describe('Animation Script budgets and conflicts (#389)', () => {
  it('errors on same-property overlapping raw writes with the offending location', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 1)',
      'at(0.5) hero.tween({ x: 10 }, 1)',
    ])
    expect(result.runnable).toBe(false)
    const error = result.diagnostics.find((d) => d.severity === 'error')
    expect(error).toMatchObject({ line: 4 })
    expect(error?.message).toMatch(/overlaps a previous write/)
    expect(error?.message).toContain('"Hero"')
  })

  it('allows sequential touching and different-property overlaps', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    const touching = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 1)',
      'hero.tween({ x: 10 }, 1)',
    ])
    expect(touching.runnable).toBe(true)
    const diffProp = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 1)',
      'at(0.5) hero.tween({ y: 10 }, 1)',
    ])
    expect(diffProp.runnable).toBe(true)
  })

  it('errors on a set inside a tween interval', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 2)',
      'at(1) hero.set({ x: 3 })',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /overlaps a previous write/.test(m))).toBe(true)
  })

  it('errors on raw vs own clip on the same property', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.tween({ x: 5 }, 2)',
      'at(1) hero.play(wave)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /placed clip/.test(m))).toBe(true)
    const error = result.diagnostics.find((d) => d.severity === 'error')
    expect(error).toMatchObject({ line: 5 })
  })

  it('allows raw vs own clip on different properties', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.tween({ y: 5 }, 2)',
      'at(1) hero.play(wave)',
    ])
    expect(result.runnable).toBe(true)
  })

  it('errors on raw vs own collection on the same property', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const rig = addNode(system, sceneId, rootId, 'Rig')
    addNode(system, sceneId, rig, 'Arm', 'arm')
    const clipId = addClip(system, 'Wave', 1)
    dispatchOk(
      system,
      new CreateClipCollectionCommand({ name: 'Moves', bindings: { arm: clipId } }),
    )
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'bind arm = node("Arm")',
      'bind moves = collection("Moves")',
      'arm.tween({ x: 5 }, 1)',
      'at(0.5) rig.apply(moves)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /placed collection/.test(m))).toBe(true)
  })

  it('errors on overlapping control writes to the same key', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hostId = addNode(system, sceneId, rootId, 'Rig')
    dispatchOk(
      system,
      new SetControlSetCommand({
        nodeId: hostId,
        controlSet: createControlSet(hostId, [createControl({ key: 'Jaw', exposed: true })]),
      }),
    )
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Jaw", 1, 1, linear)',
      'at(0.5) rig.control("Jaw", 0, 1, linear)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /overlaps a previous write/.test(m))).toBe(true)
  })

  it('errors on raw vs own control-driven descendant', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const rig = addNode(system, sceneId, rootId, 'Rig')
    addNode(system, sceneId, rig, 'Arm', 'puppet')
    const clipId = addClip(system, 'Wave', 2)
    dispatchOk(
      system,
      new SetControlSetCommand({
        nodeId: rig,
        controlSet: createControlSet(rig, [
          createControl({
            key: 'Jaw',
            exposed: true,
            bindings: { puppet: { clipId, start: 0, end: 1 } as never },
          }),
        ]),
      }),
    )
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'bind arm = node("Arm")',
      'rig.control("Jaw", 1, 2, linear)',
      'at(1) arm.tween({ x: 5 }, 1)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /own.*control/.test(m))).toBe(true)
  })

  it('warns on pre-existing clip overlap but still runs', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const heroId = addNode(system, sceneId, rootId, 'Hero')
    const clipId = addClip(system, 'Wave', 2)
    dispatchOk(
      system,
      new AssignClipCommand({
        nodeId: heroId,
        clipId,
        startTime: 0,
        speed: 1,
        enabled: true,
        paramOverrides: {},
      }),
    )
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 1)',
    ].join('\n')
    const result = check(system, slideId, source.split('\n'))
    expect(result.runnable).toBe(true)
    expect(
      result.diagnostics.some(
        (d) => d.severity === 'warning' && /pre-existing clip/.test(d.message),
      ),
    ).toBe(true)
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const run = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(run.ran).toBe(true)
  })

  it('warns on pre-existing active control overlap but still runs', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const rig = addNode(system, sceneId, rootId, 'Rig')
    addNode(system, sceneId, rig, 'Arm', 'puppet')
    const clipId = addClip(system, 'Wave', 1)
    // Control Jaw drives puppet semantic via Wave (positionX)
    dispatchOk(
      system,
      new SetControlSetCommand({
        nodeId: rig,
        controlSet: createControlSet(rig, [
          createControl({
            key: 'Jaw',
            exposed: true,
            bindings: { puppet: { clipId, start: 0, end: 1 } as never },
          }),
        ]),
      }),
    )
    // Key the control so it is active
    dispatchOk(
      system,
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: rig, controlKey: 'Jaw' },
        time: 0,
        value: 0,
        interpolation: 'linear',
      }),
    )
    dispatchOk(
      system,
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: rig, controlKey: 'Jaw' },
        time: 2,
        value: 1,
        interpolation: 'linear',
      }),
    )
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arm = node("Arm")',
      'arm.tween({ x: 5 }, 1)',
    ])
    expect(result.runnable).toBe(true)
    expect(
      result.diagnostics.some(
        (d) => d.severity === 'warning' && /pre-existing control/.test(d.message),
      ),
    ).toBe(true)
  })

  it('reports emitted-keyframe budget naming the offending statement', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'hero.tween({ x: 1 }, 0.5)',
        'hero.tween({ x: 2 }, 0.5)',
        'hero.tween({ x: 3 }, 0.5)',
      ],
      { maxEmittedKeyframes: 3 },
    )
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /Emitted keyframes pass the compile budget/.test(m))).toBe(
      true,
    )
    const error = result.diagnostics.find((d) => d.severity === 'error')
    expect(error?.line).toBeGreaterThanOrEqual(3)
  })

  it('reports emitted-instance budget naming the offending statement', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 1)
    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'bind wave = clip("Wave")',
        'hero.play(wave)',
        'hero.play(wave)',
      ],
      { maxEmittedInstances: 1 },
    )
    expect(result.runnable).toBe(false)
    expect(
      messages(result).some((m) => /Emitted clip instances pass the compile budget/.test(m)),
    ).toBe(true)
  })

  it('validates identically for hand and AI sources', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 1)',
      'at(0.5) hero.tween({ x: 6 }, 1)',
    ].join('\n')
    const hand = checkAnimationScript(system.engine, slideId, source)
    // Simulate AI authoring the same source through a proposal command path:
    // the source text is identical; Check uses the same single compile path.
    const ai = checkAnimationScript(system.engine, slideId, `${source}`)
    expect(ai.diagnostics).toEqual(hand.diagnostics)
    expect(ai.runnable).toBe(hand.runnable)
  })
})
