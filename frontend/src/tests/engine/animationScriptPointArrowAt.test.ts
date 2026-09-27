import { describe, expect, it } from 'vitest'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'

type System = ReturnType<typeof createCommandSystem>

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { system, slideId: slide.id }
}

function dispatchOk<T>(system: System, command: Command<T>): T {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse as T
}

function addNode(
  system: System,
  slideId: string,
  name: string,
  options: {
    transform?: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
    parentId?: string
  } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: options.parentId ?? slide.scene.root.id,
      name,
      ...(options.transform !== undefined && { transform: options.transform }),
    }),
  ).nodeId
}

function keyframe(
  system: System,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity',
  time: number,
  value: number,
): void {
  dispatchOk(
    system,
    new AddKeyframeCommand({
      target: { kind: 'node', nodeId, property },
      time,
      value,
      interpolation: 'linear',
    }),
  )
}

function check(system: System, slideId: string, lines: readonly string[]) {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function apply(system: System, result: AnimationScriptCompileResult) {
  dispatchOk(system, new TransactionCommand([...result.commands]))
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((d) => d.severity === 'error')
}

function messages(result: AnimationScriptCompileResult): string[] {
  return result.diagnostics.map((d) => d.message)
}

describe('Animation Script pointArrowAt — at: variant', () => {
  it('snaps the arrow to face the target and sets the cursor to max(cursor, t)', () => {
    const { system, slideId } = setup()
    const arrowId = addNode(system, slideId, 'Arrow', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 3, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, at: 2.0)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.runnable).toBe(true)
    // cursor becomes max(0, 2.0)
    expect(result.summary.to).toBe(2.0)
    apply(system, result)

    const expected = Math.atan2(4, 3)
    const state = system.engine.evaluateNode(arrowId, 2.0)
    expect(state.transform.rotation).toBeCloseTo(expected, 6)
  })

  it('never rewinds the cursor when at: is behind it', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Arrow')
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'wait(1)',
      'pointArrowAt(arrow, butterfly, at: 0.5)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBe(1)
  })

  it('converts world pointing through a rotated parent chain', () => {
    const { system, slideId } = setup()
    const rigId = addNode(system, slideId, 'Rig', {
      transform: { x: 10, y: 0, rotation: 0.5, scaleX: 1, scaleY: 1 },
    })
    const arrowId = addNode(system, slideId, 'Arrow', {
      parentId: rigId,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    // Target due east of the arrow pivot in world space.
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 11, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, at: 1.0)',
    ])

    expect(errors(result)).toEqual([])
    apply(system, result)
    // Desired world rotation is atan2(0,1)=0; local = 0 - 0.5 = -0.5.
    const state = system.engine.evaluateNode(arrowId, 1.0)
    expect(state.transform.rotation).toBeCloseTo(-0.5, 6)
  })

  it('converts through a multi-level parent chain', () => {
    const { system, slideId } = setup()
    const grandparentId = addNode(system, slideId, 'Grandparent', {
      transform: { x: 0, y: 0, rotation: 0.3, scaleX: 1, scaleY: 1 },
    })
    const parentId = addNode(system, slideId, 'Parent', {
      parentId: grandparentId,
      transform: { x: 0, y: 0, rotation: 0.2, scaleX: 1, scaleY: 1 },
    })
    const arrowId = addNode(system, slideId, 'Arrow', {
      parentId,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    void parentId
    // Target due east of the shared origin in world space.
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 7, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, at: 1.0)',
    ])

    expect(errors(result)).toEqual([])
    apply(system, result)
    // Desired world rotation is 0; parent chain sums to 0.5, so local = -0.5.
    const state = system.engine.evaluateNode(arrowId, 1.0)
    expect(state.transform.rotation).toBeCloseTo(-0.5, 6)
  })
})

describe('Animation Script pointArrowAt — over: variant', () => {
  it('bakes rotation keyframes the evaluator reproduces and advances the cursor by d', () => {
    const { system, slideId } = setup()
    const arrowId = addNode(system, slideId, 'Arrow', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const targetId = addNode(system, slideId, 'Butterfly', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    // Target drifts east: x 0 -> 8 over 2s, holding y = 2.
    keyframe(system, targetId, 'positionX', 0, 0)
    keyframe(system, targetId, 'positionX', 2, 8)
    keyframe(system, targetId, 'positionY', 0, 2)
    keyframe(system, targetId, 'positionY', 2, 2)

    const result = check(system, slideId, [
      'script "Demo" from 0.5',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, over: 1.2s, every: 0.05s)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBeCloseTo(1.7, 6)
    apply(system, result)
    const emitted = system.engine.getKeyframes(arrowId, 'rotation')
    // 1.2 / 0.05 = 24 intervals -> 25 samples; from coincides with the first.
    expect(emitted.length).toBe(25)

    // Evaluator reproduces every baked sample frame for frame.
    for (const key of emitted) {
      const targetState = system.engine.evaluateNode(targetId, key.time)
      const arrowState = system.engine.evaluateNode(arrowId, key.time)
      const dx = targetState.transform.x - 0
      const dy = targetState.transform.y - 0
      expect(arrowState.transform.rotation).toBeCloseTo(Math.atan2(dy, dx), 5)
    }
  })

  it('defaults to 30 Hz with an exact end sample', () => {
    const { system, slideId } = setup()
    const arrowId = addNode(system, slideId, 'Arrow')
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, over: 0.1s)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBeCloseTo(0.1, 6)
    apply(system, result)
    // 0.1s at 30 Hz -> samples at 0, 1/30, 2/30, 0.1 (exact end) = 4 samples.
    const keys = system.engine.getKeyframes(arrowId, 'rotation')
    expect(keys.length).toBe(4)
    expect(keys.map((k) => k.time)).toEqual([
      0,
      expect.closeTo(1 / 30, 6),
      expect.closeTo(2 / 30, 6),
      expect.closeTo(0.1, 6),
    ])
  })

  it('includes an exact end sample when every does not divide over', () => {
    const { system, slideId } = setup()
    const arrowId = addNode(system, slideId, 'Arrow')
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, over: 1.0s, every: 0.3s)',
    ])

    expect(errors(result)).toEqual([])
    apply(system, result)
    const keys = system.engine.getKeyframes(arrowId, 'rotation').map((k) => k.time)
    // Samples at 0, 0.3, 0.6, 0.9 plus exact end 1.0 (plus boundary pin at from=0 coinciding).
    expect(keys).toContain(1.0)
    expect(keys).toContain(0.9)
  })
})

describe('Animation Script pointArrowAt — budgets and collisions', () => {
  it('turns a pathological over-budget call into a diagnostic instead of hanging', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Arrow')
    addNode(system, slideId, 'Butterfly')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'pointArrowAt(arrow, butterfly, over: 100s, every: 0.001s)',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /budget/i.test(m))).toBe(true)
  })

  it('rejects a user definition colliding with pointArrowAt', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'function pointArrowAt(target: node) {',
      '  target.set({ x: 1 })',
      '}',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /reserved/.test(m))).toBe(true)
  })
})

describe('Animation Script pointArrowAt — composition', () => {
  it('composes with parallel like any timed statement', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Arrow')
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.4s, ease: easeInOut }',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'parallel {',
      '  pointArrowAt(arrow, butterfly, over: 1.2s, every: 0.1s)',
      '  arrow.tween({ x: 5 }, 0.4s)',
      '}',
    ])

    expect(errors(result)).toEqual([])
    // Extent is the latest child end: max(1.2, 0.4) = 1.2.
    expect(result.summary.to).toBeCloseTo(1.2, 6)
  })

  it('inlines inside a local function with node parameters', () => {
    const { system, slideId } = setup()
    const arrowId = addNode(system, slideId, 'Arrow')
    addNode(system, slideId, 'Butterfly', {
      transform: { x: 0, y: 5, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind arrow = node("Arrow")',
      'bind butterfly = node("Butterfly")',
      'function track(arrow: node, target: node) {',
      '  pointArrowAt(arrow, target, at: 1.0)',
      '}',
      'track(arrow, butterfly)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBe(1.0)
    apply(system, result)
    // Arrow at origin facing (0,5): atan2(5,0) = pi/2.
    const state = system.engine.evaluateNode(arrowId, 1.0)
    expect(state.transform.rotation).toBeCloseTo(Math.PI / 2, 6)
  })
})
