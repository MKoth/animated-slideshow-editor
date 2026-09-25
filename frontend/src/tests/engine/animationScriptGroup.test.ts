import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import type { Transform } from '../../engine/transform'

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

function addNode(
  system: System,
  slideId: string,
  name: string,
  options: {
    semanticName?: string
    parentId?: string
    transform?: Transform
    opacity?: number
  } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  const result = system.dispatcher.dispatch(
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: options.parentId ?? slide.scene.root.id,
      name,
      ...(options.semanticName !== undefined && { semanticName: options.semanticName }),
      ...(options.transform !== undefined && { transform: options.transform }),
      ...(options.opacity !== undefined && { opacity: options.opacity }),
    }),
  )
  if (!result.ok) throw new Error(`create node failed: ${result.error.message}`)
  return (result.inverse as { nodeId: string }).nodeId
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

function propertyTrack(
  system: System,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'opacity',
) {
  return system.engine.getKeyframes(nodeId, property).map((keyframe) => ({
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
  }))
}

describe('Animation Script groups — broadcast writes', () => {
  it('broadcasts a tween to every member, each starting from its own pre-run pose', () => {
    const { system, slideId } = setup()
    const cardOne = addNode(system, slideId, 'Card 1', {
      semanticName: 'card',
      transform: { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const cardTwo = addNode(system, slideId, 'Card 2', {
      semanticName: 'card',
      transform: { x: 2, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    addNode(system, slideId, 'Byline')
    const source = [
      'script "Deal" from 0.5',
      'bind cards = group("card")',
      'cards.tween({ x: 10 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Card 1.x',
      'Card 2.x',
    ])
    expect(result.summary.to).toBe(0.9)
    expect(propertyTrack(system, cardOne, 'positionX')).toEqual([
      { time: 0.5, value: 1, interpolation: 'bezier' },
      { time: 0.9, value: 10, interpolation: 'bezier' },
    ])
    expect(propertyTrack(system, cardTwo, 'positionX')).toEqual([
      { time: 0.5, value: 2, interpolation: 'bezier' },
      { time: 0.9, value: 10, interpolation: 'bezier' },
    ])
    expect(system.engine.evaluateNode(cardOne, 0.5).transform.x).toBe(1)
    expect(system.engine.evaluateNode(cardTwo, 0.5).transform.x).toBe(2)
    expect(system.engine.evaluateNode(cardOne, 0.9).transform.x).toBe(10)
    expect(system.engine.evaluateNode(cardTwo, 0.9).transform.x).toBe(10)
  })

  it('pins each member individually at from on a track written later', () => {
    const { system, slideId } = setup()
    const cardOne = addNode(system, slideId, 'Card 1', {
      semanticName: 'card',
      opacity: 0.2,
    })
    const cardTwo = addNode(system, slideId, 'Card 2', {
      semanticName: 'card',
      opacity: 0.8,
    })
    const source = [
      'script "Deal" from 0.5',
      'bind cards = group("card")',
      'cards.tween({ x: 10 }, 0.4)',
      'cards.set({ opacity: 0.25 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(propertyTrack(system, cardOne, 'opacity')).toEqual([
      { time: 0.5, value: 0.2, interpolation: 'hold' },
      { time: 0.9, value: 0.25, interpolation: 'hold' },
    ])
    expect(propertyTrack(system, cardTwo, 'opacity')).toEqual([
      { time: 0.5, value: 0.8, interpolation: 'hold' },
      { time: 0.9, value: 0.25, interpolation: 'hold' },
    ])
    expect(system.engine.evaluateNode(cardOne, 0.5).opacity).toBe(0.2)
    expect(system.engine.evaluateNode(cardTwo, 0.5).opacity).toBe(0.8)
  })

  it('orders members deterministically in scene pre-order', () => {
    const { system, slideId } = setup()
    const deck = addNode(system, slideId, 'Deck')
    const zed = addNode(system, slideId, 'Zed', { semanticName: 'card' })
    const mid = addNode(system, slideId, 'Mid', { semanticName: 'card', parentId: deck })
    const source = [
      'script "Deal" from 0',
      'bind cards = group("card")',
      'cards.set({ x: 1 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.summary.tracks.map((track) => track.nodeName)).toEqual(['Mid', 'Zed'])
    expect(propertyTrack(system, mid, 'positionX')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
    expect(propertyTrack(system, zed, 'positionX')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
  })

  it('replaces its own group output on a re-run without duplicating it', () => {
    const { system, slideId } = setup()
    const cardOne = addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    const cardTwo = addNode(system, slideId, 'Card 2', { semanticName: 'card' })
    const source = [
      'script "Deal" from 0.5',
      'bind cards = group("card")',
      'cards.tween({ x: 10, y: 3 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)
    const afterFirst = {
      one: {
        x: propertyTrack(system, cardOne, 'positionX'),
        y: propertyTrack(system, cardOne, 'positionY'),
      },
      two: {
        x: propertyTrack(system, cardTwo, 'positionX'),
        y: propertyTrack(system, cardTwo, 'positionY'),
      },
    }

    runOk(system, slideId, source)

    expect(propertyTrack(system, cardOne, 'positionX')).toEqual(afterFirst.one.x)
    expect(propertyTrack(system, cardOne, 'positionY')).toEqual(afterFirst.one.y)
    expect(propertyTrack(system, cardTwo, 'positionX')).toEqual(afterFirst.two.x)
    expect(propertyTrack(system, cardTwo, 'positionY')).toEqual(afterFirst.two.y)
    expect(propertyTrack(system, cardOne, 'positionX')).toHaveLength(2)
    expect(propertyTrack(system, cardTwo, 'positionX')).toHaveLength(2)
  })

  it('errors on duplicate aliases across node and group bindings', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    addNode(system, slideId, 'Card 1', { semanticName: 'card' })

    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Deal" from 0',
        'bind a = node("Hero")',
        'bind a = group("card")',
        'a.set({ opacity: 1 })',
      ].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'Binding "a" is already declared',
    )
  })

  it('warns about an unused group binding without blocking a run', () => {
    const { system, slideId } = setup()
    const cardId = addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    const source = ['script "Deal" from 0', 'bind cards = group("card")'].join('\n')

    const checked = checkAnimationScript(system.engine, slideId, source)
    expect(checked.runnable).toBe(true)
    expect(checked.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        line: 2,
        message: expect.stringMatching(/never used/),
      }),
    ])

    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual(checked.diagnostics)
    expect(system.engine.getKeyframes(cardId, 'positionX')).toHaveLength(0)
  })
})

describe('Animation Script groups — resolution diagnostics', () => {
  it('errors when a group resolves to no members, naming the group', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Card 1', { semanticName: 'card' })

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Deal" from 0', 'bind endings = group("ending")', 'endings.set({ x: 1 })'].join(
        '\n',
      ),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(
      1,
    )
    const error = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    expect(error).toMatchObject({ line: 2 })
    expect(error?.message).toMatch(/resolves to no nodes/)
    expect(error?.message).toContain('"ending"')
  })

  it('matches a group against Semantic Names as stored, ignoring surrounding whitespace', () => {
    const { system, slideId } = setup()
    const cardId = addNode(system, slideId, 'Card 1', { semanticName: ' card ' })
    const source = [
      'script "Deal" from 0',
      'bind cards = group(" card ")',
      'cards.set({ x: 1 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(propertyTrack(system, cardId, 'positionX')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
  })

  it('suggests near-miss Semantic Names for a zero-member group', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Habl', { semanticName: 'endings' })

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Deal" from 0', 'bind tag = group("ending")', 'tag.set({ x: 1 })'].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].message).toContain('"endings"')
  })

  it('errors per member when a broadcast hits a property that member cannot animate', () => {
    const { system, slideId } = setup()
    const slide = system.engine.getSlide(slideId)
    const bone = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Spine',
        semanticName: 'limb',
        components: { bone: { kind: 'bone', length: 100 } },
      }),
    )
    if (!bone.ok) throw new Error(bone.error.message)
    addNode(system, slideId, 'Arm', { semanticName: 'limb' })

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Deal" from 0', 'bind limbs = group("limb")', 'limbs.set({ opacity: 1 })'].join(
        '\n',
      ),
    )

    expect(result.runnable).toBe(false)
    const error = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    expect(error?.message).toMatch(/Bone node/)
    expect(error?.message).toContain('"Spine"')
  })
})
