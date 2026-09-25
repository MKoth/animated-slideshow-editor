import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { serialize } from '../../engine/lessonSerializer'

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

describe('Animation Script Check — clean compile and dispatch nothing', () => {
  it('reports the prospective segment, written tracks and emitted keyframes', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 4, y: 2 }, 0.4)',
      'hero.set({ opacity: 1 })',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.runnable).toBe(true)
    expect(result.summary.from).toBe(0.5)
    expect(result.summary.to).toBe(0.9)
    expect(result.summary.keyframeCount).toBe(6)
    expect(result.summary.instanceCount).toBe(0)
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Hero.x',
      'Hero.y',
      'Hero.opacity',
    ])
  })

  it('leaves the engine, the undo stack and the event bus untouched', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    const events: unknown[] = []
    system.engine.subscribe((event) => events.push(event))
    const before = serialize(system.engine.project!)
    const undoBefore = system.undoStack.entries.length

    checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.tween({ x: 4 }, 0.4)'].join('\n'),
    )

    expect(serialize(system.engine.project!)).toBe(before)
    expect(system.undoStack.entries).toHaveLength(undoBefore)
    expect(events).toEqual([])
  })

  it('places a boundary pin on a track written later in the segment', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'hero.tween({ x: 1 }, 0.5)',
        'hero.set({ y: 2 })',
      ].join('\n'),
    )

    expect(result.diagnostics).toEqual([])
    expect(result.summary.from).toBe(0)
    expect(result.summary.to).toBe(0.5)
    expect(result.summary.keyframeCount).toBe(4)
    expect(result.summary.tracks.map((track) => track.property)).toEqual(['x', 'y'])
  })

  it('parses negative property values and writes them', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'hero.tween({ x: -4, rotation: -0.5 }, 0.4)',
      ].join('\n'),
    )

    expect(result.diagnostics).toEqual([])
    dispatchOk(system, new TransactionCommand([...result.commands]))

    expect(system.engine.getKeyframes(heroId, 'positionX').map((kf) => kf.value)).toEqual([0, -4])
    expect(system.engine.getKeyframes(heroId, 'rotation').map((kf) => kf.value)).toEqual([0, -0.5])
  })

  it('holds zIndex writes whatever ease the tween declares', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'hero.tween({ zIndex: 3 }, 0.4, easeIn)',
      ].join('\n'),
    )

    expect(result.diagnostics).toEqual([])
    expect(result.runnable).toBe(true)
    dispatchOk(system, new TransactionCommand([...result.commands]))

    const keyframes = system.engine.getZIndexKeyframes(heroId)
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0, 0.4])
    expect(keyframes.every((keyframe) => keyframe.interpolation === 'hold')).toBe(true)
    expect(system.engine.evaluateZIndex(heroId, 0.3)).toBe(0)
    expect(system.engine.evaluateZIndex(heroId, 0.4)).toBe(3)
  })

  it('compiles a tween into an implicit start pin from the evaluated pose plus an end keyframe', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0.5', 'bind hero = node("Hero")', 'hero.tween({ x: 5 }, 0.4)'].join(
        '\n',
      ),
    )
    expect(result.runnable).toBe(true)

    dispatchOk(system, new TransactionCommand([...result.commands]))

    const keyframes = system.engine.getKeyframes(heroId, 'positionX')
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0.5, 0.9])
    expect(keyframes.map((keyframe) => keyframe.value)).toEqual([0, 5])
    expect(keyframes.every((keyframe) => keyframe.interpolation === 'bezier')).toBe(true)
    expect(system.engine.evaluateNode(heroId, 0.9).transform.x).toBe(5)
  })
})

describe('Animation Script Check — header diagnostics', () => {
  it('requires the script header as the first line', () => {
    const { system, slideId } = setup()

    const result = checkAnimationScript(system.engine, slideId, 'bind hero = node("Hero")')

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', line: 1, column: 1 })
    expect(result.diagnostics[0].message).toMatch(/must start with a header/i)
  })

  it('rejects a from beyond the slide duration', () => {
    const { system, slideId } = setup()

    const result = checkAnimationScript(system.engine, slideId, 'script "Late" from 12')

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', line: 1 })
    expect(result.diagnostics[0].message).toMatch(/slide duration/i)
  })
})

describe('Animation Script Check — binding diagnostics', () => {
  it('lists near-miss Unique Name candidates for a misspelled name', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Habl (2)')
    addNode(system, slideId, 'Hable')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind stem = node("Habl")'].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].severity).toBe('error')
    expect(result.diagnostics[0].line).toBe(2)
    expect(result.diagnostics[0].message).toMatch(/No node named "Habl"/)
    expect(result.diagnostics[0].message).toContain('"Hable"')
    expect(result.diagnostics[0].message).toContain('"Habl (2)"')
  })

  it('resolves names case-sensitively and exactly, never by id or suffix', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const wrongCase = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("hero")'].join('\n'),
    )
    const idLiteral = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', `bind hero = node("${heroId}")`].join('\n'),
    )

    expect(wrongCase.runnable).toBe(false)
    expect(wrongCase.diagnostics[0].message).toContain('"Hero"')
    expect(idLiteral.runnable).toBe(false)
    expect(idLiteral.diagnostics[0].message).toMatch(/No node named/)
  })

  it('errors on duplicate aliases', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        'bind a = node("Hero")',
        'bind a = node("Hero")',
        'a.set({ opacity: 1 })',
      ].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'Binding "a" is already declared',
    )
  })

  it('errors on an ambiguous node name', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    addNode(system, slideId, 'Ghost')
    const slide = system.engine.getSlide(slideId)
    const ghost = slide.scene.root.children.find((node) => node.name === 'Ghost')
    if (!ghost) throw new Error('expected Ghost')
    ghost.name = 'Hero'

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind a = node("Hero")'].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/ambiguous/)
  })

  it('warns about unused bindings without blocking a run', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")'].join('\n'),
    )

    expect(result.runnable).toBe(true)
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', line: 2 })])
    expect(result.diagnostics[0].message).toMatch(/never used/)
  })
})

describe('Animation Script Check — statement diagnostics', () => {
  it('suggests a declared alias for an unknown binding', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'her.set({ opacity: 1 })'].join('\n'),
    )

    expect(result.runnable).toBe(false)
    const error = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    expect(error).toMatchObject({ line: 3 })
    expect(error?.message).toMatch(/Unknown binding "her"/)
    expect(error?.message).toContain('"hero"')
  })

  it('reports an unknown method', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.move({ x: 1 }, 0.4)'].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/Unknown method "move"/)
  })

  it('suggests a near-miss property name', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.tween({ opactiy: 1 }, 0.4)'].join(
        '\n',
      ),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/Unknown property "opactiy"/)
    expect(result.diagnostics[0].message).toContain('"opacity"')
  })

  it('requires a duration on tween and validates property values', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const missingDuration = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.tween({ x: 1 })'].join('\n'),
    )
    const badOpacity = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.set({ opacity: 2 })'].join('\n'),
    )
    const badZIndex = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.set({ zIndex: 1.5 })'].join('\n'),
    )

    expect(missingDuration.diagnostics[0].message).toMatch(/needs a duration/i)
    expect(badOpacity.diagnostics[0].message).toMatch(/between 0 and 1/)
    expect(badZIndex.diagnostics[0].message).toMatch(/whole number/)
    expect(badOpacity.runnable).toBe(false)
    expect(badZIndex.runnable).toBe(false)
  })

  it('reports a statement ending past the slide duration', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.tween({ x: 1 }, 20)'].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/past the slide duration/)
  })

  it('recovers from a malformed statement and keeps reporting later ones', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'hero.tween({ x: 1 }, 0.4)',
        'hero.set({ x: 1',
        'hero.tween({ opactiy: 1 }, 0.4)',
      ].join('\n'),
    )

    expect(result.runnable).toBe(false)
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message)
    expect(messages.some((message) => /Expected "}"|Expected "\)"/.test(message))).toBe(true)
    expect(messages.some((message) => /Unknown property "opactiy"/.test(message))).toBe(true)
  })

  it('rejects camera rotation and bone opacity like the timeline does', () => {
    const { system, slideId } = setup()
    const slide = system.engine.getSlide(slideId)
    const bone = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Spine',
        components: { bone: { kind: 'bone', length: 100 } },
      }),
    )
    if (!bone.ok) throw new Error(bone.error.message)

    const cameraRotation = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        `bind cam = node("${slide.scene.camera.name}")`,
        'cam.tween({ rotation: 1 }, 0.4)',
      ].join('\n'),
    )
    const boneOpacity = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind spine = node("Spine")', 'spine.set({ opacity: 1 })'].join(
        '\n',
      ),
    )

    expect(cameraRotation.runnable).toBe(false)
    expect(cameraRotation.diagnostics[0].message).toMatch(/Camera nodes cannot animate rotation/)
    expect(boneOpacity.runnable).toBe(false)
    expect(boneOpacity.diagnostics[0].message).toMatch(/Bone nodes cannot animate opacity/)
  })

  it('blocks a prospective run while still reporting every diagnostic', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Demo" from 0',
        'bind hero = node("Hero")',
        'hero.tween({ x: 1 })',
        'hero.set({ opacity: 2 })',
      ].join('\n'),
    )

    expect(result.runnable).toBe(false)
    expect(result.commands).toHaveLength(0)
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(
      2,
    )
    expect(result.summary.keyframeCount).toBe(0)
  })
})
