import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
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

function dispatchOk(system: System, command: Parameters<System['dispatcher']['dispatch']>[0]) {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse
}

function addNode(
  system: System,
  slideId: string,
  name: string,
  options: { semanticName?: string } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  const result = system.dispatcher.dispatch(
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      name,
      ...(options.semanticName !== undefined && { semanticName: options.semanticName }),
    }),
  )
  if (!result.ok) throw new Error(`create node failed: ${result.error.message}`)
  return (result.inverse as { nodeId: string }).nodeId
}

function check(system: System, slideId: string, lines: readonly string[]) {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function apply(system: System, result: AnimationScriptCompileResult) {
  dispatchOk(system, new TransactionCommand([...result.commands]))
}

function messages(result: AnimationScriptCompileResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.message)
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

function warnings(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
}

function times(system: System, nodeId: string, property: 'positionX' | 'positionY') {
  return system.engine.getKeyframes(nodeId, property).map((keyframe) => keyframe.time)
}

describe('Animation Script loops — repeat', () => {
  it('unrolls to plain keyframes and advances by the unrolled sum', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(2) {',
      '  hero.tween({ x: 1 }, 0.4)',
      '  wait(0.1)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.4, 0.5, 0.9])
  })

  it('accepts a compile-time count expression', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let n = 1 + 1',
      'repeat(n) {',
      '  hero.tween({ x: 1 }, 0.4)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.8)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.4, 0.8])
  })

  it('warns on repeat(0) without blocking', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 }, 0.4)',
      'repeat(0) {',
      '  hero.tween({ x: 2 }, 0.4)',
      '}',
    ])

    expect(result.runnable).toBe(true)
    expect(warnings(result).some((d) => /repeat\(0\)/.test(d.message))).toBe(true)
    expect(errors(result)).toHaveLength(0)
    expect(result.summary.to).toBe(0.4)
  })

  it('errors on negative, fractional and non-numeric counts', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const negative = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(-1) { hero.set({ x: 1 }) }',
    ])
    const fractional = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(2.5) { hero.set({ x: 1 }) }',
    ])
    const listed = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat([1, 2]) { hero.set({ x: 1 }) }',
    ])

    expect(negative.runnable).toBe(false)
    expect(messages(negative).some((m) => /whole number/.test(m))).toBe(true)
    expect(fractional.runnable).toBe(false)
    expect(messages(fractional).some((m) => /whole number/.test(m))).toBe(true)
    expect(listed.runnable).toBe(false)
    expect(messages(listed).some((m) => /repeat count/.test(m))).toBe(true)
  })

  it('scopes lets per iteration without leaking', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(2) {',
      '  let d = 0.4',
      '  hero.tween({ x: 1 }, d)',
      '}',
      'hero.tween({ y: 1 }, 0.4)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1.2)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.4, 0.8])
  })

  it('errors markers inside repeat bodies', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(2) {',
      '  mark("beat")',
      '  hero.set({ x: 1 })',
      '}',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /Marker "beat" cannot be declared inside/.test(m))).toBe(
      true,
    )
  })

  it('errors markers even when repeat(0) never runs', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(0) {',
      '  mark("beat")',
      '}',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /cannot be declared inside/.test(m))).toBe(true)
  })
})

describe('Animation Script loops — for', () => {
  it('iterates binding aliases, rebinding the variable per element', () => {
    const { system, slideId } = setup()
    const e0 = addNode(system, slideId, 'Ending o')
    const e1 = addNode(system, slideId, 'Ending as')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind e0 = node("Ending o")',
      'bind e1 = node("Ending as")',
      'for e in [e0, e1] {',
      '  e.tween({ x: 0 }, 0.4)',
      '  wait(0.8)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(2.4)
    apply(system, result)

    expect(times(system, e0, 'positionX')).toEqual([0, 0.4])
    expect(times(system, e1, 'positionY')).toEqual([])
    expect(system.engine.getKeyframes(e1, 'positionX').map((k) => k.time)).toEqual([0, 1.2, 1.6])
  })

  it('iterates numeric lists and range() into values', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for x in [1, 2, 3] {',
      '  hero.tween({ x: x }, 0.2)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.6)
    apply(system, result)

    const frames = system.engine.getKeyframes(heroId, 'positionX')
    expect(frames.map((k) => k.time)).toEqual([0, 0.2, 0.4, 0.6])
    expect(frames.map((k) => k.value)).toEqual([0, 1, 2, 3])
  })

  it('iterates a let-held list and a range call', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const held = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let ds = [0.4, 0.2]',
      'for d in ds {',
      '  hero.tween({ x: 1 }, d)',
      '}',
    ])
    const ranged = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for i in range(0, 2, 1) {',
      '  hero.tween({ x: i }, 0.2)',
      '}',
    ])

    expect(held.diagnostics).toEqual([])
    expect(held.summary.to).toBe(0.6)
    expect(ranged.diagnostics).toEqual([])
    expect(ranged.summary.to).toBe(0.4)
  })

  it('advances zero on an empty list', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for x in [] {',
      '  hero.tween({ x: 1 }, 0.4)',
      '}',
      'hero.tween({ y: 1 }, 0.4)',
    ])

    expect(result.runnable).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.4)
  })

  it('errors markers inside for bodies and a binding as the iterable', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const marked = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for x in [1, 2] {',
      '  mark("beat")',
      '}',
    ])
    const grouped = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for e in hero {',
      '  e.set({ x: 1 })',
      '}',
    ])

    expect(marked.runnable).toBe(false)
    expect(messages(marked).some((m) => /cannot be declared inside/.test(m))).toBe(true)
    expect(grouped.runnable).toBe(false)
    expect(messages(grouped).some((m) => /needs a list/.test(m))).toBe(true)
  })

  it('rejects a loop variable colliding with a binding or built-in', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const bound = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for hero in [1, 2] { hero.set({ x: 1 }) }',
    ])
    const builtin = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'for sin in [1, 2] { hero.set({ x: sin }) }',
    ])

    expect(bound.runnable).toBe(false)
    expect(messages(bound).some((m) => /already used by a binding/.test(m))).toBe(true)
    expect(builtin.runnable).toBe(false)
    expect(messages(builtin).some((m) => /reserved/.test(m))).toBe(true)
  })
})

describe('Animation Script loops — stagger', () => {
  it('staggers a group broadcast by (n-1)*step + body extent in scene order', () => {
    const { system, slideId } = setup()
    const c1 = addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    const c2 = addNode(system, slideId, 'Card 2', { semanticName: 'card' })
    const c3 = addNode(system, slideId, 'Card 3', { semanticName: 'card' })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.4 }',
      'bind cards = group("card")',
      'stagger(0.2s, cards) {',
      '  cards.fadeIn()',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    // (3-1)*0.2 + 0.4 = 0.8
    expect(result.summary.to).toBe(0.8)
    apply(system, result)

    expect(system.engine.getKeyframes(c1, 'opacity').map((k) => k.time)).toEqual([0, 0.4])
    expect(system.engine.getKeyframes(c2, 'opacity').map((k) => k.time)).toEqual([0, 0.2, 0.6])
    expect(system.engine.getKeyframes(c3, 'opacity').map((k) => k.time)).toEqual([0, 0.4, 0.8])
  })

  it('staggers an explicit node list in listed order', () => {
    const { system, slideId } = setup()
    const c1 = addNode(system, slideId, 'Card 1')
    const c2 = addNode(system, slideId, 'Card 2')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'bind c1 = node("Card 1")',
      'bind c2 = node("Card 2")',
      'stagger(0.5, [c2, c1]) {',
      '  c2.fadeIn(0.4)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    // member 0 (c2) at 1, member 1 (c1) at 1.5; body 0.4 → latest 1.9
    expect(result.summary.to).toBe(1.9)
    apply(system, result)

    expect(system.engine.getKeyframes(c2, 'opacity').map((k) => k.time)).toEqual([1, 1.4])
    expect(system.engine.getKeyframes(c1, 'opacity').map((k) => k.time)).toEqual([1, 1.5, 1.9])
  })

  it('errors empty targets and markers inside the body', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const empty = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'stagger(0.2, []) { hero.set({ x: 1 }) }',
    ])
    const marked = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'stagger(0.2, [hero]) { mark("beat") }',
    ])

    expect(empty.runnable).toBe(false)
    expect(messages(empty).some((m) => /at least one target/.test(m))).toBe(true)
    expect(marked.runnable).toBe(false)
    expect(messages(marked).some((m) => /cannot be declared inside/.test(m))).toBe(true)
  })

  it('rejects group index addressing', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Card 1', { semanticName: 'card' })

    const indexed = check(system, slideId, [
      'script "Demo" from 0',
      'bind cards = group("card")',
      'cards[0].tween({ x: 1 }, 0.4)',
    ])

    expect(indexed.runnable).toBe(false)
    expect(messages(indexed).some((m) => /Index addressing/.test(m))).toBe(true)
  })
})

describe('Animation Script loops — composition', () => {
  it('behaves like any statement group inside parallel and at', () => {
    const { system, slideId } = setup()
    const aId = addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')

    const parallel = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  repeat(2) { a.tween({ x: 1 }, 0.5) }',
      '  b.tween({ y: 1 }, 0.4)',
      '}',
    ])
    const placed = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'a.tween({ x: 1 }, 0.5)',
      'at(2) repeat(2) { b.tween({ y: 1 }, 0.5) }',
    ])

    expect(parallel.diagnostics).toEqual([])
    expect(parallel.summary.to).toBe(1)
    expect(placed.diagnostics).toEqual([])
    expect(placed.summary.to).toBe(3)
    apply(system, parallel)
    expect(times(system, aId, 'positionX')).toEqual([0, 0.5, 1])
    expect(times(system, bId, 'positionY')).toEqual([0, 0.4])
  })

  it('nests loops and reports the unrolled budget instead of hanging', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const nested = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(2) {',
      '  for x in [1, 2] { hero.set({ x: x }) }',
      '}',
    ])
    const huge = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'repeat(20000) { hero.set({ x: 1 }) }',
    ])

    expect(nested.diagnostics).toEqual([])
    expect(nested.summary.to).toBe(0)
    expect(huge.runnable).toBe(false)
    expect(messages(huge).some((m) => /budget/.test(m))).toBe(true)
  })
})
