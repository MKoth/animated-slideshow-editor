import { describe, expect, it } from 'vitest'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'
import { getExportFrameTimestamps } from '../../engine/export'

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

function addNode(
  system: System,
  slideId: string,
  name: string,
  options: {
    semanticName?: string
    transform?: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
    opacity?: number
  } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      name,
      ...(options.semanticName !== undefined && { semanticName: options.semanticName }),
      ...(options.transform !== undefined && { transform: options.transform }),
      ...(options.opacity !== undefined && { opacity: options.opacity }),
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

function check(system: System, slideId: string, source: string) {
  return checkAnimationScript(system.engine, slideId, source)
}

function runOk(system: System, slideId: string, source: string) {
  dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((d) => d.severity === 'error')
}

/** Timeline stripped of minted ids: time/value/interpolation only. */
function stripTrack(
  system: System,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity',
) {
  return system.engine.getKeyframes(nodeId, property).map((k) => ({
    time: k.time,
    value: k.value,
    interpolation: k.interpolation,
  }))
}

function stripMaterial(system: System, nodeId: string, parameter: string) {
  return system.engine.getMaterialKeyframes(nodeId, parameter).map((k) => ({
    time: k.time,
    value: k.value,
    interpolation: k.interpolation,
  }))
}

/** Semantically identical output: same command payloads, ignoring minted ids. */
function semanticCommands(result: AnimationScriptCompileResult) {
  return result.commands.map((c) => c.toJSON())
}

/**
 * Preview equals export at the same timestamp: the export helper derives
 * `t = i / fps` and both paths evaluate through the existing single
 * evaluator, so the poses must coincide exactly.
 */
function expectPreviewEqualsExport(
  system: System,
  nodeId: string,
  timestamps: readonly number[],
  times: readonly number[],
) {
  // The engine exposes the same helper the export path uses.
  expect(system.engine.getExportFrameTimestamps(10, 30)).toEqual(getExportFrameTimestamps(10, 30))
  for (const t of times) {
    expect(timestamps).toContain(t)
    const preview = system.engine.evaluateNode(nodeId, t)
    const viaExport = system.engine.evaluateNode(nodeId, timestamps[timestamps.indexOf(t)])
    expect(viaExport).toEqual(preview)
  }
}

const DEMO_A_COLORS = ['#D64545', '#E08A3C', '#3E9B5F', '#2E6DB4', '#8A5BD6', '#C24E8E']
const DEMO_A_ENDINGS = [
  'Ending o',
  'Ending as',
  'Ending a',
  'Ending amos',
  'Ending áis',
  'Ending an',
]

function demoASource(): string {
  return [
    'script "Hablar conjugation" from 0.5',
    'defaults { duration: 0.5s, ease: easeInOut }',
    'bind stem = node("Habl")',
    'bind dropped = node("ar Ending")',
    ...DEMO_A_ENDINGS.map((name, i) => `bind e${i} = node("${name}")`),
    'stem.tint("#2E6DB4")',
    'parallel {',
    '  dropped.tween({ x: 6, y: -2.5, rotation: -0.5 }, 0.7s, easeIn)',
    '  dropped.fadeOut(0.7s)',
    '}',
    'wait(0.6s)',
    ...DEMO_A_COLORS.map((color, i) => `e${i}.tint("${color}")`),
    'for e in [e0, e1, e2, e3, e4, e5] {',
    '  e.tween({ x: 0, y: 0, opacity: 1 }, 0.4s)',
    '  wait(0.8s)',
    '}',
  ].join('\n')
}

function setupDemoA(): {
  system: System
  slideId: string
  endingIds: string[]
  stemId: string
  droppedId: string
} {
  const { system, slideId } = setup()
  const stemId = addNode(system, slideId, 'Habl')
  const droppedId = addNode(system, slideId, 'ar Ending')
  const endingIds = DEMO_A_ENDINGS.map((name, i) =>
    addNode(system, slideId, name, {
      semanticName: 'ending',
      transform: { x: 6, y: -3 + i * 0.2, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 0,
    }),
  )
  return { system, slideId, endingIds, stemId, droppedId }
}

describe('Animation Script acceptance — Demo A hablar conjugation fill (#391)', () => {
  it('compiles and runs green over a real scene with per-ending tracks and boundary pins', () => {
    const { system, slideId, endingIds, stemId, droppedId } = setupDemoA()
    const source = demoASource()

    const checked = check(system, slideId, source)
    expect(errors(checked)).toEqual([])
    expect(checked.runnable).toBe(true)
    // 0.5 → 1.2 (parallel) → 1.8 (wait) → 9.0 (6 × (0.4 + 0.8))
    expect(checked.summary.to).toBeCloseTo(9.0, 6)

    const result = runOk(system, slideId, source)
    expect(result.diagnostics).toEqual([])

    // Per-ending position/opacity/tint tracks with boundary pins at the declared origin.
    for (const endingId of endingIds) {
      for (const property of ['positionX', 'positionY', 'opacity'] as const) {
        const track = system.engine.getKeyframes(endingId, property)
        expect(track.length).toBeGreaterThanOrEqual(2)
        expect(track[0].time).toBe(0.5)
      }
      const tint = system.engine.getMaterialKeyframes(endingId, 'tint')
      expect(tint.length).toBeGreaterThanOrEqual(1)
      expect(tint[0].time).toBe(0.5)
    }
    // One tween per ending: each ending lands home exactly once after its tint set.
    for (const endingId of endingIds) {
      const x = stripTrack(system, endingId, 'positionX')
      expect(x[x.length - 1]?.value).toBe(0)
      const opacity = stripTrack(system, endingId, 'opacity')
      expect(opacity[opacity.length - 1]?.value).toBe(1)
    }
    // Stem tint set at the cursor; dropped R-drop flight + fade.
    expect(stripMaterial(system, stemId, 'tint').map((k) => k.value)).toContain('#2E6DB4')
    expect(stripTrack(system, droppedId, 'positionX').map((k) => k.time)).toEqual([0.5, 1.2])
    expect(stripTrack(system, droppedId, 'positionX')[1]?.value).toBe(6)
  })

  it('evaluates checkpoint poses matching the demo intent, at export timestamps', () => {
    const { system, slideId, endingIds, droppedId } = setupDemoA()
    const source = demoASource()
    runOk(system, slideId, source)

    const slide = system.engine.getSlide(slideId)
    const timestamps = getExportFrameTimestamps(slide.duration, 30)
    // t = i / fps: the demo beats land exactly on the 30 Hz grid.
    expect(timestamps).toContain(0.5)
    expect(timestamps).toContain(1.2)
    expect(timestamps).toContain(9.0)

    // R-drop flight complete at t=1.2: dropped at (6, -2.5), faded out.
    const droppedAt12 = system.engine.evaluateNode(droppedId, 1.2)
    expect(droppedAt12.transform.x).toBeCloseTo(6, 4)
    expect(droppedAt12.transform.y).toBeCloseTo(-2.5, 4)
    expect(droppedAt12.opacity).toBeCloseTo(0, 4)

    // Gradual fill complete at t=9.0: every ending home at (0,0), opacity 1, per-part colour.
    for (let i = 0; i < endingIds.length; i += 1) {
      const id = endingIds[i]
      const state = system.engine.evaluateNode(id, 9.0)
      expect(state.transform.x).toBeCloseTo(0, 4)
      expect(state.transform.y).toBeCloseTo(0, 4)
      expect(state.opacity).toBeCloseTo(1, 4)
      const tint = system.engine.evaluateMaterialOverrides(id, 9.0)['tint']
      expect(String(tint).toLowerCase()).toBe(DEMO_A_COLORS[i].toLowerCase())
    }

    // Export-timestamp evaluation equals preview evaluation at the same t.
    expectPreviewEqualsExport(system, endingIds[0], timestamps, [0.5, 1.2, 9.0])
  })
})

function demoBSource(): string {
  return [
    'script "Gap fill — El gato ___ en la alfombra" from 0.5',
    'defaults { duration: 0.45s, ease: easeInOut }',
    'bind word = node("duerme")',
    'bind gap = node("Gap")',
    'wait(0.5s)',
    'gap.pulse(0.6s)',
    'wait(2.5s)',
    'word.fadeIn(0.3s)',
    'wait(0.4s)',
    'word.tween({ x: 0, y: 0 }, 0.8s)',
  ].join('\n')
}

describe('Animation Script acceptance — Demo B sentence gap-fill (#391)', () => {
  function setupDemoB() {
    const { system, slideId } = setup()
    const gapId = addNode(system, slideId, 'Gap')
    const wordId = addNode(system, slideId, 'duerme', {
      transform: { x: 8, y: 3, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 0,
    })
    return { system, slideId, gapId, wordId }
  }

  it('compiles and runs green with pulse, fade-in and fly-into-gap', () => {
    const { system, slideId, gapId, wordId } = setupDemoB()
    const source = demoBSource()

    const checked = check(system, slideId, source)
    expect(errors(checked)).toEqual([])
    expect(checked.runnable).toBe(true)
    // 0.5 → 1.0 → 1.6 → 4.1 → 4.4 → 4.8 → 5.6
    expect(checked.summary.to).toBeCloseTo(5.6, 6)

    const result = runOk(system, slideId, source)
    expect(result.diagnostics).toEqual([])

    // Pulse emits scale keyframes with the midpoint peak at half the duration.
    for (const property of ['scaleX', 'scaleY'] as const) {
      expect(stripTrack(system, gapId, property).map((k) => k.time)).toEqual([0.5, 1.0, 1.3, 1.6])
    }
    // Fade-in then fly: opacity window 4.1→4.4, position window 4.8→5.6.
    expect(stripTrack(system, wordId, 'opacity').map((k) => k.time)).toEqual([0.5, 4.1, 4.4])
    expect(stripTrack(system, wordId, 'positionX').map((k) => k.time)).toEqual([0.5, 4.8, 5.6])
    // Boundary pin keeps the word hidden until its fade-in.
    expect(stripTrack(system, wordId, 'opacity')[0]?.value).toBe(0)
    // No timed text anywhere: no text-content command, sentence stays pre-split nodes.
    expect(checked.commands.every((c) => c.type !== 'SetTextContent')).toBe(true)
  })

  it('evaluates checkpoint poses matching the demo intent, at export timestamps', () => {
    const { system, slideId, gapId, wordId } = setupDemoB()
    runOk(system, slideId, demoBSource())

    const slide = system.engine.getSlide(slideId)
    const timestamps = getExportFrameTimestamps(slide.duration, 30)
    expect(timestamps).toContain(1.3)
    expect(timestamps).toContain(4.4)
    expect(timestamps).toContain(5.6)

    // Attention pulse peaks at ×1.1 halfway through (t=1.3).
    expect(system.engine.evaluateNode(gapId, 1.3).transform.scaleX).toBeCloseTo(1.1, 4)
    expect(system.engine.evaluateNode(gapId, 1.6).transform.scaleX).toBeCloseTo(1, 4)
    // Word appears at the bank at t=4.4, then flies into the gap by t=5.6.
    expect(system.engine.evaluateNode(wordId, 4.1).opacity).toBeCloseTo(0, 4)
    expect(system.engine.evaluateNode(wordId, 4.4).opacity).toBeCloseTo(1, 4)
    const home = system.engine.evaluateNode(wordId, 5.6)
    expect(home.transform.x).toBeCloseTo(0, 4)
    expect(home.transform.y).toBeCloseTo(0, 4)

    expectPreviewEqualsExport(system, wordId, timestamps, [1.3, 4.4, 5.6])
  })
})

function demoCSource(): string {
  return [
    'script "Card pile" from 0',
    'defaults { duration: 0.4s, ease: easeOut }',
    'bind cards = group("card")',
    'bind c1 = node("Card 1")',
    'bind c2 = node("Card 2")',
    'bind c3 = node("Card 3")',
    'cards.set({ opacity: 0 })',
    'stagger(0.2s, cards) {',
    '  cards.fadeIn()',
    '}',
    'wait(0.6s)',
    'c1.tween({ x: 0, y: 0, rotation: -0.10 })',
    'c2.tween({ x: 0.4, y: 0.2, rotation: 0.06 })',
    'c3.tween({ x: -0.3, y: -0.15, rotation: 0.02 })',
    'c1.set({ zIndex: 1 })',
    'c2.set({ zIndex: 2 })',
    'c3.set({ zIndex: 3 })',
    'wait(0.5s)',
    'cards.fadeOut()',
    'c3.fadeIn(0.3s)',
  ].join('\n')
}

describe('Animation Script acceptance — Demo C image stack (#391)', () => {
  function setupDemoC() {
    const { system, slideId } = setup()
    const c1 = addNode(system, slideId, 'Card 1', {
      semanticName: 'card',
      transform: { x: -4, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const c2 = addNode(system, slideId, 'Card 2', {
      semanticName: 'card',
      transform: { x: 4, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const c3 = addNode(system, slideId, 'Card 3', {
      semanticName: 'card',
      transform: { x: 0, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    return { system, slideId, c1, c2, c3 }
  }

  it('compiles and runs green with staggered appear, gather, stacking and group fade', () => {
    const { system, slideId, c1, c2, c3 } = setupDemoC()
    const source = demoCSource()

    const checked = check(system, slideId, source)
    expect(errors(checked)).toEqual([])
    expect(checked.runnable).toBe(true)
    // 0 → 0.8 (stagger) → 1.4 → 2.6 (gather) → 3.1 → 3.5 (fade) → 3.8 (top stays)
    expect(checked.summary.to).toBeCloseTo(3.8, 6)

    const result = runOk(system, slideId, source)
    expect(result.diagnostics).toEqual([])

    // Staggered appear: (3−1)×0.2 + 0.4 = 0.8, per-member windows offset by the step.
    expect(stripTrack(system, c1, 'opacity').map((k) => k.time)).toEqual([0, 0.4, 3.1, 3.5])
    expect(stripTrack(system, c2, 'opacity').map((k) => k.time)).toEqual([0, 0.2, 0.6, 3.1, 3.5])
    expect(stripTrack(system, c3, 'opacity').map((k) => k.time)).toEqual([
      0, 0.4, 0.8, 3.1, 3.5, 3.8,
    ])
    // Appear/disappear are opacity, never the visible lane.
    for (const id of [c1, c2, c3]) {
      expect(system.engine.getVisibleKeyframes(id)).toHaveLength(0)
    }
    // Gather positions land on the pile.
    expect(system.engine.evaluateNode(c1, 1.8).transform.x).toBeCloseTo(0, 4)
    expect(system.engine.evaluateNode(c2, 2.2).transform.x).toBeCloseTo(0.4, 4)
    expect(system.engine.evaluateNode(c3, 2.6).transform.x).toBeCloseTo(-0.3, 4)
    // zIndex stacking holds as integers.
    expect(system.engine.evaluateZIndex(c1, 3.0)).toBe(1)
    expect(system.engine.evaluateZIndex(c2, 3.0)).toBe(2)
    expect(system.engine.evaluateZIndex(c3, 3.0)).toBe(3)
  })

  it('evaluates checkpoint poses matching the demo intent, at export timestamps', () => {
    const { system, slideId, c1, c2, c3 } = setupDemoC()
    runOk(system, slideId, demoCSource())

    const slide = system.engine.getSlide(slideId)
    const timestamps = getExportFrameTimestamps(slide.duration, 30)
    for (const t of [0.8, 2.6, 3.5, 3.8]) expect(timestamps).toContain(t)

    // Appeared one by one by t=0.8; gathered by t=2.6; disappeared together at t=3.5 leaving the top card at t=3.8.
    // c3 re-appears 3.5→3.8, so its joint at exactly 3.5 sits between two
    // bezier segments (transitional) — the group-fade checkpoint is c1/c2 at 0.
    expect(system.engine.evaluateNode(c1, 0.8).opacity).toBeCloseTo(1, 4)
    expect(system.engine.evaluateNode(c2, 0.8).opacity).toBeCloseTo(1, 4)
    expect(system.engine.evaluateNode(c3, 0.8).opacity).toBeCloseTo(1, 4)
    expect(system.engine.evaluateNode(c1, 3.5).opacity).toBeCloseTo(0, 4)
    expect(system.engine.evaluateNode(c2, 3.5).opacity).toBeCloseTo(0, 4)
    expect(system.engine.evaluateNode(c3, 3.8).opacity).toBeCloseTo(1, 4)

    expectPreviewEqualsExport(system, c3, timestamps, [0.8, 2.6, 3.5, 3.8])
    void c1
    void c2
  })
})

function demoDSource(): string {
  return [
    'script "Arrow points at the butterfly" from 0.5',
    'defaults { duration: 0.4s, ease: easeInOut }',
    'bind arrow = node("Arrow")',
    'bind butterfly = node("Butterfly")',
    'bind from = node("Arrow Start")',
    'bind to = node("Arrow End")',
    'arrow.set({ x: from.x, y: from.y })',
    'pointArrowAt(arrow, butterfly, at: 2.0)',
    'arrow.tween({ x: to.x, y: to.y }, 1.2s)',
    'parallel {',
    '  pointArrowAt(arrow, butterfly, over: 1.2s, every: 0.05s)',
    '  arrow.tween({ scaleX: 1.1, scaleY: 1.1 }, 1.2s)',
    '}',
  ].join('\n')
}

describe('Animation Script acceptance — Demo D arrow tracking (#391)', () => {
  function setupDemoD() {
    const { system, slideId } = setup()
    const arrowId = addNode(system, slideId, 'Arrow')
    const butterflyId = addNode(system, slideId, 'Butterfly', {
      transform: { x: 0, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    // Butterfly drifts east while the arrow flies: tracking must sample motion.
    keyframe(system, butterflyId, 'positionX', 0, 0)
    keyframe(system, butterflyId, 'positionX', 4.4, 8)
    keyframe(system, butterflyId, 'positionY', 0, 2)
    keyframe(system, butterflyId, 'positionY', 4.4, 2)
    addNode(system, slideId, 'Arrow Start', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    addNode(system, slideId, 'Arrow End', {
      transform: { x: 6, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    return { system, slideId, arrowId, butterflyId }
  }

  it('compiles and runs green with baked at: snap and sampled over: tracking', () => {
    const { system, slideId, arrowId, butterflyId } = setupDemoD()
    const source = demoDSource()

    const checked = check(system, slideId, source)
    expect(errors(checked)).toEqual([])
    expect(checked.runnable).toBe(true)
    // 0.5 → 2.0 (at:) → 3.2 (fly) → 4.4 (parallel tracking + scale)
    expect(checked.summary.to).toBeCloseTo(4.4, 6)

    const result = runOk(system, slideId, source)
    expect(result.diagnostics).toEqual([])

    // Locator reads land the arrow at the start pose.
    expect(system.engine.evaluateNode(arrowId, 0.5).transform.x).toBeCloseTo(0, 4)
    // The at: snap faces the target pivot at t=2.0.
    const targetAt2 = system.engine.evaluateNode(butterflyId, 2.0)
    const arrowAt2 = system.engine.evaluateNode(arrowId, 2.0)
    expect(arrowAt2.transform.rotation).toBeCloseTo(
      Math.atan2(targetAt2.transform.y - 0, targetAt2.transform.x - 0),
      4,
    )
    // The sampled flight bakes 1.2/0.05 = 24 intervals → 25 rotation samples (plus the at: pin).
    const rotationKeys = system.engine.getKeyframes(arrowId, 'rotation')
    expect(rotationKeys.length).toBeGreaterThanOrEqual(25)
    expect(rotationKeys.map((k) => k.time)).toContain(2.0)
    expect(rotationKeys.map((k) => k.time)).toContain(4.4)
    // Evaluator reproduces every baked sample frame for frame: each baked
    // rotation keyframe holds the value the evaluator shows at its own time.
    for (const key of rotationKeys) {
      if (key.time < 3.2 || key.time > 4.4) continue
      const arrowState = system.engine.evaluateNode(arrowId, key.time)
      expect(arrowState.transform.rotation).toBeCloseTo(Number(key.value), 6)
    }
    // Tracking is compile-time sampled and baked: the samples face the target
    // from the pre-run arrow pose (reads evaluate current scene state), so the
    // baked values equal atan2 from the origin where the arrow started.
    for (const key of rotationKeys) {
      if (key.time < 3.2 || key.time > 4.4) continue
      const target = system.engine.evaluateNode(butterflyId, key.time)
      const expected = Math.atan2(target.transform.y - 0, target.transform.x - 0)
      expect(Number(key.value)).toBeCloseTo(expected, 4)
    }
    // Fly start → end lands on the end locator.
    expect(system.engine.evaluateNode(arrowId, 3.2).transform.x).toBeCloseTo(6, 4)
  })

  it('evaluates checkpoint poses at export timestamps', () => {
    const { system, slideId, arrowId, butterflyId } = setupDemoD()
    runOk(system, slideId, demoDSource())

    const slide = system.engine.getSlide(slideId)
    const timestamps = getExportFrameTimestamps(slide.duration, 30)
    expectPreviewEqualsExport(system, arrowId, timestamps, [2.0, 3.2, 4.4])
    // Sanity: the arrow actually points somewhere finite at the export beats.
    for (const t of [2.0, 4.4]) {
      expect(Number.isFinite(system.engine.evaluateNode(arrowId, t).transform.rotation)).toBe(true)
    }
    void butterflyId
  })
})

describe('Animation Script acceptance — determinism and engine boundaries (#391)', () => {
  it('recompiling unchanged source and state yields semantically identical output (minted ids may differ)', () => {
    const sources: Array<() => { system: System; slideId: string; source: string }> = [
      () => {
        const { system, slideId } = setupDemoA()
        return { system, slideId, source: demoASource() }
      },
      () => {
        const { system, slideId } = setup()
        addNode(system, slideId, 'Gap')
        addNode(system, slideId, 'duerme', {
          transform: { x: 8, y: 3, rotation: 0, scaleX: 1, scaleY: 1 },
          opacity: 0,
        })
        return { system, slideId, source: demoBSource() }
      },
      () => {
        const { system, slideId } = setup()
        addNode(system, slideId, 'Card 1', {
          semanticName: 'card',
          transform: { x: -4, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
        })
        addNode(system, slideId, 'Card 2', {
          semanticName: 'card',
          transform: { x: 4, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
        })
        addNode(system, slideId, 'Card 3', {
          semanticName: 'card',
          transform: { x: 0, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
        })
        return { system, slideId, source: demoCSource() }
      },
      () => {
        const { system, slideId } = setup()
        addNode(system, slideId, 'Arrow')
        const butterfly = addNode(system, slideId, 'Butterfly', {
          transform: { x: 0, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
        })
        keyframe(system, butterfly, 'positionX', 0, 0)
        keyframe(system, butterfly, 'positionX', 4.4, 8)
        keyframe(system, butterfly, 'positionY', 0, 2)
        keyframe(system, butterfly, 'positionY', 4.4, 2)
        addNode(system, slideId, 'Arrow Start', {
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        })
        addNode(system, slideId, 'Arrow End', {
          transform: { x: 6, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        })
        return { system, slideId, source: demoDSource() }
      },
    ]
    for (const build of sources) {
      const { system, slideId, source } = build()
      const first = check(system, slideId, source)
      const second = check(system, slideId, source)
      expect(errors(first)).toEqual([])
      expect(errors(second)).toEqual([])
      expect(semanticCommands(second)).toEqual(semanticCommands(first))
      expect(second.summary).toEqual(first.summary)
      expect(second.footprint).toEqual(first.footprint)
    }
  })

  it('re-runs replace their own output instead of duplicating it', () => {
    const { system, slideId } = setupDemoA()
    const source = demoASource()
    const first = runOk(system, slideId, source)
    const snapshot = semanticCommands(check(system, slideId, source))
    void first
    const second = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(second.ran).toBe(true)
    expect(semanticCommands(check(system, slideId, source))).toEqual(snapshot)
  })

  it('emits only existing command kinds with no runtime player, foreign runtime or second keyframe store', () => {
    const { system, slideId } = setupDemoA()
    const checked = check(system, slideId, demoASource())
    expect(errors(checked)).toEqual([])
    const allowed = new Set(['AddKeyframe', 'SetTextContent', 'AssignClip', 'PlaceCollection'])
    for (const command of checked.commands) {
      expect(allowed.has(command.type)).toBe(true)
      const payload = command.toJSON() as Record<string, unknown>
      const target = payload['target'] as { kind?: string } | undefined
      expect(target?.kind).not.toBe('visible')
    }
    // The evaluator, export path and renderer behave exactly as before:
    // export timestamps remain t = i / fps through the existing helper.
    expect(getExportFrameTimestamps(1, 30)).toEqual(Array.from({ length: 30 }, (_, i) => i / 30))
  })

  it('Check dispatches nothing; one Run is one undo entry', () => {
    const { system, slideId } = setupDemoA()
    const source = demoASource()
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const undoBefore = system.undoStack.entries.length
    check(system, slideId, source)
    expect(system.undoStack.entries).toHaveLength(undoBefore)
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(result.error).toBeNull()
    expect(result.ran).toBe(true)
    expect(system.undoStack.entries).toHaveLength(undoBefore + 1)
  })
})
