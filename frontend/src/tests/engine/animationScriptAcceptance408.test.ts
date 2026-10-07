import { describe, expect, it } from 'vitest'
import {
  CreateAudioAssetCommand,
  CreateAudioClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateTableCommand,
  RenameNodeCommand,
  SetSlideAnimationScriptCommand,
  SetSlideDurationCommand,
  SetSlideSceneEffectsCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import {
  markLifecycle,
  revealCoverage,
  selectActiveMarks,
  selectRevealWipeForNode,
} from '../../engine/sceneEffect'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'
import { getExportFrameTimestamps } from '../../engine/export'

type System = ReturnType<typeof createCommandSystem>

function dispatchOk<T>(system: System, command: Command<T>): T {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse as T
}

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

function setupAcceptance() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Acceptance' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  dispatchOk(system, new SetSlideDurationCommand({ slideId: slide.id, duration: 10 }))
  const slideId = slide.id
  const sceneId = slide.scene.id
  const rootId = slide.scene.root.id

  const titleId = dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId,
      parentId: rootId,
      name: 'Lesson title',
      components: {
        text: { kind: 'text', content: 'Lesson 01', fontSize: 56, alignment: 'center' },
      },
    }),
  ).nodeId

  const sentenceId = dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId,
      parentId: rootId,
      name: 'Example sentence',
      components: {
        text: { kind: 'text', content: 'Yo soy estudiante.', fontSize: 30, alignment: 'left' },
      },
    }),
  ).nodeId

  const { tableNodeId } = dispatchOk(system, new CreateTableCommand({ sceneId, parentId: rootId }))
  dispatchOk(system, new RenameNodeCommand({ nodeId: tableNodeId, name: 'Grammar table' }))
  const table = system.engine.getNode(tableNodeId)
  const cellTextIds: string[] = []
  const containerIds = new Set<string>([tableNodeId])
  const walk = (nodeId: string) => {
    const node = system.engine.getNode(nodeId)
    if (node.components.tableRow ?? node.components.tableCell) containerIds.add(nodeId)
    if (node.components.text) cellTextIds.push(nodeId)
    for (const child of node.children) walk(child.id)
  }
  for (const child of table.children) walk(child.id)

  const assetId = dispatchOk(
    system,
    new CreateAudioAssetCommand({
      name: 'Scratch',
      data: 'Zg==',
      mimeType: 'audio/wav',
      metadata: { duration: 0.4, sampleRate: 44100, channels: 1 },
    }),
  ).assetId

  const textIds = new Set([titleId, sentenceId, ...cellTextIds])
  const measure = (nodeId: string) => (textIds.has(nodeId) ? { width: 20, height: 10 } : null)

  return {
    system,
    slideId,
    titleId,
    sentenceId,
    tableNodeId,
    cellTextIds,
    containerIds,
    assetId,
    measure,
  }
}

function acceptanceSource(): string {
  return [
    'script "Effects acceptance" from 0',
    'bind grid = table("Grammar table")',
    'bind sentence = node("Example sentence")',
    'bind title = node("Lesson title")',
    'bind sfx = audio("Scratch")',
    'reveal(grid, at: 1, over: 1, visual: none, sound: sfx)',
    'wipe(sentence, at: 3, over: 1, visual: none)',
    'mark(title, at: 5, over: 1, visual: none)',
  ].join('\n')
}

describe('Animation Script acceptance — reveal, mark, and wipe flow (#408)', () => {
  it('preserves the scene and compiles reveal on the table subtree, wipe on the sentence, and mark on the title', () => {
    const { system, slideId, tableNodeId, sentenceId, titleId, cellTextIds, measure } =
      setupAcceptance()
    const checked = checkAnimationScript(system.engine, slideId, acceptanceSource(), { measure })
    expect(checked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(checked.runnable).toBe(true)
    expect(checked.effects).toHaveLength(3)
    const [reveal, wipe, mark] = checked.effects
    expect(reveal).toMatchObject({ kind: 'reveal', start: 1, duration: 1 })
    expect(wipe).toMatchObject({ kind: 'wipe', start: 3, duration: 1 })
    expect(mark).toMatchObject({ kind: 'mark', start: 5, duration: 1 })
    // Table subtree behaves as one composite: cell text included, layout slots excluded.
    expect(reveal.scopeNodeIds).toContain(tableNodeId)
    for (const id of cellTextIds) expect(reveal.nodeIds).toContain(id)
    const slide = system.engine.getSlide(slideId)
    const containerNames = [...slide.scene.root.children]
      .flatMap((child) => [child, ...child.children.flatMap((row) => [row, ...row.children])])
      .filter((node) => node.components.tableRow ?? node.components.tableCell)
      .map((node) => node.id)
    for (const id of containerNames) expect(reveal.nodeIds).not.toContain(id)
    expect(wipe.nodeIds).toEqual([sentenceId])
    expect(mark.nodeIds).toEqual([titleId])
    // Cursor advances by visual duration even with explicit placement.
    expect(checked.summary.to).toBeCloseTo(3, 6)
  })

  it('runs Check then Run into persisted effect records with adjacent SFX timing and trimmed final clip', () => {
    const { system, slideId, assetId, measure } = setupAcceptance()
    const source = acceptanceSource()
    const checked = checkAnimationScript(system.engine, slideId, source, { measure })
    expect(checked.runnable).toBe(true)
    // 1s reveal over a 0.4s scratch: adjacent placements with the final trimmed.
    expect(checked.audioClips.map((c) => [c.timelineStart, c.sourceStart, c.sourceEnd])).toEqual([
      [1, 0, 0.4],
      [1.4, 0, 0.4],
      [1.8, 0, 0.2],
    ])
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source, {
      measure,
    })
    expect(result.ran).toBe(true)
    expect(system.engine.getSlide(slideId).effects).toHaveLength(3)
    const clips = system.engine.getSlide(slideId).audio.clips
    expect(clips).toHaveLength(3)
    for (const clip of clips) {
      expect(clip.trackId).toBe('sfx')
      expect(clip.assetId).toBe(assetId)
      expect(clip.playbackRate).toBe(1)
    }
    expect(clips.map((c) => [c.timelineStart, c.sourceEnd])).toEqual([
      [1, 0.4],
      [1.4, 0.4],
      [1.8, 0.2],
    ])
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled?.effectIds).toHaveLength(3)
    expect(
      system.engine.getSlide(slideId).animationScript?.lastCompiled?.audioClipIds,
    ).toHaveLength(3)
  })

  it('reruns without duplicating the footprint, preserves manual data, and one undo restores the prior output', () => {
    const { system, slideId, assetId, measure } = setupAcceptance()
    const source = acceptanceSource()
    const manualEffect = {
      kind: 'reveal' as const,
      id: 'manual-effect',
      start: 8,
      duration: 1,
      scopeNodeIds: [system.engine.getSlide(slideId).scene.root.id],
      nodeIds: [system.engine.getSlide(slideId).scene.root.children[0].id],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      visual: { kind: 'none' as const },
    }
    dispatchOk(system, new SetSlideSceneEffectsCommand({ slideId, effects: [manualEffect] }))
    const manualClip = dispatchOk(
      system,
      new CreateAudioClipCommand({
        slideId,
        assetId,
        trackId: 'sfx',
        timelineStart: 9,
        sourceEnd: 0.4,
      }),
    )
    void manualClip
    const run = (next: string) => {
      dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: next }))
      return runAnimationScript(system.engine, boundDispatch(system), slideId, next, { measure })
    }
    expect(run(source).ran).toBe(true)
    expect(system.engine.getSlide(slideId).effects).toHaveLength(4)
    expect(system.engine.getSlide(slideId).audio.clips).toHaveLength(4)
    const firstEffects = system.engine.getSlide(slideId).effects
    const firstClips = system.engine.getSlide(slideId).audio.clips
    // Rerun the same source: replacement, not duplication.
    expect(run(source).ran).toBe(true)
    expect(system.engine.getSlide(slideId).effects).toHaveLength(4)
    expect(system.engine.getSlide(slideId).audio.clips).toHaveLength(4)
    expect(system.engine.getSlide(slideId).effects[0]).toEqual(manualEffect)
    expect(system.engine.getSlide(slideId).audio.clips.some((c) => c.timelineStart === 9)).toBe(
      true,
    )
    // One undo restores the prior Run output as one coherent Transaction.
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).effects).toEqual(firstEffects)
    expect(system.engine.getSlide(slideId).audio.clips).toEqual(firstClips)
  })

  it('seeks out of order through partial and terminal phases deterministically', () => {
    const { system, slideId, measure } = setupAcceptance()
    const source = acceptanceSource()
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    expect(
      runAnimationScript(system.engine, boundDispatch(system), slideId, source, { measure }).ran,
    ).toBe(true)
    const [reveal, wipe, mark] = system.engine.getSlide(slideId).effects
    // Out-of-order seeks: partial and terminal reveal/wipe plus mark draw/hold/fade.
    const order = [5.5, 1, 3.5, 6, 1.5, 4, 5.7, 2, 5.85]
    const firstPass = order.map((t) => ({
      reveal: revealCoverage(reveal, t),
      wipe: revealCoverage(wipe, t),
      mark: markLifecycle(mark as Extract<typeof mark, { kind: 'mark' }>, t),
    }))
    expect(firstPass.map((entry) => entry.reveal)).toEqual([1, 0, 1, 1, 0.5, 1, 1, 1, 1])
    expect(firstPass.map((entry) => entry.wipe)).toEqual([1, 0, 0.5, 1, 0, 1, 1, 0, 1])
    expect(firstPass[0].mark).toEqual({ drawProgress: 1, opacity: 1 })
    expect(firstPass[3].mark.opacity).toBe(0)
    expect(firstPass[6].mark.opacity).toBeCloseTo(1, 6)
    expect(firstPass[8].mark.opacity).toBeCloseTo(0.5, 6)
    // Revisiting a timestamp is deterministic.
    const revisit = order.map((t) => ({
      reveal: revealCoverage(reveal, t),
      wipe: revealCoverage(wipe, t),
      mark: markLifecycle(mark as Extract<typeof mark, { kind: 'mark' }>, t),
    }))
    expect(revisit).toEqual(firstPass)
    // Terminal states: reveal fully shown, wipe fully hidden, mark faded.
    expect(revealCoverage(reveal, 2)).toBe(1)
    expect(revealCoverage(wipe, 4)).toBe(1)
    expect(markLifecycle(mark as Extract<typeof mark, { kind: 'mark' }>, 6).opacity).toBe(0)
  })

  it('persists compiled effects and trimmed audio through save/load and tolerates older lessons', () => {
    const { system, slideId, measure } = setupAcceptance()
    const source = acceptanceSource()
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    expect(
      runAnimationScript(system.engine, boundDispatch(system), slideId, source, { measure }).ran,
    ).toBe(true)
    const saved = JSON.parse(serialize(system.engine.project!))
    expect(validate(saved)).toEqual([])
    const slideJson = saved.slides[0] as Record<string, unknown>
    expect(slideJson.effects as unknown[]).toHaveLength(3)
    const audio = slideJson.audio as { clips: Array<Record<string, unknown>> }
    expect(audio.clips).toHaveLength(3)
    expect(audio.clips.map((c) => [c.timelineStart, c.sourceStart, c.sourceEnd])).toEqual([
      [1, 0, 0.4],
      [1.4, 0, 0.4],
      [1.8, 0, 0.2],
    ])
    for (const clip of audio.clips) expect(clip.trackId).toBe('sfx')
    const restored = deserialize(JSON.stringify(saved))
    expect(restored.slides[0].effects).toHaveLength(3)
    expect(restored.slides[0].audio.clips).toHaveLength(3)
    // Older lessons without effect data load as having no effects.
    const legacy = JSON.parse(JSON.stringify(saved)) as { slides: Array<Record<string, unknown>> }
    delete legacy.slides[0].effects
    expect(deserialize(JSON.stringify(legacy)).slides[0].effects).toEqual([])
  })

  it('shares one evaluator between preview and Video Export at exact effect timestamps', () => {
    const { system, slideId, measure } = setupAcceptance()
    const source = acceptanceSource()
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    expect(
      runAnimationScript(system.engine, boundDispatch(system), slideId, source, { measure }).ran,
    ).toBe(true)
    const slide = system.engine.getSlide(slideId)
    const timestamps = getExportFrameTimestamps(slide.duration, 30)
    // Effect beats land on the export grid: t = i / fps.
    for (const t of [1, 1.5, 2, 3.5, 4, 5.5, 6]) expect(timestamps).toContain(t)
    const [reveal, wipe, mark] = slide.effects
    for (const t of [1, 1.5, 2, 3.5, 5.5]) {
      const previewReveal = revealCoverage(reveal, t)
      const exportReveal = revealCoverage(reveal, timestamps[timestamps.indexOf(t)])
      expect(exportReveal).toBe(previewReveal)
      const previewMark = markLifecycle(mark as Extract<typeof mark, { kind: 'mark' }>, t)
      const exportMark = markLifecycle(
        mark as Extract<typeof mark, { kind: 'mark' }>,
        timestamps[timestamps.indexOf(t)],
      )
      expect(exportMark).toEqual(previewMark)
    }
    void wipe
    const job = system.engine.buildExportJobDescriptor({ fps: 30 })
    expect(job.slides[0].effects.map((effect) => effect.id).sort()).toEqual(
      slide.effects.map((effect) => effect.id).sort(),
    )
    expect(job.slides[0].video.timestamps).toEqual(timestamps)
    const again = system.engine.buildExportJobDescriptor({ fps: 30 })
    expect(again.determinismKey).toBe(job.determinismKey)
  })

  it('rejects empty targets and invalid options in Check without emitting effects', () => {
    const { system, slideId } = setupAcceptance()
    const empty = checkAnimationScript(
      system.engine,
      slideId,
      'script "Bad" from 0\nbind missing = node("Nope")\nreveal(missing, visual: none)',
      { measure: () => null },
    )
    expect(empty.runnable).toBe(false)
    expect(empty.effects).toEqual([])
    const badDuration = checkAnimationScript(
      system.engine,
      slideId,
      'script "Bad" from 0\nbind title = node("Lesson title")\nmark(title, over: 0, visual: none)',
      { measure: () => ({ width: 10, height: 10 }) },
    )
    expect(badDuration.diagnostics.some((d) => /duration/i.test(d.message))).toBe(true)
    expect(badDuration.effects).toEqual([])
  })

  it('uses the latest scheduled effect for overlapping reveal/wipe and marks on the same target', () => {
    const { system, slideId, titleId, measure } = setupAcceptance()
    const source = [
      'script "Overlap" from 0',
      'bind title = node("Lesson title")',
      'reveal(title, at: 1, over: 2, visual: none)',
      'wipe(title, at: 2, over: 2, visual: none)',
      'mark(title, at: 1, over: 2, visual: none)',
      'mark(title, at: 2, over: 2, visual: none)',
    ].join('\n')
    const checked = checkAnimationScript(system.engine, slideId, source, { measure })
    expect(checked.runnable).toBe(true)
    expect(checked.effects).toHaveLength(4)
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    expect(
      runAnimationScript(system.engine, boundDispatch(system), slideId, source, { measure }).ran,
    ).toBe(true)
    const effects = system.engine.getSlide(slideId).effects
    // Before the later sweep, the earlier reveal governs; after, the wipe governs.
    expect(selectRevealWipeForNode(effects, titleId, 1.5)?.kind).toBe('reveal')
    expect(selectRevealWipeForNode(effects, titleId, 2.5)?.kind).toBe('wipe')
    expect(selectRevealWipeForNode(effects, titleId, 2.5)?.start).toBe(2)
    // Overlapping marks: only the latest scheduled mark stays visible.
    expect(selectActiveMarks(effects, 1.5).map((effect) => effect.start)).toEqual([1])
    expect(selectActiveMarks(effects, 2.5).map((effect) => effect.start)).toEqual([2])
  })
})
