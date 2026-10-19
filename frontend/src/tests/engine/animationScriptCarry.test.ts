import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { CreateNodeParameters } from '../../engine/commands/createNodeCommand'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { carryPosition, sceneEffectFromJSON, sceneEffectToJSON } from '../../engine/sceneEffect'

function setup() {
  const system = createCommandSystem(() => {})
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Carry' }))
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
  const carried = makeNode(slide.scene.root.id, 'Carried', {
    transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'carried-art' } },
  })
  const grabber = makeNode(slide.scene.root.id, 'Grabber', {
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'grabber-art' } },
  })
  const plain = makeNode(slide.scene.root.id, 'Plain', {
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  return { system, slide, carried, grabber, plain }
}

describe('Animation Script carry', () => {
  it('moves the target keyframes and rides a default paw grabber on top', () => {
    const { system, slide, carried } = setup()
    const source = [
      'script "Carry" from 0',
      'bind target = node("Carried")',
      'carry(target, to: { x: 300, y: 200 }, over: 2)',
    ].join('\n')
    const result = checkAnimationScript(system.engine, slide.id, source)
    expect(result.runnable).toBe(true)
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      kind: 'carry',
      start: 0,
      duration: 2,
      scopeNodeIds: [carried.id],
      nodeIds: [carried.id],
      from: { x: 10, y: 20 },
      to: { x: 300, y: 200 },
      visual: { kind: 'paw' },
    })
    expect(result.summary.to).toBe(2)
    expect(carryPosition(result.effects[0] as never, 1)).toEqual({ x: 155, y: 110 })

    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(system.engine, (c) => system.dispatcher.dispatch(c), slide.id, source).ran,
    ).toBe(true)
    expect(system.engine.evaluateNode(carried.id, 2).transform.x).toBe(300)
    expect(system.engine.evaluateNode(carried.id, 2).transform.y).toBe(200)
    expect(system.engine.evaluateNode(carried.id, 0).transform.x).toBe(10)
    const saved = sceneEffectToJSON(system.engine.getSlide(slide.id).effects[0])
    expect(sceneEffectFromJSON(saved)).toEqual(system.engine.getSlide(slide.id).effects[0])
    system.dispatcher.undo()
    expect(system.engine.getSlide(slide.id).effects).toEqual([])
    expect(system.engine.evaluateNode(carried.id, 2).transform.x).toBe(10)
  })

  it('chains carry-out from the carry-in destination', () => {
    const { system, slide, carried } = setup()
    const source = [
      'script "Carry" from 0',
      'bind target = node("Carried")',
      'carry(target, to: { x: 300, y: 200 }, over: 2)',
      'carry(target, to: { x: 10, y: 20 }, over: 2)',
    ].join('\n')
    const result = checkAnimationScript(system.engine, slide.id, source)
    expect(result.runnable).toBe(true)
    expect(result.effects).toHaveLength(2)
    expect(result.effects[0]).toMatchObject({ from: { x: 10, y: 20 }, to: { x: 300, y: 200 } })
    expect(result.effects[1]).toMatchObject({ from: { x: 300, y: 200 }, to: { x: 10, y: 20 } })
    expect(result.summary.to).toBe(4)

    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(system.engine, (c) => system.dispatcher.dispatch(c), slide.id, source).ran,
    ).toBe(true)
    expect(system.engine.evaluateNode(carried.id, 2).transform.x).toBe(300)
    expect(system.engine.evaluateNode(carried.id, 4).transform.x).toBe(10)
  })

  it('flies the grabber in from an approach point while the target holds still', () => {
    const { system, slide, carried } = setup()
    const source = [
      'script "Carry" from 0',
      'bind target = node("Carried")',
      'carry(target, to: { x: 300, y: 200 }, approach: { x: -100, y: -100 }, approachOver: 1, over: 2)',
    ].join('\n')
    const result = checkAnimationScript(system.engine, slide.id, source)
    expect(result.runnable).toBe(true)
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      kind: 'carry',
      start: 0,
      duration: 3,
      from: { x: 10, y: 20 },
      to: { x: 300, y: 200 },
      approach: { x: -100, y: -100 },
      approachDuration: 1,
    })
    expect(result.summary.to).toBe(3)
    const effect = result.effects[0] as never
    expect(carryPosition(effect, 0.5)).toEqual({ x: -45, y: -40 })
    expect(carryPosition(effect, 2).x).toBeCloseTo(155, 9)
    expect(carryPosition(effect, 2).y).toBeCloseTo(110, 9)
    expect(carryPosition(effect, 3)).toEqual({ x: 300, y: 200 })

    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(system.engine, (c) => system.dispatcher.dispatch(c), slide.id, source).ran,
    ).toBe(true)
    expect(system.engine.evaluateNode(carried.id, 1).transform.x).toBe(10)
    expect(system.engine.evaluateNode(carried.id, 1).transform.y).toBe(20)
    expect(system.engine.evaluateNode(carried.id, 3).transform.x).toBe(300)
    const saved = sceneEffectToJSON(system.engine.getSlide(slide.id).effects[0])
    expect(sceneEffectFromJSON(saved)).toEqual(system.engine.getSlide(slide.id).effects[0])
  })

  it('rejects an approach without approachOver and vice versa', () => {
    const { system, slide } = setup()
    const missingOver = checkAnimationScript(
      system.engine,
      slide.id,
      'script "C" from 0\nbind target = node("Carried")\ncarry(target, to: { x: 1, y: 1 }, approach: { x: 0, y: 0 })',
    )
    expect(missingOver.runnable).toBe(false)
    expect(missingOver.diagnostics.some((d) => d.message.includes('approachOver'))).toBe(true)
    const missingApproach = checkAnimationScript(
      system.engine,
      slide.id,
      'script "C" from 0\nbind target = node("Carried")\ncarry(target, to: { x: 1, y: 1 }, approachOver: 0.5)',
    )
    expect(missingApproach.runnable).toBe(false)
    expect(missingApproach.diagnostics.some((d) => d.message.includes('needs approach'))).toBe(true)
  })

  it('glues the grabber to the measured visual center with a rigid offset', () => {
    const { system, slide, carried } = setup()
    const measure = (nodeId: string) =>
      nodeId === carried.id ? { width: 100, height: 60, offsetX: 20, offsetY: 10 } : null
    const source = [
      'script "Carry" from 0',
      'bind target = node("Carried")',
      'carry(target, to: { x: 300, y: 200 }, over: 2)',
    ].join('\n')
    const result = checkAnimationScript(system.engine, slide.id, source, { measure })
    expect(result.runnable).toBe(true)
    expect(result.effects[0]).toMatchObject({
      kind: 'carry',
      from: { x: 10, y: 20 },
      grabDx: 20,
      grabDy: 10,
    })
    const effect = result.effects[0] as never
    expect(carryPosition(effect, 0)).toEqual({ x: 30, y: 30 })
    expect(carryPosition(effect, 2)).toEqual({ x: 320, y: 210 })
    const saved = sceneEffectToJSON(
      system.engine.getSlide(slide.id).effects[0] ?? result.effects[0],
    )
    expect(sceneEffectFromJSON(saved)).toEqual(result.effects[0])

    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(system.engine, (c) => system.dispatcher.dispatch(c), slide.id, source, {
        measure,
      }).ran,
    ).toBe(true)
    // Keyframes still drive the pivot; only the grabber rides the center.
    expect(system.engine.evaluateNode(carried.id, 2).transform.x).toBe(300)
  })

  it('keeps one rigid delta across chained carries', () => {
    const { system, slide, carried } = setup()
    const measure = (nodeId: string) =>
      nodeId === carried.id ? { width: 100, height: 60, offsetX: 20, offsetY: 10 } : null
    const source = [
      'script "Carry" from 0',
      'bind target = node("Carried")',
      'carry(target, to: { x: 300, y: 200 }, over: 2)',
      'carry(target, to: { x: 10, y: 20 }, over: 2)',
    ].join('\n')
    const result = checkAnimationScript(system.engine, slide.id, source, { measure })
    expect(result.runnable).toBe(true)
    expect(result.effects[0]).toMatchObject({ grabDx: 20, grabDy: 10 })
    expect(result.effects[1]).toMatchObject({
      from: { x: 300, y: 200 },
      grabDx: 20,
      grabDy: 10,
    })
    // The out-leg grabber starts exactly where the in-leg grabber ended.
    expect(carryPosition(result.effects[1] as never, 2)).toEqual(
      carryPosition(result.effects[0] as never, 2),
    )
  })

  it('accepts an asset grabber with mark-style visual tuning', () => {
    const { system, slide, carried, grabber } = setup()
    const source = [
      'script "Carry" from 0',
      'bind target = node("Carried")',
      'bind paw = node("Grabber")',
      'carry(target, to: { x: 1, y: 2 }, visual: paw, visualScale: 2, visualDx: 5)',
    ].join('\n')
    const result = checkAnimationScript(system.engine, slide.id, source)
    expect(result.runnable).toBe(true)
    expect(result.effects[0]).toMatchObject({
      kind: 'carry',
      visual: { kind: 'asset', nodeId: grabber.id, scale: 2, dx: 5 },
    })
    expect(carried.id).toBeTruthy()
  })

  it('rejects a missing destination, non-asset targets, and bad timings', () => {
    const { system, slide } = setup()
    const missing = checkAnimationScript(
      system.engine,
      slide.id,
      'script "C" from 0\nbind target = node("Carried")\ncarry(target, over: 1)',
    )
    expect(missing.runnable).toBe(false)
    const plainTarget = checkAnimationScript(
      system.engine,
      slide.id,
      'script "C" from 0\nbind target = node("Plain")\ncarry(target, to: { x: 1, y: 1 })',
    )
    expect(plainTarget.runnable).toBe(false)
    expect(plainTarget.diagnostics.some((d) => d.message.includes('Asset Instance'))).toBe(true)
    const badDuration = checkAnimationScript(
      system.engine,
      slide.id,
      'script "C" from 0\nbind target = node("Carried")\ncarry(target, to: { x: 1, y: 1 }, over: 0)',
    )
    expect(badDuration.diagnostics.some((d) => /duration/i.test(d.message))).toBe(true)
    const badVisual = checkAnimationScript(
      system.engine,
      slide.id,
      'script "C" from 0\nbind target = node("Carried")\nbind bad = node("Plain")\ncarry(target, to: { x: 1, y: 1 }, visual: bad)',
    )
    expect(badVisual.runnable).toBe(false)
  })
})
