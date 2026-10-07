import { describe, expect, it } from 'vitest'
import {
  CreateAudioAssetCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  SetSlideSceneEffectsCommand,
  CreateAudioClipCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { CreateNodeParameters } from '../../engine/commands/createNodeCommand'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'

function setup() {
  const system = createCommandSystem(() => {})
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Sound' }))
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
  const group = makeNode(slide.scene.root.id, 'Group', { semanticName: 'content' })
  const first = makeNode(group.id, 'First', {
    semanticName: 'content',
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  const second = makeNode(group.id, 'Second', {
    transform: { x: 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  const measurable = new Set([first.id, second.id])
  const measure = (nodeId: string) => (measurable.has(nodeId) ? { width: 20, height: 20 } : null)
  const makeAudio = (name: string, duration: number) => {
    const res = system.dispatcher.dispatch(
      new CreateAudioAssetCommand({
        name,
        data: 'Zg==',
        mimeType: 'audio/wav',
        metadata: { duration, sampleRate: 44100, channels: 1 },
      }),
    )
    if (!res.ok) throw res.error
    return (res.inverse as { assetId: string }).assetId
  }
  return { system, slide, group, first, second, measure, makeAudio }
}

describe('Animation Script effect sounds', () => {
  it('omitted sound remains silent with no planned clips', () => {
    const { system, slide, measure } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nreveal(target, visual: none)',
      { measure },
    )
    expect(result.runnable).toBe(true)
    expect(result.effects).toHaveLength(1)
    expect(result.audioClips).toEqual([])
    expect(result.footprint.audioClipIds ?? []).toEqual([])
  })

  it('plans adjacent SFX clips spanning the visual duration with a trimmed final', () => {
    const { system, slide, measure, makeAudio } = setup()
    makeAudio('Scratch', 0.4)
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nreveal(target, over: 1, visual: none, sound: sfx)',
      { measure },
    )
    expect(result.runnable).toBe(true)
    expect(result.effects).toHaveLength(1)
    expect(result.audioClips).toHaveLength(3)
    expect(result.audioClips.map((c) => [c.timelineStart, c.sourceStart, c.sourceEnd])).toEqual([
      [0, 0, 0.4],
      [0.4, 0, 0.4],
      [0.8, 0, 0.2],
    ])
    expect(result.footprint.audioClipIds).toHaveLength(3)
  })

  it('trims a single clip when the source outlasts the effect', () => {
    const { system, slide, measure, makeAudio } = setup()
    makeAudio('Long', 2)
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Long")\nwipe(target, over: 1, visual: none, sound: sfx)',
      { measure },
    )
    expect(result.runnable).toBe(true)
    expect(result.audioClips).toHaveLength(1)
    expect(result.audioClips[0]).toMatchObject({ timelineStart: 0, sourceStart: 0, sourceEnd: 1 })
  })

  it('starts clips at an explicit at: time for wipe and mark', () => {
    const { system, slide, measure, makeAudio } = setup()
    makeAudio('Scratch', 0.5)
    const wipe = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nwipe(target, at: 2, over: 1, visual: none, sound: sfx)',
      { measure },
    )
    expect(wipe.runnable).toBe(true)
    expect(wipe.audioClips.map((c) => c.timelineStart)).toEqual([2, 2.5])
    expect(wipe.audioClips[1].sourceEnd).toBe(0.5)
    const mark = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nmark(target, at: 1, over: 1, visual: none, sound: sfx)',
      { measure },
    )
    expect(mark.runnable).toBe(true)
    expect(mark.audioClips.map((c) => c.timelineStart)).toEqual([1, 1.5])
  })

  it('rejects unknown audio, wrong binding kinds, and missing durations in Check', () => {
    const { system, slide, measure, makeAudio } = setup()
    makeAudio('Scratch', 0.4)
    const missing = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Nope")\nreveal(target, visual: none, sound: sfx)',
      { measure },
    )
    expect(missing.runnable).toBe(false)
    expect(missing.diagnostics.some((d) => /No audio/.test(d.message))).toBe(true)
    const wrongKind = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = node("First")\nreveal(target, visual: none, sound: target)',
      { measure },
    )
    expect(wrongKind.runnable).toBe(false)
    expect(wrongKind.diagnostics.some((d) => /audio binding/.test(d.message))).toBe(true)
    expect(wrongKind.effects).toEqual([])
    expect(wrongKind.audioClips).toEqual([])
  })

  it('runs effect sounds as ordinary SFX clips in one Transaction with footprint and undo', () => {
    const { system, slide, measure, makeAudio } = setup()
    const assetId = makeAudio('Scratch', 0.4)
    const source =
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nreveal(target, over: 1, visual: none, sound: sfx)'
    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        source,
        { measure },
      ).ran,
    ).toBe(true)
    const clips = system.engine.getSlide(slide.id).audio.clips
    expect(clips).toHaveLength(3)
    for (const clip of clips) {
      expect(clip.trackId).toBe('sfx')
      expect(clip.assetId).toBe(assetId)
      expect(clip.playbackRate).toBe(1)
      expect(clip.sourceStart).toBe(0)
    }
    expect(clips.map((c) => [c.timelineStart, c.sourceEnd])).toEqual([
      [0, 0.4],
      [0.4, 0.4],
      [0.8, 0.2],
    ])
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(1)
    expect(
      system.engine.getSlide(slide.id).animationScript?.lastCompiled?.audioClipIds,
    ).toHaveLength(3)
    system.dispatcher.undo()
    expect(system.engine.getSlide(slide.id).effects).toEqual([])
    expect(system.engine.getSlide(slide.id).audio.clips).toEqual([])
  })

  it('reruns replace generated clips without duplication and preserve manual audio', () => {
    const { system, slide, first, measure, makeAudio } = setup()
    const assetId = makeAudio('Scratch', 0.5)
    const manualClip = system.dispatcher.dispatch(
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'sfx',
        timelineStart: 5,
        sourceEnd: 0.5,
      }),
    )
    expect(manualClip.ok).toBe(true)
    const manual = {
      kind: 'reveal' as const,
      id: 'manual-effect',
      start: 5,
      duration: 1,
      scopeNodeIds: [first.id],
      nodeIds: [first.id],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      visual: { kind: 'none' as const },
    }
    system.dispatcher.dispatch(
      new SetSlideSceneEffectsCommand({ slideId: slide.id, effects: [manual] }),
    )
    const dispatch = (source: string) => {
      system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
      return runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        source,
        { measure },
      )
    }
    const firstSource =
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nreveal(target, over: 1, visual: none, sound: sfx)'
    expect(dispatch(firstSource).ran).toBe(true)
    expect(system.engine.getSlide(slide.id).audio.clips).toHaveLength(3)
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(2)
    const firstOutput = system.engine.getSlide(slide.id).audio.clips
    const firstEffects = system.engine.getSlide(slide.id).effects
    const secondSource =
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nreveal(target, over: 0.5, visual: none, sound: sfx)'
    expect(dispatch(secondSource).ran).toBe(true)
    const clips = system.engine.getSlide(slide.id).audio.clips
    // manual clip + one trimmed generated clip
    expect(clips).toHaveLength(2)
    expect(clips.some((c) => c.timelineStart === 5)).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(2)
    expect(system.engine.getSlide(slide.id).effects[0]).toEqual(manual)
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slide.id).audio.clips).toEqual(firstOutput)
    expect(system.engine.getSlide(slide.id).effects).toEqual(firstEffects)
  })

  it('persists generated placement and trimming through save/load', () => {
    const { system, slide, measure, makeAudio } = setup()
    makeAudio('Scratch', 0.4)
    const source =
      'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nreveal(target, over: 1, visual: none, sound: sfx)'
    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        source,
        { measure },
      ).ran,
    ).toBe(true)
    const saved = JSON.parse(serialize(system.engine.project!))
    expect(validate(saved)).toEqual([])
    const slideJson = saved.slides[0] as Record<string, unknown>
    const audio = slideJson.audio as { clips: Array<Record<string, unknown>> }
    expect(audio.clips).toHaveLength(3)
    expect(audio.clips.map((c) => [c.timelineStart, c.sourceStart, c.sourceEnd])).toEqual([
      [0, 0, 0.4],
      [0.4, 0, 0.4],
      [0.8, 0, 0.2],
    ])
    for (const clip of audio.clips) {
      expect(clip.trackId).toBe('sfx')
    }
    const restored = deserialize(JSON.stringify(saved))
    expect(restored.slides[0].audio.clips).toHaveLength(3)
    expect(restored.slides[0].effects).toHaveLength(1)
  })
})
