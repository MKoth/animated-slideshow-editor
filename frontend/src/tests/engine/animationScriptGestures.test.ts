import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSemanticNameCommand,
  SetSlideAnimationScriptCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'
import { runAnimationScript } from '../../engine/animationScriptRun'

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

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

function addNode(system: System, slideId: string, name: string): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      name,
    }),
  ).nodeId
}

function check(
  system: System,
  slideId: string,
  lines: readonly string[],
): AnimationScriptCompileResult {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function apply(system: System, result: AnimationScriptCompileResult): void {
  dispatchOk(system, new TransactionCommand([...result.commands]))
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

function errorMessages(result: AnimationScriptCompileResult): string {
  return errors(result)
    .map((diagnostic) => diagnostic.message)
    .join('\n')
}

function strip(keyframes: readonly { time: number; value: unknown; interpolation: string }[]) {
  return keyframes.map((keyframe) => ({
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
  }))
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

describe('Animation Script sugar gestures — move', () => {
  it('emits the same timeline data as the equivalent raw tween', () => {
    const first = setup()
    const second = setup()
    const firstHero = addNode(first.system, first.slideId, 'Hero')
    const secondHero = addNode(second.system, second.slideId, 'Hero')

    const moveResult = check(first.system, first.slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.move({ x: 4, y: 2, rotation: 0.5 }, 0.4, linear)',
    ])
    const tweenResult = check(second.system, second.slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 4, y: 2, rotation: 0.5 }, 0.4, linear)',
    ])

    expect(errors(moveResult)).toEqual([])
    expect(errors(tweenResult)).toEqual([])
    expect(moveResult.summary.to).toBe(tweenResult.summary.to)
    apply(first.system, moveResult)
    apply(second.system, tweenResult)

    for (const property of ['positionX', 'positionY', 'rotation'] as const) {
      expect(strip(first.system.engine.getKeyframes(firstHero, property))).toEqual(
        strip(second.system.engine.getKeyframes(secondHero, property)),
      )
    }
  })

  it('resolves duration and ease from the header defaults', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'defaults { duration: 0.4s, ease: linear }',
      'bind hero = node("Hero")',
      'hero.move({ x: 4 })',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBe(1.4)
    apply(system, result)

    expect(system.engine.getKeyframes(heroId, 'positionX').map((kf) => kf.time)).toEqual([1, 1.4])
  })

  it('rejects keys outside x, y and rotation', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.move({ opacity: 1 }, 0.4)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/move only supports x, y and rotation/)
    expect(errorMessages(result)).toContain('"opacity"')
  })

  it('needs at least one property and a duration', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const empty = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.move({ }, 0.4)',
    ])
    // Empty maps fail at parse time; either way the run is blocked.
    expect(empty.runnable).toBe(false)

    const noDuration = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.move({ x: 1 })',
    ])
    expect(noDuration.runnable).toBe(false)
    expect(errorMessages(noDuration)).toMatch(/move needs a duration/)
  })
})

describe('Animation Script sugar gestures — fadeIn and fadeOut', () => {
  it('animates opacity to 1 and 0 like the equivalent raw tweens', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const other = setup()
    const otherHero = addNode(other.system, other.slideId, 'Hero')

    const fade = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.fadeOut(0.4, linear)',
    ])
    const raw = check(other.system, other.slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ opacity: 0 }, 0.4, linear)',
    ])

    expect(errors(fade)).toEqual([])
    apply(system, fade)
    apply(other.system, raw)

    expect(strip(system.engine.getKeyframes(heroId, 'opacity'))).toEqual(
      strip(other.system.engine.getKeyframes(otherHero, 'opacity')),
    )
    expect(system.engine.getKeyframes(heroId, 'opacity').map((kf) => kf.value)).toEqual([1, 0])

    const fadeIn = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.fadeIn(0.4, linear)',
    ])
    expect(errors(fadeIn)).toEqual([])
  })

  it('never writes the visible lane', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.fadeIn(0.4)',
      'hero.fadeOut(0.4)',
    ])

    expect(errors(result)).toEqual([])
    apply(system, result)

    expect(system.engine.getVisibleKeyframes(heroId)).toHaveLength(0)
    expect(
      result.commands.some(
        (command) =>
          (command.parameters.target as { kind?: string } | undefined)?.kind === 'visible',
      ),
    ).toBe(false)
  })

  it('resolves duration from the header defaults', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.3s }',
      'bind hero = node("Hero")',
      'hero.fadeIn()',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBe(0.3)
  })
})

describe('Animation Script sugar gestures — tint', () => {
  it('sets without a duration and tweens with one, like the raw forms', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const other = setup()
    const otherHero = addNode(other.system, other.slideId, 'Hero')

    const setResult = check(system, slideId, [
      'script "Demo" from 0.5',
      'defaults { duration: 0.5s }',
      'bind hero = node("Hero")',
      'hero.tint("#ff0000")',
    ])
    const rawSet = check(other.system, other.slideId, [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.set({ tint: "#ff0000" })',
    ])

    // A bare tint ignores the header defaults and stays a set at the cursor.
    expect(errors(setResult)).toEqual([])
    expect(setResult.summary.to).toBe(0.5)
    apply(system, setResult)
    apply(other.system, rawSet)
    expect(strip(system.engine.getMaterialKeyframes(heroId, 'tint'))).toEqual(
      strip(other.system.engine.getMaterialKeyframes(otherHero, 'tint')),
    )

    const tweened = setup()
    const tweenedHero = addNode(tweened.system, tweened.slideId, 'Hero')
    const rawTweened = setup()
    const rawTweenedHero = addNode(rawTweened.system, rawTweened.slideId, 'Hero')

    const tintTween = check(tweened.system, tweened.slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tint("#ff0000", 0.5, linear)',
    ])
    const rawTween = check(rawTweened.system, rawTweened.slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ tint: "#ff0000" }, 0.5, linear)',
    ])

    expect(errors(tintTween)).toEqual([])
    apply(tweened.system, tintTween)
    apply(rawTweened.system, rawTween)
    expect(strip(tweened.system.engine.getMaterialKeyframes(tweenedHero, 'tint'))).toEqual(
      strip(rawTweened.system.engine.getMaterialKeyframes(rawTweenedHero, 'tint')),
    )
  })

  it('rejects an invalid color like the raw surface does', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tint("notacolor", 0.4)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/tint/)
  })
})

describe('Animation Script sugar gestures — pulse', () => {
  it('peaks at ×1.1 halfway through the declared duration and returns', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'hero.pulse(0.6, linear)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBe(1.6)
    apply(system, result)

    for (const property of ['scaleX', 'scaleY'] as const) {
      const keyframes = system.engine.getKeyframes(heroId, property)
      expect(keyframes.map((keyframe) => keyframe.time)).toEqual([1, 1.3, 1.6])
      expect(keyframes[1].value).toBeCloseTo(1.1)
      expect(keyframes[2].value).toBeCloseTo(1)
    }
  })

  it('derives the peak from the effective start when chained after a tween', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ scaleX: 2 }, 0.5, linear)',
      'hero.pulse(0.6, linear)',
    ])

    expect(errors(result)).toEqual([])
    apply(system, result)

    const keyframes = system.engine.getKeyframes(heroId, 'scaleX')
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0, 0.5, 0.8, 1.1])
    expect(keyframes[2].value).toBeCloseTo(2.2)
    expect(keyframes[3].value).toBeCloseTo(2)
  })
})

describe('Animation Script sugar gestures — composition and re-runs', () => {
  it('composes with parallel and at like any statement', () => {
    const { system, slideId } = setup()
    const aId = addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  a.move({ x: 1 }, 0.5)',
      '  b.fadeIn(0.5)',
      '}',
      'at(1) b.pulse(0.4)',
    ])

    expect(errors(result)).toEqual([])
    expect(result.summary.to).toBe(1.4)
    apply(system, result)

    expect(system.engine.getKeyframes(aId, 'positionX').map((kf) => kf.time)).toEqual([0, 0.5])
    expect(system.engine.getKeyframes(bId, 'opacity').map((kf) => kf.time)).toEqual([0, 0.5])
    expect(system.engine.getKeyframes(bId, 'scaleX').map((kf) => kf.time)).toEqual([0, 1, 1.2, 1.4])
  })

  it('re-runs replace gesture output via the footprint', () => {
    const { system, slideId } = setup()
    const aId = addNode(system, slideId, 'Card 1')
    const bId = addNode(system, slideId, 'Card 2')
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: aId, semanticName: 'card' }))
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: bId, semanticName: 'card' }))
    const source = [
      'script "Demo" from 0',
      'defaults { duration: 0.4s }',
      'bind hero = node("Card 1")',
      'bind cards = group("card")',
      'hero.move({ x: 3 })',
      'hero.tint("#ff0000")',
      'cards.fadeOut()',
      'hero.pulse()',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)
    const snapshot = {
      positionX: system.engine.getKeyframes(aId, 'positionX').map((kf) => [kf.time, kf.value]),
      tint: system.engine.getMaterialKeyframes(aId, 'tint').map((kf) => [kf.time, kf.value]),
      opacityA: system.engine.getKeyframes(aId, 'opacity').map((kf) => [kf.time, kf.value]),
      opacityB: system.engine.getKeyframes(bId, 'opacity').map((kf) => [kf.time, kf.value]),
      scaleX: system.engine.getKeyframes(aId, 'scaleX').map((kf) => [kf.time, kf.value]),
    }

    runOk(system, slideId, source)

    expect(system.engine.getKeyframes(aId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual(
      snapshot.positionX,
    )
    expect(
      system.engine.getMaterialKeyframes(aId, 'tint').map((kf) => [kf.time, kf.value]),
    ).toEqual(snapshot.tint)
    expect(system.engine.getKeyframes(aId, 'opacity').map((kf) => [kf.time, kf.value])).toEqual(
      snapshot.opacityA,
    )
    expect(system.engine.getKeyframes(bId, 'opacity').map((kf) => [kf.time, kf.value])).toEqual(
      snapshot.opacityB,
    )
    expect(system.engine.getKeyframes(aId, 'scaleX').map((kf) => [kf.time, kf.value])).toEqual(
      snapshot.scaleX,
    )
    // Boundary pin at `from` plus the fade window: no duplication across re-runs.
    expect(system.engine.getKeyframes(aId, 'opacity')).toHaveLength(3)
  })
})
