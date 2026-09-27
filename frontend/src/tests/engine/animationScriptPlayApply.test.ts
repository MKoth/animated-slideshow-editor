import { describe, expect, it } from 'vitest'
import {
  AddClipKeyframeCommand,
  AssignClipCommand,
  CreateClipCommand,
  CreateClipCollectionCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSemanticNameCommand,
  SetSlideAnimationScriptCommand,
  SetSlideDurationCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'

type System = ReturnType<typeof createCommandSystem>

function dispatchOk(system: System, command: Parameters<System['dispatcher']['dispatch']>[0]) {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse
}

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { system, slideId: slide.id, sceneId: slide.scene.id, rootId: slide.scene.root.id }
}

function addNode(system: System, sceneId: string, parentId: string, name: string): string {
  const result = dispatchOk(system, new CreateNodeCommand({ sceneId, parentId, name }))
  return (result as { nodeId: string }).nodeId
}

function addClip(
  system: System,
  name: string,
  duration: number,
  params: { key: string; label: string; kind: string; default: number }[] = [],
): string {
  const result = dispatchOk(
    system,
    new CreateClipCommand({
      name,
      duration,
      category: 'test',
      params: params as never,
      channels: [{ property: 'positionX' }],
    }),
  )
  return (result as { clipId: string }).clipId
}

function check(system: System, slideId: string, lines: readonly string[]) {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function messages(result: AnimationScriptCompileResult): string[] {
  return result.diagnostics.map((d) => d.message)
}

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

function runOk(system: System, slideId: string, source: string) {
  dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

describe('Animation Script play/apply — bindings', () => {
  it('binds a clip and a collection by exact name', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    dispatchOk(system, new CreateClipCollectionCommand({ name: 'Rig', bindings: {} }))

    const clipOnly = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ])
    expect(clipOnly.runnable).toBe(true)
    expect(messages(clipOnly)).toEqual([])
  })

  it('reports a missing clip with near-miss candidates', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Robot Wave', 2)

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Robot Wav")',
      'hero.play(wave)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /No clip named "Robot Wav"/.test(m))).toBe(true)
    expect(messages(result).some((m) => /Robot Wave/.test(m))).toBe(true)
  })

  it('reports a missing collection with near-miss candidates', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    dispatchOk(system, new CreateClipCollectionCommand({ name: 'Rig Moves', bindings: {} }))

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind moves = collection("Rig Move")',
      'hero.apply(moves)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /No collection named/.test(m))).toBe(true)
  })

  it('rejects duplicate binding aliases across resource kinds', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind hero = clip("Wave")',
      'hero.play(hero)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /already declared/.test(m))).toBe(true)
  })

  it('rejects ambiguous clip and collection names', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    addClip(system, 'Wave', 3)

    const clipResult = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ])
    expect(clipResult.runnable).toBe(false)
    expect(messages(clipResult).some((m) => /Clip name "Wave" is ambiguous/.test(m))).toBe(true)
  })

  it('rejects ambiguous collection names across rigs', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const rigA = addNode(system, sceneId, rootId, 'Rig A')
    const rigB = addNode(system, sceneId, rootId, 'Rig B')
    addNode(system, sceneId, rootId, 'Hero')
    dispatchOk(
      system,
      new CreateClipCollectionCommand({ name: 'Moves', bindings: {}, sourceNodeId: rigA }),
    )
    dispatchOk(
      system,
      new CreateClipCollectionCommand({ name: 'Moves', bindings: {}, sourceNodeId: rigB }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind moves = collection("Moves")',
      'hero.apply(moves)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /Collection name "Moves" is ambiguous/.test(m))).toBe(true)
  })

  it('warns on unused clip and collection bindings', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    dispatchOk(system, new CreateClipCollectionCommand({ name: 'Rig', bindings: {} }))

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'bind moves = collection("Rig")',
      'hero.tween({ x: 1 }, 0.4)',
    ])
    expect(result.runnable).toBe(true)
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
    expect(warnings.some((w) => /Binding "wave" is never used/.test(w.message))).toBe(true)
    expect(warnings.some((w) => /Binding "moves" is never used/.test(w.message))).toBe(true)
  })

  it('rejects unknown binding kinds with the full vocabulary', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = sprite("Hero")',
      'hero.tween({ x: 1 }, 0.4)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /node, group, table, clip, collection/.test(m))).toBe(true)
  })
})

describe('Animation Script play — lowering', () => {
  it('plays with defaults: start at cursor, speed 1, enabled, no overrides', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const source = [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ].join('\n')

    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.to).toBe(3)
    expect(checked.summary.instanceCount).toBe(1)
    expect(checked.footprint.instanceNodes).toEqual([hero])

    runOk(system, slideId, source)
    const instances = system.engine.getClipInstances(hero)
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({ startTime: 1, speed: 1, enabled: true })
    expect(instances[0]!.paramOverrides).toEqual({})
  })

  it('derives speed from duration and supports the positional shorthand', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const source = [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, 1)',
    ].join('\n')

    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.to).toBe(2)
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(hero)[0]).toMatchObject({ speed: 2, startTime: 1 })
  })

  it('accepts explicit speed and advances by clip.duration / speed', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { speed: 4 })',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.to).toBe(0.5)
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(hero)[0]).toMatchObject({ speed: 4 })
  })

  it('enforces duration xor speed', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { duration: 1, speed: 2 })',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /duration or speed, not both/.test(m))).toBe(true)
  })

  it('warns on sub-minimum visual durations', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { duration: 0.1 })',
    ])
    expect(result.runnable).toBe(true)
    expect(
      result.diagnostics.some(
        (d) => d.severity === 'warning' && /below the engine minimum/.test(d.message),
      ),
    ).toBe(true)
  })

  it('clamps sub-epsilon speeds with a warning', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Tick', 0.1)
    dispatchOk(system, new SetSlideDurationCommand({ slideId, duration: 1500 }))
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind tick = clip("Tick")',
      'hero.play(tick, { speed: 0 })',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(checked.runnable).toBe(true)
    expect(
      checked.diagnostics.some((d) => d.severity === 'warning' && /clamps speed/.test(d.message)),
    ).toBe(true)
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(hero)[0]!.speed).toBe(1e-4)
  })

  it('sets enabled and numeric param overrides', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2, [{ key: 'gain', label: 'Gain', kind: 'number', default: 1 }])
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { enabled: false, params: { gain: 0.5 } })',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(hero)[0]).toMatchObject({
      enabled: false,
      paramOverrides: { gain: 0.5 },
    })
  })

  it('rejects unknown clip params and non-numeric overrides', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2, [{ key: 'gain', label: 'Gain', kind: 'number', default: 1 }])

    const unknown = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { params: { nope: 1 } })',
    ])
    expect(unknown.runnable).toBe(false)
    expect(messages(unknown).some((m) => /has no param "nope"/.test(m))).toBe(true)

    const nonNumeric = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { params: { gain: "loud" } })',
    ])
    expect(nonNumeric.runnable).toBe(false)
  })

  it('rejects non-boolean enabled', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { enabled: 1 })',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /enabled must be true or false/.test(m))).toBe(true)
  })

  it('places at an inline at time and composes with the at() wrapper', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const inline = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { at: 5, duration: 1 })',
    ].join('\n')
    const checked = check(system, slideId, inline.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.to).toBe(6)
    runOk(system, slideId, inline)
    expect(system.engine.getClipInstances(hero)[0]!.startTime).toBe(5)
  })

  it('later statements win on the same lane by source order', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    addClip(system, 'Nod', 2)
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'bind nod = clip("Nod")',
      'hero.play(wave)',
      'hero.play(nod)',
    ].join('\n')
    runOk(system, slideId, source)
    const instances = system.engine.getClipInstances(hero)
    expect(instances).toHaveLength(2)
    expect(instances[0]!.clipId).toBe(system.engine.clips.find((c) => c.name === 'Wave')!.id)
    expect(instances[1]!.clipId).toBe(system.engine.clips.find((c) => c.name === 'Nod')!.id)
  })

  it('broadcasts play over group members in scene order', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const a = addNode(system, sceneId, rootId, 'Card A')
    const b = addNode(system, sceneId, rootId, 'Card B')
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: a, semanticName: 'card' }))
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: b, semanticName: 'card' }))
    addClip(system, 'Wave', 1)
    const source = [
      'script "Demo" from 2',
      'bind cards = group("card")',
      'bind wave = clip("Wave")',
      'cards.play(wave)',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.instanceCount).toBe(2)
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(a)).toHaveLength(1)
    expect(system.engine.getClipInstances(b)).toHaveLength(1)
  })

  it('evaluates the placed clip in the preview', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    const clipId = addClip(system, 'Slide', 2)
    dispatchOk(
      system,
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId, channel: 'positionX' },
        time: 0,
        value: 0,
      }),
    )
    dispatchOk(
      system,
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId, channel: 'positionX' },
        time: 1,
        value: 10,
      }),
    )
    const source = [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'bind slide = clip("Slide")',
      'hero.play(slide)',
    ].join('\n')
    runOk(system, slideId, source)
    // Mid-clip (u=0.5) the channel contributes 5 to positionX.
    expect(system.engine.evaluateNode(hero, 2).transform.x).toBeCloseTo(5, 5)
  })

  it('never mints clip definitions or collections', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const clipsBefore = system.engine.clips.length
    const collectionsBefore = system.engine.clipCollections.length
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ].join('\n')
    runOk(system, slideId, source)
    expect(system.engine.clips).toHaveLength(clipsBefore)
    expect(system.engine.clipCollections).toHaveLength(collectionsBefore)
  })

  it('rejects play with the wrong resource and method kinds', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addNode(system, sceneId, rootId, 'Other')
    addClip(system, 'Wave', 2)
    dispatchOk(system, new CreateClipCollectionCommand({ name: 'Rig', bindings: {} }))

    const wrongResource = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind other = node("Other")',
      'hero.play(other)',
    ])
    expect(wrongResource.runnable).toBe(false)
    expect(messages(wrongResource).some((m) => /needs a clip binding/.test(m))).toBe(true)

    const methodOnClip = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'wave.tween({ x: 1 }, 0.4)',
    ])
    expect(methodOnClip.runnable).toBe(false)
  })

  it('threads clip params through functions', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 1)
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'function cue(target: node, jingle: clip) {',
      '  target.play(jingle)',
      '}',
      'cue(hero, wave)',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.to).toBe(1)
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(hero)).toHaveLength(1)
  })

  it('composes with at(), repeat and parallel', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 1.2)
    const source = [
      'script "Demo" from 2',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'repeat(2) {',
      '  hero.play(wave)',
      '  wait(0.3)',
      '}',
      'at(5) hero.play(wave)',
      'parallel {',
      '  hero.play(wave)',
      '  hero.tween({ x: 1 }, 0.4)',
      '}',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    // repeat: 2×(1.2+0.3)=3 → 5; at(5) play ends 6.2; parallel max(6.2+1.2, 6.2+0.4)=7.4
    expect(checked.summary.to).toBe(7.4)
    expect(checked.summary.instanceCount).toBe(4)
    runOk(system, slideId, source)
    expect(system.engine.getClipInstances(hero)).toHaveLength(4)
  })

  it('ignores header defaults for play timing', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 1.5)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.9 }',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ])
    expect(messages(result)).toEqual([])
    expect(result.summary.to).toBe(1.5)
  })

  it('errors when a play ends past the slide duration', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 5)
    const result = check(system, slideId, [
      'script "Demo" from 9',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /past the slide duration/.test(m))).toBe(true)
  })
})

describe('Animation Script apply — lowering', () => {
  function rigScene(system: System, sceneId: string, rootId: string) {
    const rig = addNode(system, sceneId, rootId, 'Rig')
    const arm = addNode(system, sceneId, rig, 'Arm')
    const leg = addNode(system, sceneId, rig, 'Leg')
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: arm, semanticName: 'arm' }))
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: leg, semanticName: 'leg' }))
    const flex = addClip(system, 'Flex', 1.5)
    const step = addClip(system, 'Step', 1)
    dispatchOk(
      system,
      new CreateClipCollectionCommand({ name: 'Moves', bindings: { arm: flex, leg: step } }),
    )
    return { rig, arm, leg }
  }

  it('places a collection broadcast by semantic name with timing only', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const { rig, arm, leg } = rigScene(system, sceneId, rootId)
    const source = [
      'script "Demo" from 2',
      'bind rig = node("Rig")',
      'bind moves = collection("Moves")',
      'rig.apply(moves)',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    // Placed span is the max member duration (1.5); two member instances.
    expect(checked.summary.to).toBe(3.5)
    expect(checked.summary.instanceCount).toBe(2)
    expect(checked.footprint.placementParents).toEqual([rig])
    runOk(system, slideId, source)
    const placements = system.engine.getCollectionPlacements(rig)
    expect(placements).toHaveLength(1)
    expect(placements[0]!.startTime).toBe(2)
    expect(system.engine.getClipInstances(arm)).toHaveLength(1)
    expect(system.engine.getClipInstances(leg)).toHaveLength(1)
  })

  it('honours inline at and duration timing', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const { rig } = rigScene(system, sceneId, rootId)
    const source = [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'bind moves = collection("Moves")',
      'rig.apply(moves, { at: 4, duration: 3 })',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    expect(checked.summary.to).toBe(7)
    runOk(system, slideId, source)
    expect(system.engine.getCollectionPlacements(rig)[0]!.startTime).toBe(4)
  })

  it('errors when nothing matches under the parent', () => {
    const { system, slideId, sceneId, rootId } = setup()
    addNode(system, sceneId, rootId, 'Empty')
    addClip(system, 'Flex', 1)
    const flex = system.engine.clips.find((c) => c.name === 'Flex')!.id
    dispatchOk(system, new CreateClipCollectionCommand({ name: 'Moves', bindings: { arm: flex } }))
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind empty = node("Empty")',
      'bind moves = collection("Moves")',
      'empty.apply(moves)',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /matches no nodes/.test(m))).toBe(true)
  })

  it('rejects non-timing apply options', () => {
    const { system, slideId, sceneId, rootId } = setup()
    rigScene(system, sceneId, rootId)
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'bind moves = collection("Moves")',
      'rig.apply(moves, { speed: 2 })',
    ])
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /Unknown apply option/.test(m))).toBe(true)
  })

  it('threads collection params through functions', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const { rig } = rigScene(system, sceneId, rootId)
    const source = [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'bind moves = collection("Moves")',
      'function pose(root: node, routine: collection) {',
      '  root.apply(routine)',
      '}',
      'pose(rig, moves)',
    ].join('\n')
    const checked = check(system, slideId, source.split('\n'))
    expect(messages(checked)).toEqual([])
    runOk(system, slideId, source)
    expect(system.engine.getCollectionPlacements(rig)).toHaveLength(1)
  })
})

describe('Animation Script play/apply — replace-by-footprint', () => {
  it('re-running a play replaces the instance instead of stacking', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const source = [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { duration: 1 })',
    ].join('\n')
    runOk(system, slideId, source)
    const afterFirst = system.engine.getClipInstances(hero).map((i) => ({ ...i, id: 'x' }))
    const second = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(second.ran).toBe(true)
    const instances = system.engine.getClipInstances(hero)
    expect(instances).toHaveLength(1)
    expect(instances.map((i) => ({ ...i, id: 'x' }))).toEqual(afterFirst)
  })

  it('re-running an apply replaces the placement instead of stacking', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const rig = addNode(system, sceneId, rootId, 'Rig')
    const arm = addNode(system, sceneId, rig, 'Arm')
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: arm, semanticName: 'arm' }))
    const flex = addClip(system, 'Flex', 1)
    dispatchOk(system, new CreateClipCollectionCommand({ name: 'Moves', bindings: { arm: flex } }))
    const source = [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'bind moves = collection("Moves")',
      'rig.apply(moves)',
    ].join('\n')
    runOk(system, slideId, source)
    const second = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(second.ran).toBe(true)
    expect(system.engine.getCollectionPlacements(rig)).toHaveLength(1)
    expect(system.engine.getClipInstances(arm)).toHaveLength(1)
  })

  it('a moved re-run clears the previous window', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 1)
    const first = [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ].join('\n')
    runOk(system, slideId, first)
    expect(system.engine.getClipInstances(hero)[0]!.startTime).toBe(1)
    const moved = [
      'script "Demo" from 4',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: moved }))
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, moved)
    expect(result.ran).toBe(true)
    const instances = system.engine.getClipInstances(hero)
    expect(instances).toHaveLength(1)
    expect(instances[0]!.startTime).toBe(4)
  })

  it('hand-authored instances outside the window survive', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 1)
    const otherId = addClip(system, 'Other', 1)
    // Hand-place a clip outside the script window.
    dispatchOk(system, new AssignClipCommand({ nodeId: hero, clipId: otherId, startTime: 8 }))
    const source = [
      'script "Demo" from 1',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ].join('\n')
    runOk(system, slideId, source)
    runOk(system, slideId, source)
    const instances = system.engine.getClipInstances(hero)
    expect(instances).toHaveLength(2)
    expect(instances.map((i) => i.startTime).sort()).toEqual([1, 8])
  })

  it('undoing a re-run restores the previous output', () => {
    const { system, slideId, sceneId, rootId } = setup()
    const hero = addNode(system, sceneId, rootId, 'Hero')
    addClip(system, 'Wave', 2)
    const first = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave)',
    ].join('\n')
    runOk(system, slideId, first)
    expect(system.engine.getClipInstances(hero)[0]!.speed).toBe(1)
    const revised = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind wave = clip("Wave")',
      'hero.play(wave, { speed: 2 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: revised }))
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, revised)
    expect(result.ran).toBe(true)
    expect(system.engine.getClipInstances(hero)[0]!.speed).toBe(2)
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getClipInstances(hero)[0]!.speed).toBe(1)
  })
})
