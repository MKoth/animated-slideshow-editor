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

function addNode(system: System, slideId: string, name: string): string {
  const slide = system.engine.getSlide(slideId)
  const result = system.dispatcher.dispatch(
    new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name }),
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

function xKeyframes(system: System, nodeId: string) {
  return system.engine.getKeyframes(nodeId, 'positionX').map((keyframe) => ({
    time: keyframe.time,
    value: keyframe.value,
  }))
}

describe('Animation Script expressions — let', () => {
  it('advances the cursor zero, emits nothing, and feeds later statements', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'let d = 0.4',
      'let target = 1 + 2',
      'hero.tween({ x: target }, d)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.from).toBe(0.5)
    expect(result.summary.to).toBe(0.9)
    expect(result.summary.tracks.map((track) => track.property)).toEqual(['x'])
    apply(system, result)

    expect(xKeyframes(system, heroId)).toEqual([
      { time: 0.5, value: 0 },
      { time: 0.9, value: 3 },
    ])
  })

  it('emits nothing for a source that is only lets', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'let home = 2',
      'let target = home * 3',
    ])

    expect(result.runnable).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.commands).toHaveLength(0)
    expect(result.summary.tracks).toEqual([])
    expect(result.summary.keyframeCount).toBe(0)
  })

  it('is immutable: reassignment and redeclaration are errors', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const reassigned = check(system, slideId, ['script "Demo" from 0', 'let d = 0.4', 'd = 0.5'])
    const redeclared = check(system, slideId, ['script "Demo" from 0', 'let d = 1', 'let d = 2'])

    expect(reassigned.runnable).toBe(false)
    expect(messages(reassigned).some((message) => /immutable/i.test(message))).toBe(true)
    expect(redeclared.runnable).toBe(false)
    expect(messages(redeclared).some((message) => /already declared/.test(message))).toBe(true)
  })

  it('is block-scoped to a parallel body', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'A')
    addNode(system, slideId, 'B')

    const inside = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  let d = 0.4',
      '  a.tween({ x: 1 }, d)',
      '}',
      'b.tween({ y: 1 }, 0.4)',
    ])
    const outside = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  let d = 0.4',
      '  a.tween({ x: 1 }, d)',
      '}',
      'b.tween({ y: 1 }, d)',
    ])

    expect(inside.diagnostics).toEqual([])
    expect(inside.summary.to).toBe(0.8)
    expect(outside.runnable).toBe(false)
    const error = errors(outside)[0]
    expect(error.message).toMatch(/Unknown name "d"/)
    expect(error.line).toBe(8)
  })

  it('shadows an outer let inside a nested block without leaking back out', () => {
    const { system, slideId } = setup()
    const aId = addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'let d = 1',
      'parallel {',
      '  let d = 0.4',
      '  a.tween({ x: 1 }, d)',
      '}',
      'b.tween({ y: 1 }, d)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1.4)
    apply(system, result)

    expect(system.engine.getKeyframes(aId, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      0, 0.4,
    ])
    expect(system.engine.getKeyframes(bId, 'positionY').map((keyframe) => keyframe.time)).toEqual([
      0, 0.4, 1.4,
    ])
  })

  it('cannot collide with a binding alias', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let hero = 1',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /already used by a binding/.test(message))).toBe(true)
  })

  it('cannot be redeclared as a binding after a let', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'let d = 1',
      'bind d = node("Hero")',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /already used by a variable/.test(message))).toBe(
      true,
    )
  })

  it('cannot be placed by at', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'at(1) let d = 1',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /cannot place/.test(message))).toBe(true)
  })
})

describe('Animation Script expressions — arithmetic', () => {
  it('evaluates precedence, parentheses, unary minus and modulo into property values', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: 1 + 2 * 3, y: -(2 + 3), rotation: 7 % 4, scaleX: (5 - -2) * 2 })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(heroId, 0)
    expect(state.transform.x).toBe(7)
    expect(state.transform.y).toBe(-5)
    expect(state.transform.rotation).toBe(3)
    expect(state.transform.scaleX).toBe(14)
  })

  it('evaluates arithmetic into durations and rounds emitted times to 1e-6', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(0.1 + 0.2)',
      'hero.tween({ x: 1 }, (0.1 + 0.1) * 2)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.7)
    apply(system, result)

    // The boundary pin at from holds the authored pose until the tween starts.
    expect(xKeyframes(system, heroId)).toEqual([
      { time: 0, value: 0 },
      { time: 0.3, value: 0 },
      { time: 0.7, value: 1 },
    ])
  })

  it('evaluates a default duration written as an expression', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.25 * 2 }',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 })',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.5)
    apply(system, result)

    expect(xKeyframes(system, heroId).map((keyframe) => keyframe.time)).toEqual([0, 0.5])
  })

  it('feeds arithmetic and built-ins into at() placements', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let base = 0.25',
      'at(base + max(0.5, 0.25)) hero.set({ x: 1 })',
      'hero.tween({ x: 2 }, 0.25)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1)
    apply(system, result)

    expect(xKeyframes(system, heroId)).toEqual([
      { time: 0, value: 0 },
      { time: 0.75, value: 1 },
      { time: 1, value: 2 },
    ])
  })

  it('reports a failed let once, not again at every use', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let d = 1 / 0',
      'hero.tween({ x: 1 }, d)',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)).toHaveLength(1)
    expect(errors(result)[0].message).toMatch(/Division by zero/)
  })

  it('accepts arithmetic in the header from', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0.25 * 2',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 }, 0.4)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.from).toBe(0.5)
    expect(result.summary.to).toBe(0.9)
  })

  it('still reports a negative from against the slide duration', () => {
    const { system, slideId } = setup()

    const result = check(system, slideId, ['script "Demo" from -1'])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /slide duration/.test(message))).toBe(true)
  })

  it('divides into fractions', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: 3 / 2 })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)
    expect(system.engine.evaluateNode(heroId, 0).transform.x).toBe(1.5)
  })

  it('errors division by zero with a source location', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'let bad = 1 / 0',
      'let worse = 1 % 0',
    ])

    expect(result.runnable).toBe(false)
    const found = errors(result)
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({ line: 2, column: 13 })
    expect(found[0].message).toMatch(/Division by zero/)
    expect(found[1].message).toMatch(/Division by zero/)
  })

  it('errors a non-finite arithmetic result with a source location', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'let big = 999999999999999999999999999999999999999999999999999999',
      'let square = big * big',
      'let fourth = square * square',
      'let overflow = fourth * fourth',
    ])

    expect(result.runnable).toBe(false)
    const found = errors(result)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ line: 5 })
    expect(found[0].message).toMatch(/finite/)
  })

  it('errors a non-finite literal with a source location', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      `hero.set({ x: ${'9'.repeat(400)} })`,
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0]).toMatchObject({ line: 3 })
    expect(errors(result)[0].message).toMatch(/finite/)
  })
})

describe('Animation Script expressions — math built-ins', () => {
  const CASES: readonly (readonly [string, number])[] = [
    ['abs(-4)', 4],
    ['min(3, 2)', 2],
    ['max(3, 2)', 3],
    ['clamp(5, 0, 1)', 1],
    ['clamp(-5, 0, 1)', 0],
    ['lerp(0, 10, 0.25)', 2.5],
    ['atan2(0, 1)', 0],
    ['sin(0)', 0],
    ['cos(0)', 1],
    ['deg(3.141592653589793)', 180],
    ['rad(180)', Math.PI],
    ['abs(min(-2, -5))', 5],
    ['abs(-4) + clamp(10, 0, 6)', 10],
  ]

  it('evaluates every built-in into a property value', () => {
    for (const [expression, expected] of CASES) {
      const { system, slideId } = setup()
      const heroId = addNode(system, slideId, 'Hero')

      const result = check(system, slideId, [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        `hero.set({ x: ${expression} })`,
      ])

      expect(result.diagnostics, expression).toEqual([])
      apply(system, result)
      expect(system.engine.evaluateNode(heroId, 0).transform.x, expression).toBeCloseTo(expected)
    }
  })

  it('feeds built-ins into durations', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(max(0.5, 0.25) + 0.1)',
      'hero.tween({ x: 1 }, clamp(0.5, 0, 0.25))',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.85)
  })

  it('errors a wrong argument count naming the built-in', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: abs(1, 2) })',
      'hero.set({ x: clamp(1, 0) })',
    ])

    expect(result.runnable).toBe(false)
    const found = errors(result)
    expect(found.some((error) => /abs takes 1 argument, got 2/.test(error.message))).toBe(true)
    expect(found.some((error) => /clamp takes 3 arguments, got 2/.test(error.message))).toBe(true)
  })

  it('suggests an ease name when a misspelled ease lands in a duration slot', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 }, easeInOutt)',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toContain('"easeInOut"')
  })

  it('errors an unknown function with a near-miss suggestion', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: sqr(4) })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/Unknown function "sqr"/)
    expect(errors(result)[0].message).toContain('"sin"')
  })
})

describe('Animation Script expressions — lists and range', () => {
  it('produces compile-time lists for later statements without emitting anything', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'let d = 0.4',
      'let xs = [1, 2, d]',
      'let ys = range(0, 1, 0.25)',
    ])

    expect(result.runnable).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.commands).toHaveLength(0)
    expect(result.summary.keyframeCount).toBe(0)
  })

  it('excludes the range end and reports the produced length when misused', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(range(0, 1, 0.25))',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/Expected a duration.*found a list of 4 values/)
  })

  it('rejects a list in arithmetic with a clear diagnostic', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, ['script "Demo" from 0', 'let bad = [1, 2] + 1'])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/list/)
  })

  it('rejects a zero or negative range step', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const zero = check(system, slideId, ['script "Demo" from 0', 'let xs = range(0, 1, 0)'])
    const negative = check(system, slideId, ['script "Demo" from 0', 'let xs = range(0, 1, -0.5)'])

    expect(zero.runnable).toBe(false)
    expect(messages(zero).some((message) => /step/.test(message))).toBe(true)
    expect(negative.runnable).toBe(false)
    expect(messages(negative).some((message) => /positive/.test(message))).toBe(true)
  })

  it('rejects a range past the compile budget instead of building it', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'let xs = range(0, 1000000, 0.5)',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /budget/.test(message))).toBe(true)
  })

  it('rejects a non-number range argument', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, ['script "Demo" from 0', 'let xs = range(0, "one", 1)'])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /string/.test(message))).toBe(true)
  })
})

describe('Animation Script expressions — forbidden constructs', () => {
  it('rejects comparisons with a clear diagnostic', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'let a = 1 < 2',
      'let b = 1 == 1',
    ])

    expect(result.runnable).toBe(false)
    const found = errors(result)
    expect(found).toHaveLength(2)
    expect(found.every((error) => /Comparisons are not part/.test(error.message))).toBe(true)
  })

  it('rejects conditionals with a clear diagnostic', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'if (1) { hero.set({ x: 1 }) }',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/Conditionals are not part/)
  })

  it('rejects string operations with a clear diagnostic', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const concatenated = check(system, slideId, [
      'script "Demo" from 0',
      'let greeting = "a" + "b"',
    ])
    const asDuration = check(system, slideId, [
      'script "Demo" from 0',
      'let greeting = "a"',
      'wait(greeting)',
    ])

    expect(concatenated.runnable).toBe(false)
    expect(messages(concatenated).some((message) => /String operations/.test(message))).toBe(true)
    expect(asDuration.runnable).toBe(false)
    expect(messages(asDuration).some((message) => /found a string/.test(message))).toBe(true)
  })

  it('rejects logical operators with a clear diagnostic', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, ['script "Demo" from 0', 'let a = 1 && 2'])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/Logical operators are not part/)
  })

  it('rejects wall clock and randomness as unknown functions', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: random() })',
      'wait(now())',
    ])

    expect(result.runnable).toBe(false)
    const found = messages(result)
    expect(found.some((message) => /Unknown function "random"/.test(message))).toBe(true)
    expect(found.some((message) => /Unknown function "now"/.test(message))).toBe(true)
  })

  it('requires define-before-use for a let', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 }, later)',
      'let later = 0.4',
    ])

    expect(result.runnable).toBe(false)
    const error = errors(result).find((diagnostic) =>
      /Unknown name "later"/.test(diagnostic.message),
    )
    expect(error).toBeDefined()
    expect(error?.line).toBe(3)
  })
})
