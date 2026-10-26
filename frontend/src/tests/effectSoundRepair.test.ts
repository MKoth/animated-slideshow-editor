import { describe, expect, it } from 'vitest'
import {
  CreateAudioAssetCommand,
  CreateAudioClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveAudioClipCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../engine/commands'
import type { CreateNodeParameters } from '../engine/commands/createNodeCommand'
import { runAnimationScript } from '../engine/animationScriptRun'
import { repairSlideEffectSounds } from '../ai/effectSoundRepair'

function setup() {
  const system = createCommandSystem(() => {})
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Repair' }))
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
  const measurable = new Set([first.id])
  const measure = (nodeId: string) => (measurable.has(nodeId) ? { width: 20, height: 20 } : null)
  const res = system.dispatcher.dispatch(
    new CreateAudioAssetCommand({
      name: 'Scratch',
      data: 'Zg==',
      mimeType: 'audio/wav',
      metadata: { duration: 0.5, sampleRate: 44100, channels: 1 },
    }),
  )
  if (!res.ok) throw res.error
  const assetId = (res.inverse as { assetId: string }).assetId
  return { system, slide, measure, assetId }
}

const SOURCE =
  'script "Demo" from 0\nbind target = node("First")\nbind sfx = audio("Scratch")\nreveal(target, over: 1, visual: none, sound: sfx)'

function runBoard(system: ReturnType<typeof createCommandSystem>, slideId: string, source: string) {
  const dispatch = ((command: Parameters<Parameters<typeof runAnimationScript>[1]>[0]) =>
    system.dispatcher.dispatch(command)) as Parameters<typeof runAnimationScript>[1]
  const result = runAnimationScript(system.engine, dispatch, slideId, source, {
    measure: () => ({ width: 20, height: 20 }),
  })
  expect(result.ran).toBe(true)
}

function repairSystemOf(system: ReturnType<typeof createCommandSystem>) {
  return {
    dispatcher: { dispatch: system.dispatcher.dispatch.bind(system.dispatcher) },
    undoStack: system.undoStack,
  }
}

const stubMeasure = () => ({ width: 20, height: 20 })

describe('repairSlideEffectSounds', () => {
  it('deletes exactly the connected sounds and re-places them, preserving precious audio', () => {
    const { system, slide, assetId } = setup()
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId: slide.id, source: SOURCE }),
    )
    runBoard(system, slide.id, SOURCE)
    expect(system.engine.getSlide(slide.id).audio.clips).toHaveLength(2)
    // Displace one footprint clip to the sentence end (the reported bug),
    // add an orphan stray, plus precious voice/manual/music.
    const live = system.engine.getSlide(slide.id).audio.clips
    const displacedId = live[0]!.id
    expect(
      system.dispatcher.dispatch(
        new MoveAudioClipCommand({ slideId: slide.id, clipId: displacedId, timelineStart: 99 }),
      ).ok,
    ).toBe(true)
    for (const params of [
      { id: 'script-effect-clip:stale-scope:7:0', trackId: 'sfx', timelineStart: 88 },
      { trackId: 'voice', timelineStart: 0 },
      { trackId: 'sfx', timelineStart: 9 },
      { trackId: 'music', timelineStart: 4 },
    ] as const) {
      const res = system.dispatcher.dispatch(
        new CreateAudioClipCommand({
          ...((params as { id?: string }).id ? { id: (params as { id: string }).id } : {}),
          slideId: slide.id,
          assetId,
          trackId: params.trackId,
          timelineStart: params.timelineStart,
          sourceEnd: 0.5,
        }),
      )
      expect(res.ok).toBe(true)
    }
    system.undoStack.clear()
    const result = repairSlideEffectSounds(repairSystemOf(system), system.engine, slide.id, {
      measure: stubMeasure,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.noop).toBe(false)
    expect(result.deleted).toBe(2)
    expect(result.created).toBe(1)
    const clips = system.engine.getSlide(slide.id).audio.clips
    expect(
      clips
        .filter((c) => c.id.startsWith('script-effect-clip:'))
        .map((c) => c.timelineStart)
        .sort((a, b) => a - b),
    ).toEqual([0, 0.5])
    expect(clips.some((c) => c.timelineStart === 99 || c.timelineStart === 88)).toBe(false)
    expect(clips.filter((c) => c.trackId === 'voice')).toHaveLength(1)
    expect(clips.filter((c) => c.trackId === 'music')).toHaveLength(1)
    expect(
      clips.filter((c) => c.trackId === 'sfx' && !c.id.startsWith('script-effect-clip:')),
    ).toHaveLength(1)
    // One History entry, and undo restores the pre-repair state.
    expect(system.undoStack.entries.length).toBe(1)
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slide.id).audio.clips.some((c) => c.timelineStart === 99)).toBe(
      true,
    )
  })

  it('reports noop without writing history when everything is already in place', () => {
    const { system, slide } = setup()
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId: slide.id, source: SOURCE }),
    )
    runBoard(system, slide.id, SOURCE)
    system.undoStack.clear()
    const result = repairSlideEffectSounds(repairSystemOf(system), system.engine, slide.id, {
      measure: stubMeasure,
    })
    expect(result).toMatchObject({ ok: true, noop: true, deleted: 0, created: 0 })
    expect(system.undoStack.entries.length).toBe(0)
  })

  it('reports board script errors instead of silently doing nothing', () => {
    const { system, slide } = setup()
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({
        slideId: slide.id,
        source: 'script "Demo" from 0\nreveal(node("Nope"), visual: none, sound: sfx)',
      }),
    )
    system.undoStack.clear()
    const result = repairSlideEffectSounds(repairSystemOf(system), system.engine, slide.id, {
      measure: stubMeasure,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/line \d+:/)
    expect(system.undoStack.entries.length).toBe(0)
  })

  it('cleans up strays when the slide has no board script', () => {
    const { system, slide, assetId } = setup()
    const res = system.dispatcher.dispatch(
      new CreateAudioClipCommand({
        id: 'script-effect-clip:stale-scope:3:0',
        slideId: slide.id,
        assetId,
        trackId: 'sfx',
        timelineStart: 12,
        sourceEnd: 0.5,
      }),
    )
    expect(res.ok).toBe(true)
    system.undoStack.clear()
    const result = repairSlideEffectSounds(repairSystemOf(system), system.engine, slide.id, {
      measure: stubMeasure,
    })
    expect(result).toMatchObject({ ok: true, deleted: 1, created: 0, noop: false })
    expect(system.engine.getSlide(slide.id).audio.clips).toHaveLength(0)
  })

  it('reports a missing sound asset instead of a rolled-back no-op', () => {
    const { system, slide } = setup()
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({
        slideId: slide.id,
        source:
          'script "Demo" from 0\nbind target = node("First")\nbind ghost = audio("Ghost")\nreveal(target, over: 1, visual: none, sound: ghost)',
      }),
    )
    system.undoStack.clear()
    const result = repairSlideEffectSounds(repairSystemOf(system), system.engine, slide.id, {
      measure: stubMeasure,
      globalAudioAssets: [{ id: 'ghost-asset', name: 'Ghost', duration: 0.5 }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/not in this project|Board script has/)
    expect(system.undoStack.entries.length).toBe(0)
  })
})
