import { describe, expect, it } from 'vitest'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteKeyframesCommand,
  DeleteNodeCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
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

function nodeTrack(system: System, nodeId: string, property: 'positionX' | 'positionY') {
  return system.engine.getKeyframes(nodeId, property).map((keyframe) => ({
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
  }))
}

function semanticTimeline(system: System, nodeId: string) {
  return {
    x: nodeTrack(system, nodeId, 'positionX'),
    y: nodeTrack(system, nodeId, 'positionY'),
  }
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

describe('Animation Script Run — one Transaction, one undo step', () => {
  it('lands a clean run as ordinary timeline data with boundary pins and returns the Check summary', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
      'hero.set({ y: 2 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const checked = checkAnimationScript(system.engine, slideId, source)
    const undoBefore = system.undoStack.entries.length
    const events: unknown[] = []
    system.engine.subscribe((event) => events.push(event))

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(result.ran).toBe(true)
    expect(result.error).toBeNull()
    expect(result.diagnostics).toEqual([])
    expect(result.summary).toEqual(checked.summary)

    const x = system.engine.getKeyframes(heroId, 'positionX')
    expect(x.map((keyframe) => keyframe.time)).toEqual([0.5, 0.9])
    expect(x.map((keyframe) => keyframe.value)).toEqual([0, 5])
    expect(x.every((keyframe) => keyframe.interpolation === 'bezier')).toBe(true)

    const y = system.engine.getKeyframes(heroId, 'positionY')
    expect(y.map((keyframe) => keyframe.time)).toEqual([0.5, 0.9])
    expect(y.map((keyframe) => [keyframe.value, keyframe.interpolation])).toEqual([
      [0, 'hold'],
      [2, 'hold'],
    ])
    expect(system.engine.evaluateNode(heroId, 0.5).transform.x).toBe(0)
    expect(system.engine.evaluateNode(heroId, 0.9).transform.x).toBe(5)
    expect(events.length).toBeGreaterThan(0)

    expect(system.undoStack.entries).toHaveLength(undoBefore + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
  })

  it('never rewrites the source text and records the compiled footprint', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(result.ran).toBe(true)
    const script = system.engine.getSlide(slideId).animationScript
    expect(script?.source).toBe(source)
    expect(script?.lastCompiled).toMatchObject({ from: 0.5, to: 0.9 })
    expect(script?.lastCompiled?.tracks.map((track) => track.nodeId)).toHaveLength(1)
  })

  it('records nothing when the compile is blocked by diagnostics', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const broken = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: broken }))
    const undoBefore = system.undoStack.entries.length

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, broken)

    expect(result.ran).toBe(false)
    expect(result.error).toBeNull()
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled).toBeUndefined()
    expect(system.undoStack.entries).toHaveLength(undoBefore)
  })

  it('rolls back completely when a run fails mid-execute, after keyframes were emitted', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    const before = serialize(system.engine.project!)
    const undoBefore = system.undoStack.entries.length

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(result.ran).toBe(false)
    expect(result.error).toMatch(/Animation Script/)
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(serialize(system.engine.project!)).toBe(before)
    expect(system.undoStack.entries).toHaveLength(undoBefore)
  })

  it('undo reverts the output and the recorded footprint together; redo restores both', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(result.ran).toBe(true)

    expect(system.dispatcher.undo()).toBe(true)

    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    const afterUndo = system.engine.getSlide(slideId).animationScript
    expect(afterUndo?.source).toBe(source)
    expect(afterUndo?.lastCompiled).toBeUndefined()

    expect(system.dispatcher.redo()).toBe(true)

    expect(
      system.engine.getKeyframes(heroId, 'positionX').map((keyframe) => keyframe.value),
    ).toEqual([0, 5])
    const afterRedo = system.engine.getSlide(slideId).animationScript
    expect(afterRedo?.lastCompiled).toMatchObject({ from: 0.5, to: 0.9 })
  })

  it('undoes the run before the text edit, in the order the user acted', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const first = 'script "Demo" from 0'
    const second = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: first }))
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: second }))
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, second)
    expect(result.ran).toBe(true)

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe(second)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled).toBeUndefined()
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe(first)
  })

  it('leaves the timeline untouched when only Check runs', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(
      system,
      new SetSlideAnimationScriptCommand({
        slideId,
        source: ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.set({ x: 5 })'].join(
          '\n',
        ),
      }),
    )
    const undoBefore = system.undoStack.entries.length
    const before = serialize(system.engine.project!)

    checkAnimationScript(
      system.engine,
      slideId,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.set({ x: 5 })'].join('\n'),
    )

    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(serialize(system.engine.project!)).toBe(before)
    expect(system.undoStack.entries).toHaveLength(undoBefore)
  })
})

describe('Animation Script Run — replace-by-footprint on re-run', () => {
  const tweenX = [
    'script "Demo" from 0.5',
    'bind hero = node("Hero")',
    'hero.tween({ x: 5 }, 0.4)',
  ].join('\n')

  it('a second run with no source change replaces its own output instead of duplicating it', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)
    const afterFirst = semanticTimeline(system, heroId)

    const second = runAnimationScript(system.engine, boundDispatch(system), slideId, tweenX)

    expect(second.ran).toBe(true)
    expect(second.error).toBeNull()
    expect(semanticTimeline(system, heroId)).toEqual(afterFirst)
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(2)
  })

  it('keeps hand-authored animation outside the segment untouched', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(
      system,
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: heroId, property: 'positionX' },
        time: 2.5,
        value: 9,
      }),
    )
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))

    runOk(system, slideId, tweenX)
    runOk(system, slideId, tweenX)

    const x = nodeTrack(system, heroId, 'positionX')
    expect(x.map((keyframe) => keyframe.time)).toEqual([0.5, 0.9, 2.5])
    // The lone keyframe at 2.5 holds backwards, so the pre-clear pose at 0.5 is 9.
    expect(x.map((keyframe) => keyframe.value)).toEqual([9, 5, 9])
  })

  it('replaces hand edits inside the window on the next explicit run', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)

    dispatchOk(
      system,
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: heroId, property: 'positionX' },
        time: 0.7,
        value: 42,
      }),
    )
    expect(nodeTrack(system, heroId, 'positionX').map((keyframe) => keyframe.time)).toContain(0.7)

    runOk(system, slideId, tweenX)

    const x = nodeTrack(system, heroId, 'positionX')
    expect(x.map((keyframe) => keyframe.time)).toEqual([0.5, 0.9])
    expect(x.map((keyframe) => keyframe.value)).toEqual([0, 5])
  })

  it('tolerates hand-deleted keyframes inside the window without breaking the re-run', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)
    const endpoint = system.engine
      .getKeyframes(heroId, 'positionX')
      .find((keyframe) => keyframe.time === 0.9)
    if (!endpoint) throw new Error('expected the tween endpoint')
    dispatchOk(
      system,
      new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId: heroId, property: 'positionX' },
        keyframeIds: [endpoint.id],
      }),
    )

    runOk(system, slideId, tweenX)

    expect(nodeTrack(system, heroId, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      0.5, 0.9,
    ])
  })

  it('undoing a re-run restores the previous run output and the previous footprint', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)
    const afterFirst = semanticTimeline(system, heroId)
    const footprintAfterFirst = system.engine.getSlide(slideId).animationScript?.lastCompiled

    const revised = tweenX.replace('x: 5', 'x: 7')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: revised }))
    runOk(system, slideId, revised)
    const afterSecond = semanticTimeline(system, heroId)
    expect(afterSecond).not.toEqual(afterFirst)

    expect(system.dispatcher.undo()).toBe(true)
    expect(semanticTimeline(system, heroId)).toEqual(afterFirst)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled).toEqual(
      footprintAfterFirst,
    )

    expect(system.dispatcher.redo()).toBe(true)
    expect(semanticTimeline(system, heroId)).toEqual(afterSecond)
  })

  it('clears the previous window even when the new source moves the segment', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)

    const moved = [
      'script "Demo" from 2',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: moved }))
    runOk(system, slideId, moved)

    expect(nodeTrack(system, heroId, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      2, 2.4,
    ])
  })

  it('clears previous tracks the new source no longer writes', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const both = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5, y: 2 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: both }))
    runOk(system, slideId, both)
    expect(nodeTrack(system, heroId, 'positionY')).toHaveLength(2)

    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)

    expect(nodeTrack(system, heroId, 'positionY')).toHaveLength(0)
    expect(nodeTrack(system, heroId, 'positionX')).toHaveLength(2)
  })

  it('tolerates a previous footprint whose node no longer exists', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)
    dispatchOk(system, new DeleteNodeCommand({ nodeId: heroId }))

    const headerOnly = 'script "Demo" from 0.5'
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: headerOnly }))

    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, headerOnly)

    expect(result.ran).toBe(true)
    expect(result.error).toBeNull()
  })

  it('leaves the previous output and footprint untouched when the re-run is blocked', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: tweenX }))
    runOk(system, slideId, tweenX)
    const afterFirst = semanticTimeline(system, heroId)
    const footprintAfterFirst = system.engine.getSlide(slideId).animationScript?.lastCompiled

    const broken = [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'hero.tween({ x: 7 })',
    ].join('\n')
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, broken)

    expect(result.ran).toBe(false)
    expect(semanticTimeline(system, heroId)).toEqual(afterFirst)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled).toEqual(
      footprintAfterFirst,
    )
  })
})
