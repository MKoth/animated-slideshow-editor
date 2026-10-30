import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { parseScenarioMarkdown } from '../engine/scenarioMarkdown'
import { planScenarioDraft } from '../ai/scenarioPlanner'
import { applyBoardReapply, planBoardReapply } from '../ai/boardReapply'

const DOC = [
  '# Lesson',
  '',
  '## Step 1 — Greeting',
  '',
  '**Narrator:** First sentence here. Second sentence here.',
  '',
  '![Oak tree](asset:oak-tree)',
  '',
  '> Brief: A sturdy oak.',
  '',
  '[place: oak-tree]',
  '',
  '[reveal: text1]',
  '',
  'Greeting text.',
  '',
].join('\n')

function planStep() {
  const plan = planScenarioDraft(DOC, 0.1, [])
  expect(plan.blocked).toBe(false)
  const planSlide = plan.slides[0]!
  const step = parseScenarioMarkdown(DOC).steps.find((s) => s.index === planSlide.stepIndex)!
  expect(step).toBeDefined()
  return { planSlide, step }
}

describe('planBoardReapply', () => {
  it('rebuilds byte-identical source from estimate durations (first apply is a no-op rewrite)', () => {
    const { planSlide, step } = planStep()
    const estimates = planSlide.prompterParts.map((p) => p.duration)
    let cursor = 0
    const liveParts = estimates.map((duration) => {
      const part = { duration, startTime: cursor, endTime: cursor + duration }
      cursor += duration
      return part
    })
    const result = planBoardReapply({
      planSlide,
      step,
      liveParts,
      assetNameForPlaced: (slug) => slug,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.plan.source).toBe(planSlide.source)
    expect(result.plan.gapsCollapsed).toBe(false)
  })

  it('follows live TTS lengths: marks and effect anchors move, overs stay content-sized', () => {
    const { planSlide, step } = planStep()
    expect(planSlide.prompterParts.length).toBe(2)
    // TTS came back much shorter, unevenly: first block shrank a lot.
    const liveParts = [
      { duration: 0.5, startTime: 0, endTime: 0.5 },
      { duration: 2.0, startTime: 0.5, endTime: 2.5 },
    ]
    const result = planBoardReapply({
      planSlide,
      step,
      liveParts,
      assetNameForPlaced: (slug) => slug,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.plan.livePromptsEnd).toBeCloseTo(2.5)
    // The board choreography (5.5s) outruns the short voice: length follows
    // the board plus the 1s tail.
    expect(result.plan.boardCost).toBeCloseTo(5.5)
    expect(result.plan.slideDuration).toBeCloseTo(6.5)
    // Second block mark sits at its live start, not the estimate.
    expect(result.plan.source).toContain('at(0.5) mark("part-1")')
    expect(result.plan.source).not.toBe(planSlide.source)
  })

  it('redistributes planned prompt windows across a merged live prompt span', () => {
    const { planSlide, step } = planStep()
    const result = planBoardReapply({
      planSlide,
      step,
      liveParts: [{ duration: 10, startTime: 2, endTime: 12 }],
      assetNameForPlaced: (slug) => slug,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.plan.livePromptsEnd).toBe(12)
    const plannedSpan = planSlide.prompterParts.reduce((sum, part) => sum + part.duration, 0)
    const expectedSecondMark = 2 + (10 * planSlide.prompterParts[0]!.duration) / plannedSpan
    const markMatch = /at\(([\d.]+)\) mark\("part-1"\)/.exec(result.plan.source)
    expect(markMatch).not.toBeNull()
    expect(Number(markMatch![1])).toBeCloseTo(expectedSecondMark, 2)
  })

  it('redistributes planned prompt windows when live prompt blocks were split', () => {
    const { planSlide, step } = planStep()
    const result = planBoardReapply({
      planSlide,
      step,
      liveParts: [
        { duration: 2, startTime: 1, endTime: 3 },
        { duration: 4, startTime: 3, endTime: 7 },
        { duration: 6, startTime: 7, endTime: 13 },
      ],
      assetNameForPlaced: (slug) => slug,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.plan.timingRedistributed).toBe(true)
    expect(result.plan.source).toContain('at(1) mark("part-0")')
    expect(result.plan.livePromptsEnd).toBe(13)
  })
})

describe('applyBoardReapply', () => {
  function setupEngine() {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    return {
      engine,
      undoStack,
      system: {
        dispatcher: { dispatch: dispatcher.dispatch.bind(dispatcher) },
        undoStack,
      },
      slideId: slide.id,
      dispatcher,
    }
  }

  it('writes source + length in one entry then runs the rebuilt source', async () => {
    const { planSlide, step } = planStep()
    expect(planSlide.prompterParts.length).toBe(2)
    const { engine, undoStack, system, slideId } = setupEngine()
    const planned = planBoardReapply({
      planSlide,
      step,
      liveParts: [
        { duration: 1.0, startTime: 0, endTime: 1.0 },
        { duration: 2.0, startTime: 1.0, endTime: 3.0 },
      ],
      assetNameForPlaced: (slug) => slug,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) throw new Error('unreachable')
    const calls: { slideId: string; source: string }[] = []
    const result = await applyBoardReapply(system, engine, slideId, planned.plan, (id, source) => {
      calls.push({ slideId: id, source })
      return { ran: true, error: null }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.runRan).toBe(true)
    expect(result.slideDuration).toBeCloseTo(6.5)
    expect(engine.getSlide(slideId).animationScript?.source).toBe(planned.plan.source)
    expect(engine.getSlide(slideId).duration).toBeCloseTo(6.5)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ slideId })
    expect(calls[0]!.source).toBe(planned.plan.source)
    expect(undoStack.entries.length).toBe(1)
  })

  it('keeps source + length applied when the re-run fails, and says so', async () => {
    const { planSlide, step } = planStep()
    const { engine, system, slideId } = setupEngine()
    const planned = planBoardReapply({
      planSlide,
      step,
      liveParts: [
        { duration: 1.0, startTime: 0, endTime: 1.0 },
        { duration: 2.0, startTime: 1.0, endTime: 3.0 },
      ],
      assetNameForPlaced: (slug) => slug,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) throw new Error('unreachable')
    const result = await applyBoardReapply(system, engine, slideId, planned.plan, () => ({
      ran: false,
      error: 'boom',
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.runRan).toBe(false)
    expect(result.runError).toBe('boom')
    expect(engine.getSlide(slideId).animationScript?.source).toBe(planned.plan.source)
  })
})
