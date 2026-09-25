import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { EASING_PRESETS } from '../../engine/easingPresets'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { SCRIPT_EASE_NAMES } from '../../engine/animationScriptEase'
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

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
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

function times(system: System, nodeId: string, property: 'positionX' | 'positionY') {
  return system.engine.getKeyframes(nodeId, property).map((keyframe) => keyframe.time)
}

describe('Animation Script time — defaults', () => {
  it('applies header defaults duration and ease to a tween', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.5s, ease: linear }',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 })',
      'hero.tween({ y: 1 })',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.5])
    expect(times(system, heroId, 'positionY')).toEqual([0, 0.5, 1])
    expect(
      system.engine
        .getKeyframes(heroId, 'positionX')
        .every((keyframe) => keyframe.interpolation === 'linear'),
    ).toBe(true)
  })

  it('lets a statement duration and ease override the header defaults', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.5, ease: linear }',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 }, 0.25s, easeOut)',
      'hero.tween({ y: 1 }, 250ms)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.5)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.25])
    expect(times(system, heroId, 'positionY')).toEqual([0, 0.25, 0.5])
    const xEase = EASING_PRESETS.find((preset) => preset.label === 'Ease Out')
    expect(system.engine.getKeyframes(heroId, 'positionX')[0].tangentOut).toEqual(xEase?.tangentOut)
    expect(system.engine.getKeyframes(heroId, 'positionX')[1].tangentIn).toEqual(xEase?.tangentIn)
    // The track's first keyframe is the hold boundary pin at from; the tween's
    // own keyframes carry the default ease.
    expect(
      system.engine
        .getKeyframes(heroId, 'positionY')
        .slice(1)
        .every((keyframe) => keyframe.interpolation === 'linear'),
    ).toBe(true)
  })

  it('still requires a duration when neither the statement nor the defaults give one', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { ease: linear }',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 })',
    ])

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/needs a duration/i)
  })

  it('rejects unknown default keys, duplicate keys, bad durations and unknown eases', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const unknownKey = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { pace: 1 }',
      'bind hero = node("Hero")',
    ])
    const duplicateKey = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 1s, duration: 2s }',
    ])
    const negativeDuration = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: -1 }',
    ])
    const unknownEase = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { ease: easeInOutt }',
    ])

    expect(messages(unknownKey).some((message) => message.includes('Unknown default "pace"'))).toBe(
      true,
    )
    expect(
      messages(duplicateKey).some((message) => message.includes('"duration" is written twice')),
    ).toBe(true)
    expect(negativeDuration.runnable).toBe(false)
    expect(messages(negativeDuration).some((message) => /duration/.test(message))).toBe(true)
    expect(unknownEase.runnable).toBe(false)
    expect(messages(unknownEase).some((message) => /Unknown ease "easeInOutt"/.test(message))).toBe(
      true,
    )
    expect(messages(unknownEase)[0]).toContain('"easeInOut"')
  })

  it('requires the defaults block to follow the header', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'defaults { duration: 0.5 }',
      'hero.tween({ x: 1 })',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /defaults/.test(message))).toBe(true)
  })
})

describe('Animation Script time — duration units', () => {
  it('reads bare seconds and s/ms suffixes and rounds emitted times to 1e-6', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(0.1)',
      'wait(100ms)',
      'wait(0.1s)',
      'hero.tween({ x: 1 }, 0.1)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.4)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.3, 0.4])
  })

  it('rejects a duration suffix on a property value', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1ms }, 0.4)',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /without a duration suffix/.test(message))).toBe(true)
  })
})

describe('Animation Script time — wait', () => {
  it('advances the cursor without emitting anything', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const source = ['script "Demo" from 0.5', 'wait(1.5s)'].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(result.ran).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(2)
    expect(result.summary.tracks).toEqual([])
    expect(result.summary.keyframeCount).toBe(0)
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled?.to).toBe(2)
  })

  it('ends an underflowing segment with compiled values holding and no implicit end pin', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
      'wait(1)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1.4)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.4])
  })

  it('accepts a statement ending exactly at the slide duration and runs it', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 }, 10)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(result.ran).toBe(true)
    expect(result.error).toBeNull()
    expect(times(system, heroId, 'positionX')).toEqual([0, 10])
  })

  it('errors one microsecond past the slide duration, matching the engine bound', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(10.000001)',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /past the slide duration/.test(message))).toBe(true)
  })

  it('errors when a wait ends past the slide duration', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(20)',
    ])

    expect(result.runnable).toBe(false)
    expect(
      messages(result).some((message) => /wait ends .* past the slide duration/i.test(message)),
    ).toBe(true)
  })

  it('errors when a wait inside a parallel child ends past the slide duration', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 9',
      'bind hero = node("Hero")',
      'parallel {',
      '  wait(0.5)',
      '  wait(2)',
      '}',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /past the slide duration/.test(message))).toBe(true)
  })
})

describe('Animation Script time — parallel', () => {
  it('advances by the latest child end and starts every child at the same cursor', () => {
    const { system, slideId } = setup()
    const aId = addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  a.tween({ x: 1 }, 0.5)',
      '  b.tween({ y: 1 }, 1.2)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(2.2)
    apply(system, result)

    expect(times(system, aId, 'positionX')).toEqual([1, 1.5])
    expect(times(system, bId, 'positionY')).toEqual([1, 2.2])
  })

  it('advances zero for an empty parallel', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'parallel { }',
      'hero.tween({ x: 1 }, 0.4)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.4)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([0, 0.4])
  })

  it('counts absolute placements inside a parallel child toward the extent', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  a.tween({ x: 1 }, 0.5)',
      '  at(2) b.tween({ y: 1 }, 0.5)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(2.5)
    apply(system, result)

    expect(times(system, bId, 'positionY')).toEqual([0, 2, 2.5])
  })

  it('nests parallels and advances by the latest enclosing child end', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'A')
    addNode(system, slideId, 'B')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'parallel {',
      '  parallel {',
      '    a.tween({ x: 1 }, 1)',
      '  }',
      '  b.tween({ y: 1 }, 0.2)',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(1)
  })
})

describe('Animation Script time — at', () => {
  it('places a statement absolutely and sets the cursor to max(cursor, end)', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')
    const cId = addNode(system, slideId, 'C')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'bind c = node("C")',
      'a.tween({ x: 1 }, 0.5)',
      'at(2) b.tween({ y: 1 }, 0.5)',
      'c.tween({ x: 1 }, 0.5)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(3)
    apply(system, result)

    expect(times(system, bId, 'positionY')).toEqual([0, 2, 2.5])
    expect(times(system, cId, 'positionX')).toEqual([0, 2.5, 3])
  })

  it('never rewinds the cursor when an absolute placement lands before it', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')
    const cId = addNode(system, slideId, 'C')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'bind c = node("C")',
      'a.tween({ x: 1 }, 2)',
      'at(0.5) b.set({ y: 1 })',
      'c.tween({ x: 1 }, 0.5)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(2.5)
    apply(system, result)

    expect(times(system, bId, 'positionY')).toEqual([0, 0.5])
    expect(times(system, cId, 'positionX')).toEqual([0, 2, 2.5])
  })

  it('errors when an at() target is before the segment start', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'at(0.5) hero.set({ x: 1 })',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /before the segment/i.test(message))).toBe(true)
  })

  it('errors when an at() target is past the slide duration', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'at(12) hero.set({ x: 1 })',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /past the slide duration/.test(message))).toBe(true)
  })
})

describe('Animation Script time — markers', () => {
  it('backs content into a marked beat without rewinding the cursor', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const bubbleId = addNode(system, slideId, 'Bubble')

    const result = check(system, slideId, [
      'script "Demo" from 1',
      'defaults { duration: 0.4, ease: easeInOut }',
      'bind hero = node("Hero")',
      'bind bubble = node("Bubble")',
      'hero.tween({ x: 4, y: 2 })',
      'bubble.tween({ opacity: 1 })',
      'mark("explain")',
      'wait(2.5s)',
      'at("explain") bubble.tween({ scaleX: 1.1, scaleY: 1.1 }, 0.6s, easeOut)',
      'hero.tween({ x: 8, y: 2 })',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(4.7)
    apply(system, result)

    expect(times(system, heroId, 'positionX')).toEqual([1, 1.4, 4.3, 4.7])
    expect(times(system, bubbleId, 'positionY')).toEqual([])
    const scaleX = system.engine.getKeyframes(bubbleId, 'scaleX')
    expect(scaleX.map((keyframe) => keyframe.time)).toEqual([1, 1.8, 2.4])
  })

  it('keeps markers compile-time only: no commands, tracks or timeline data', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'mark("beat")',
    ])

    expect(result.runnable).toBe(true)
    expect(result.commands).toHaveLength(0)
    expect(result.summary.tracks).toEqual([])
    expect(result.summary.keyframeCount).toBe(0)
  })

  it('suggests defined markers for an unknown marker name', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'mark("beacon")',
      'at("becon") hero.set({ x: 1 })',
    ])

    expect(result.runnable).toBe(false)
    const error = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    expect(error?.message).toMatch(/Unknown marker "becon"/)
    expect(error?.message).toContain('"beacon"')
  })

  it('errors on duplicate marker labels', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'mark("beat")',
      'wait(0.5)',
      'mark("beat")',
    ])

    expect(result.runnable).toBe(false)
    expect(
      messages(result).some((message) => /Marker "beat" is already declared/.test(message)),
    ).toBe(true)
  })

  it('requires markers to be defined before use', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'at("later") hero.set({ x: 1 })',
      'mark("later")',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /Unknown marker "later"/.test(message))).toBe(true)
    // The placement is never lowered at a guessed time.
    expect(result.summary.keyframeCount).toBe(0)
    expect(result.commands).toHaveLength(0)
  })

  it('labels a parallel child at its local time, not the enclosing cursor end', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'A')
    const bId = addNode(system, slideId, 'B')
    const cId = addNode(system, slideId, 'C')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind a = node("A")',
      'bind b = node("B")',
      'bind c = node("C")',
      'wait(1)',
      'parallel {',
      '  a.tween({ x: 1 }, 0.5)',
      '  mark("beat")',
      '  wait(0.25)',
      '}',
      'at("beat") b.set({ y: 1 })',
      'c.tween({ x: 1 }, 0.5)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(2)
    apply(system, result)

    // The mark's own child starts at the parallel cursor (1), not at the
    // group's later end (1.5).
    expect(times(system, bId, 'positionY')).toEqual([0, 1])
    expect(times(system, cId, 'positionX')).toEqual([0, 1.5, 2])
  })
})

describe('Animation Script time — ease vocabulary', () => {
  const INTERPOLATION_BY_NAME: Record<string, string> = {
    hold: 'hold',
    linear: 'linear',
    easeIn: 'bezier',
    easeOut: 'bezier',
    easeInOut: 'bezier',
    quadratic: 'bezier',
    cubic: 'bezier',
    quartic: 'bezier',
    quintic: 'bezier',
    back: 'bezier',
    bounce: 'bounce',
    elastic: 'elastic',
    spring: 'spring',
  }

  it('maps every ease name to the interpolation the name implies', () => {
    for (const name of SCRIPT_EASE_NAMES) {
      const { system, slideId } = setup()
      const heroId = addNode(system, slideId, 'Hero')
      const result = check(system, slideId, [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        `hero.tween({ x: 1 }, 0.4, ${name})`,
      ])

      expect(result.diagnostics).toEqual([])
      apply(system, result)

      const keyframes = system.engine.getKeyframes(heroId, 'positionX')
      expect(
        keyframes.every((keyframe) => keyframe.interpolation === INTERPOLATION_BY_NAME[name]),
      ).toBe(true)
    }
  })

  it('configures bezier presets with the timeline preset tangents', () => {
    const presetEases = [
      'easeIn',
      'easeOut',
      'easeInOut',
      'quadratic',
      'cubic',
      'quartic',
      'quintic',
      'back',
    ]
    for (const name of presetEases) {
      const { system, slideId } = setup()
      const heroId = addNode(system, slideId, 'Hero')
      const result = check(system, slideId, [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        `hero.tween({ x: 1 }, 0.4, ${name})`,
      ])
      apply(system, result)

      const keyframes = system.engine.getKeyframes(heroId, 'positionX')
      const preset = EASING_PRESETS.find(
        (candidate) =>
          candidate.tangentIn.time === keyframes[0].tangentIn.time &&
          candidate.tangentIn.value === keyframes[0].tangentIn.value &&
          candidate.tangentOut.time === keyframes[0].tangentOut.time &&
          candidate.tangentOut.value === keyframes[0].tangentOut.value,
      )
      expect(preset, `expected ${name} to match a timeline preset`).toBeDefined()
      expect(keyframes[1].tangentIn).toEqual(keyframes[0].tangentIn)
      expect(keyframes[1].tangentOut).toEqual(keyframes[0].tangentOut)
    }
  })

  it('holds zIndex whatever parametric ease the tween declares', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ zIndex: 2 }, 0.4, bounce)',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(
      system.engine
        .getZIndexKeyframes(heroId)
        .every((keyframe) => keyframe.interpolation === 'hold'),
    ).toBe(true)
  })
})

describe('Animation Script time — syntax recovery', () => {
  it('reports malformed wait, mark, at and parallel statements and keeps going', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait()',
      'mark(1)',
      'at() hero.set({ x: 1 })',
      'parallel hero.set({ x: 1 })',
      'hero.tween({ x: 1 }, 0.4)',
    ])

    expect(result.runnable).toBe(false)
    const found = messages(result)
    expect(found.some((message) => /Expected a duration/.test(message))).toBe(true)
    expect(found.some((message) => /Expected a marker name/.test(message))).toBe(true)
    expect(found.some((message) => /Expected a time or a marker name/.test(message))).toBe(true)
    expect(found.some((message) => /Expected "\{"/.test(message))).toBe(true)
    expect(found.some((message) => /Unknown property/.test(message))).toBe(false)
  })

  it('reports an unterminated parallel block', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'parallel {',
      '  hero.tween({ x: 1 }, 0.4)',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /Expected "}"/.test(message))).toBe(true)
  })
})
