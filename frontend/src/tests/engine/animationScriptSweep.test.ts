import { describe, expect, it } from 'vitest'
import { parseAnimationScript } from '../../engine/animationScriptParser'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { CreateNodeParameters } from '../../engine/commands/createNodeCommand'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import {
  erraticWobble,
  sweepMask,
  sweepPenPosition,
  wobbleSegmentCount,
} from '../../pixi/renderer/revealEffectRenderer'
import { sceneEffectFromJSON, sceneEffectToJSON } from '../../engine/sceneEffect'

function setup() {
  const system = createCommandSystem(() => {})
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Sweep' }))
  system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' }))
  const slide = system.engine.getActiveSlide()!
  const makeNode = (
    parentId: string,
    name: string,
    options: Omit<CreateNodeParameters, 'sceneId' | 'parentId' | 'name'> = {},
  ) => {
    const outcome = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId, name, ...options }),
    )
    if (!outcome.ok) throw outcome.error
    return system.engine.getNode((outcome.inverse as { nodeId: string }).nodeId)
  }
  makeNode(slide.scene.root.id, 'First', {
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  return { system, slide, measure: () => ({ width: 20, height: 20 }) }
}

describe('Animation Script sweep direction and wobble', () => {
  it('compiles wipe/reveal with direction and wobble ranges', () => {
    const { system, slide, measure } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "D" from 0\nbind t = node("First")\nwipe(t, over: 1, visual: none, wobbleX: { from: 0, to: 8 }, wobbleY: { from: 2, to: 20 }, direction: "right-to-left")',
      { measure },
    )
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects[0]).toMatchObject({
      kind: 'wipe',
      direction: 'right-to-left',
      wobbleX: { from: 0, to: 8 },
      wobbleY: { from: 2, to: 20 },
    })
    const fixed = checkAnimationScript(
      system.engine,
      slide.id,
      'script "D" from 0\nbind t = node("First")\nreveal(t, over: 1, visual: none, wobbleX: 5)',
      { measure },
    )
    expect(fixed.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(fixed.effects[0]).toMatchObject({ wobbleX: { from: 5, to: 5 } })
    const speedy = checkAnimationScript(
      system.engine,
      slide.id,
      'script "D" from 0\nbind t = node("First")\nwipe(t, over: 2, visual: none, wobbleY: { from: 0, to: 10 }, wobbleSpeed: 3)',
      { measure },
    )
    expect(speedy.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(speedy.effects[0]).toMatchObject({ wobbleSpeed: 3 })
  })

  it('rejects mark wobble and invalid sweep options', () => {
    const parsed = parseAnimationScript(
      'script "D" from 0\nbind t = node("First")\nmark(t, wobbleX: { from: 0, to: 1 })',
    )
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
    const parsedSpeed = parseAnimationScript(
      'script "D" from 0\nbind t = node("First")\nmark(t, wobbleSpeed: 3)',
    )
    expect(parsedSpeed.diagnostics.length).toBeGreaterThan(0)
    const { system, slide, measure } = setup()
    for (const bad of [
      'script "D" from 0\nbind t = node("First")\nreveal(t, visual: none, wobbleX: { from: 5, to: 2 })',
      'script "D" from 0\nbind t = node("First")\nreveal(t, visual: none, wobbleY: { from: -1, to: 2 })',
      'script "D" from 0\nbind t = node("First")\nreveal(t, visual: none, direction: "up")',
      'script "D" from 0\nbind t = node("First")\nreveal(t, visual: none, wobbleSpeed: 0)',
      'script "D" from 0\nbind t = node("First")\nreveal(t, visual: none, wobbleSpeed: -2)',
    ]) {
      const result = checkAnimationScript(system.engine, slide.id, bad, { measure })
      expect(result.diagnostics.filter((item) => item.severity === 'error').length).toBeGreaterThan(
        0,
      )
    }
  })

  it('sweeps directionally with deterministic erratic offsets and round-trips', () => {
    const base = {
      id: 'sweep-1',
      start: 0,
      duration: 1,
      scopeNodeIds: ['a'],
      nodeIds: ['a'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      visual: { kind: 'none' as const },
    }
    const ltr = { ...base, kind: 'reveal' as const }
    const rtl = { ...base, kind: 'reveal' as const, direction: 'right-to-left' as const }
    expect(sweepPenPosition(ltr, 0).x).toBeCloseTo(0, 5)
    expect(sweepPenPosition(ltr, 1).x).toBeCloseTo(100, 5)
    expect(sweepPenPosition(rtl, 0).x).toBeCloseTo(100, 5)
    expect(sweepPenPosition(rtl, 1).x).toBeCloseTo(0, 5)
    expect(sweepMask(ltr, 0.5)).toMatchObject({ x: 0, width: 50 })
    expect(sweepMask(rtl, 0.5)).toMatchObject({ x: 50, width: 50 })
    const wobbled = { ...base, kind: 'wipe' as const, wobbleY: { from: 2, to: 20 } }
    expect(sweepPenPosition(wobbled, 0.37)).toEqual(sweepPenPosition(wobbled, 0.37))
    expect(erraticWobble('sweep-1', 0, { from: 2, to: 20 }, 'y')).toBe(0)
    expect(erraticWobble('sweep-1', 1, { from: 2, to: 20 }, 'y')).toBe(0)
    expect(sceneEffectFromJSON(sceneEffectToJSON(wobbled as never))).toMatchObject({
      wobbleY: { from: 2, to: 20 },
    })
  })

  it('derives erratic segment counts from wobbleSpeed', () => {
    expect(wobbleSegmentCount({ duration: 1 })).toBe(6)
    expect(wobbleSegmentCount({ duration: 2 })).toBe(6)
    expect(wobbleSegmentCount({ duration: 1, wobbleSpeed: 3 })).toBe(6)
    expect(wobbleSegmentCount({ duration: 2, wobbleSpeed: 3 })).toBe(12)
    expect(wobbleSegmentCount({ duration: 0.2, wobbleSpeed: 1 })).toBe(2)
    expect(wobbleSegmentCount({ duration: 100, wobbleSpeed: 100 })).toBe(64)
    const base = {
      id: 'speed-1',
      start: 0,
      duration: 2,
      scopeNodeIds: ['a'],
      nodeIds: ['a'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      visual: { kind: 'none' as const },
      wobbleY: { from: 2, to: 20 },
    }
    const slow = { ...base, kind: 'wipe' as const, wobbleSpeed: 1 }
    const fast = { ...base, kind: 'wipe' as const, wobbleSpeed: 6 }
    expect(sweepPenPosition(slow, 0.37)).toEqual(sweepPenPosition(slow, 0.37))
    expect(sweepPenPosition(fast, 0.25).y).not.toBe(sweepPenPosition(slow, 0.25).y)
    expect(
      sceneEffectFromJSON(
        sceneEffectToJSON({ ...base, kind: 'wipe' as const, wobbleSpeed: 3 } as never),
      ),
    ).toMatchObject({ wobbleSpeed: 3 })
  })
})
