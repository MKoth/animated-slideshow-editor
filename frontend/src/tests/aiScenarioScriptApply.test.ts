import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { planScenarioDraft } from '../ai/scenarioPlanner'
import { applyScenarioScript, buildScenarioScriptApplyCommands } from '../ai/scenarioScriptApply'

const TWO_STEP_DOC = [
  '# Ser and Estar',
  '',
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Oak tree](asset:oak-tree)',
  '',
  '> Brief: A sturdy oak.',
  '',
  '[place: oak-tree]',
  '',
  '[reveal: text1]',
  '',
  'Ser is identity.',
  '',
  '## Step 2 — Where you are',
  '',
  '**Narrator:** Estar is for where you are.',
  '',
  '![Melting ice](asset:melting-ice)',
  '',
  '> Brief: Melting ice cube.',
  '',
  '[place: melting-ice]',
  '',
  '[reveal: text2]',
  '',
  'Estar is temporary.',
  '',
].join('\n')

function setupEngine() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  engine.createProject({ name: 'P' })
  const system = { dispatcher, undoStack, engine }
  return { engine, undoStack, dispatcher, system }
}

function snapshotSlides(engine: ReturnType<typeof createEngineInternal>) {
  return (engine.project?.slides ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    partIds: s.prompter?.parts.map((p) => p.id) ?? [],
  }))
}

describe('Scenario script apply builder (issue #471)', () => {
  it('renames positional keeps and rewrites content without creates or deletes', () => {
    const plan = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    const { commands, targetSlideIds } = buildScenarioScriptApplyCommands({
      plan,
      existingSlides: [
        { id: 's1', name: 'Old name', partIds: ['p1'] },
        { id: 's2', name: plan.slides[1]!.slideName, partIds: [] },
      ],
    })
    expect(targetSlideIds).toEqual(['s1', 's2'])
    const types = commands.map((c) => c.type)
    expect(types.filter((t) => t === 'RenameSlide')).toHaveLength(1)
    expect(types).not.toContain('CreateSlide')
    expect(types).not.toContain('DeleteSlide')
    // Per slide: rename? + delete parts + create part + duration + script.
    expect(types.filter((t) => t === 'DeletePrompterPart')).toHaveLength(1)
    expect(types.filter((t) => t === 'CreatePrompterPart')).toHaveLength(2)
    expect(types.filter((t) => t === 'SetSlideDuration')).toHaveLength(2)
    expect(types.filter((t) => t === 'SetSlideAnimationScript')).toHaveLength(2)
  })

  it('deletes surplus slides last-to-first and creates missing slides with pre-generated ids', () => {
    const plan = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    const shrink = buildScenarioScriptApplyCommands({
      plan,
      existingSlides: [
        { id: 's1', name: plan.slides[0]!.slideName, partIds: [] },
        { id: 's2', name: plan.slides[1]!.slideName, partIds: [] },
        { id: 'extra', name: 'Extra', partIds: [] },
      ],
    })
    const shrinkDeletes = shrink.commands.filter((c) => c.type === 'DeleteSlide')
    expect(shrinkDeletes).toHaveLength(1)
    expect(shrinkDeletes[0]!.parameters).toMatchObject({ slideId: 'extra' })
    expect(shrink.targetSlideIds).toEqual(['s1', 's2'])

    const grown = buildScenarioScriptApplyCommands({
      plan,
      existingSlides: [{ id: 'only', name: plan.slides[0]!.slideName, partIds: [] }],
    })
    const creates = grown.commands.filter((c) => c.type === 'CreateSlide')
    expect(creates).toHaveLength(1)
    const createdId = creates[0]!.parameters.slideId as string
    expect(typeof createdId).toBe('string')
    expect(createdId).not.toBe('')
    expect(grown.targetSlideIds).toEqual(['only', createdId])
    // The created slide is configured in the same command list.
    const createIndex = grown.commands.findIndex((c) => c.type === 'CreateSlide')
    const scriptIndex = grown.commands.findIndex(
      (c) => c.type === 'SetSlideAnimationScript' && c.parameters.slideId === createdId,
    )
    expect(scriptIndex).toBeGreaterThan(createIndex)
  })
})

describe('Scenario script apply execution (issue #471)', () => {
  it('converges slides, prompter, duration, and script in one Transaction; re-runs converge', () => {
    const { engine, undoStack, system } = setupEngine()
    const first = engine.createSlide('Old A')
    engine.createSlide('Old B')
    // Stale voice link on the first slide: linked clip must be dropped.
    engine.createPrompterPart(first.id, { id: 'stale-part', text: 'Old text', duration: 2 })
    const clip = engine.createAudioClip(first.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    const staleSlide = engine.getSlide(first.id)
    staleSlide.prompter!.parts[0]!.audioClipId = clip.id
    staleSlide.prompter!.parts[0]!.audioAssetId = 'a1'

    const plan = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    expect(plan.blocked).toBe(false)
    const before = undoStack.entries.length
    const result = applyScenarioScript(system, { plan, existingSlides: snapshotSlides(engine) })
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()

    // One Transaction, one History entry.
    expect(undoStack.entries.length).toBe(before + 1)
    expect(undoStack.entries[0]!.type).toBe('Transaction')

    const slides = engine.project!.slides
    expect(slides).toHaveLength(2)
    expect(slides.map((s) => s.name)).toEqual(plan.slides.map((s) => s.slideName))
    for (let i = 0; i < slides.length; i += 1) {
      const slide = slides[i]!
      const draft = plan.slides[i]!
      // Split parts, no stale audio links.
      expect(slide.prompter?.parts).toHaveLength(draft.prompterParts.length)
      expect(slide.prompter!.parts.map((p) => p.text)).toEqual(
        draft.prompterParts.map((p) => p.text),
      )
      for (const part of slide.prompter!.parts) {
        expect(part.audioClipId).toBeUndefined()
        expect(part.audioAssetId).toBeUndefined()
      }
      // Slide length covers the voice (sum of parts) and pads past it when
      // the absolute board choreography outruns the narration.
      const partsSum = slide.prompter!.parts.reduce((sum, p) => sum + p.duration, 0)
      expect(partsSum).toBeCloseTo(draft.prompterDuration, 9)
      expect(slide.duration).toBeCloseTo(draft.duration, 9)
      expect(slide.duration).toBeGreaterThanOrEqual(partsSum - 1e-9)
      // Board script written verbatim.
      expect(slide.animationScript?.source).toBe(draft.source)
    }
    // Stale linked voice clip dropped with its part.
    expect(engine.getSlide(slides[0]!.id).audio.clips).toHaveLength(0)

    // Re-run converges without duplicates: same ids, same count.
    const rerunExisting = snapshotSlides(engine)
    const second = applyScenarioScript(system, { plan, existingSlides: rerunExisting })
    expect(second.ok).toBe(true)
    expect(second.targetSlideIds).toEqual(rerunExisting.map((s) => s.id))
    expect(engine.project!.slides).toHaveLength(2)
    expect(engine.project!.slides.map((s) => s.id)).toEqual(rerunExisting.map((s) => s.id))
    expect(undoStack.entries.length).toBe(before + 2)
    expect(undoStack.entries[0]!.type).toBe('Transaction')
  })

  it('undo restores names, parts, audio links, and scripts', () => {
    const { engine, undoStack, dispatcher, system } = setupEngine()
    const slide = engine.createSlide('Keep me')
    engine.createPrompterPart(slide.id, { id: 'orig-part', text: 'Original', duration: 1 })
    const clip = engine.createAudioClip(slide.id, {
      assetId: 'a9',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
    })
    engine.getSlide(slide.id).prompter!.parts[0]!.audioClipId = clip.id
    engine.getSlide(slide.id).prompter!.parts[0]!.audioAssetId = 'a9'

    const plan = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    // One existing slide, two desired: one keep + one create.
    const applied = applyScenarioScript(system, { plan, existingSlides: snapshotSlides(engine) })
    expect(applied.ok).toBe(true)
    expect(engine.project!.slides).toHaveLength(2)

    expect(dispatcher.undo()).toBe(true)
    expect(undoStack.canUndo).toBe(false)
    const restored = engine.project!.slides
    expect(restored).toHaveLength(1)
    expect(restored[0]!.name).toBe('Keep me')
    expect(restored[0]!.prompter?.parts).toHaveLength(1)
    expect(restored[0]!.prompter!.parts[0]!.id).toBe('orig-part')
    expect(restored[0]!.prompter!.parts[0]!.text).toBe('Original')
    expect(restored[0]!.prompter!.parts[0]!.audioClipId).toBe(clip.id)
    expect(restored[0]!.audio.clips.map((c) => c.id)).toContain(clip.id)
    expect(restored[0]!.animationScript).toBeNull()

    // Redo restores the applied draft with the same slide ids.
    expect(dispatcher.redo()).toBe(true)
    expect(engine.project!.slides).toHaveLength(2)
    expect(engine.project!.slides.map((s) => s.id)).toEqual(applied.targetSlideIds)
  })

  it('refuses blocked plans and empty plans without dispatching', () => {
    const { engine, undoStack, system } = setupEngine()
    engine.createSlide('S1')
    const blockedDoc = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Hi there.',
      '',
      '[dance: oak-tree]',
      '',
    ].join('\n')
    const blocked = planScenarioDraft(blockedDoc, 0.1, [])
    expect(blocked.blocked).toBe(true)
    const refused = applyScenarioScript(system, {
      plan: blocked,
      existingSlides: snapshotSlides(engine),
    })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/blocking errors/i)

    const empty = planScenarioDraft('# Title only', 0.1, [])
    expect(empty.slides).toHaveLength(0)
    const emptyResult = applyScenarioScript(system, {
      plan: empty,
      existingSlides: snapshotSlides(engine),
    })
    expect(emptyResult.ok).toBe(false)
    expect(emptyResult.error).toMatch(/no slides/i)

    expect(undoStack.entries.length).toBe(0)
    expect(engine.project!.slides).toHaveLength(1)
  })
})
