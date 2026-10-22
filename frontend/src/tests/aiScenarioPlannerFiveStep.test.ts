import { describe, expect, it } from 'vitest'
import { CreateProjectCommand, CreateSlideCommand, createCommandSystem } from '../engine/commands'
import { checkAnimationScript } from '../engine/animationScriptCheck'
import { parseAnimationScript } from '../engine/animationScriptParser'
import { planScenarioDraft } from '../ai/scenarioPlanner'

const CHALK_PARAMETERS = [
  { key: 'tint', kind: 'color', default: '#ffffff' },
  { key: 'opacityMultiplier', kind: 'number', default: 1 },
  { key: 'uGrain', kind: 'float', default: 0.65 },
] as const

/** Five-step Ser-and-Estar reference lesson covering carry, tables, labels, marks, targeted + full teardown. */
const FIVE_STEP_DOC = [
  '# Ser and Estar',
  '',
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are, identity that stays true through every single day.',
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
  '## Step 2 — Table',
  '',
  '**Narrator:** These two little words pair up in a tidy grid you can read at a glance today.',
  '',
  '| A | B |',
  '| --- | --- |',
  '| C | D |',
  '',
  '[reveal: table1]',
  '',
  '## Step 3 — Where you are',
  '',
  '**Narrator:** Estar is for where you are, a temporary place that changes with the day today.',
  '',
  '![Melting ice](asset:melting-ice)',
  '',
  '> Brief: Melting ice cube.',
  '',
  '> Label: Esta aqui',
  '',
  '[place: melting-ice]',
  '',
  '[reveal: text3]',
  '',
  'Estar is temporary.',
  '',
  '[mark: text3]',
  '',
  '## Step 4 — Partial',
  '',
  '**Narrator:** We take down one chalk line and keep the tree standing for the next beat today.',
  '',
  '![Dry tree](asset:dry-tree)',
  '',
  '> Brief: A dry tree.',
  '',
  '[place: dry-tree]',
  '',
  '[reveal: text4]',
  '',
  'One line to remove.',
  '',
  '[remove: text4]',
  '',
  '## Step 5 — Clean board',
  '',
  '**Narrator:** We clear the whole board together and close the lesson with clean chalk today.',
  '',
  '![Green tree](asset:green-tree)',
  '',
  '> Brief: A green tree.',
  '',
  '[place: green-tree]',
  '',
  '[reveal: text5]',
  '',
  'Final words here.',
  '',
  '[wipe]',
  '',
].join('\n')

describe('Scenario planner five-step reference lesson (issue #470)', () => {
  it('produces five slides with strict identity and no blocking errors', () => {
    const result = planScenarioDraft(FIVE_STEP_DOC, 0.1, [])
    expect(result.slides).toHaveLength(5)
    expect(result.slides.map((s) => s.stepIndex)).toEqual([1, 2, 3, 4, 5])
    expect(result.blocked).toBe(false)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    // No overflow in the reference lesson: narrators cover honest budgets.
    expect(result.slides.every((s) => !s.padded)).toBe(true)
  })

  it('produces checker-clean sequential sources with per-action block fractions', () => {
    const result = planScenarioDraft(FIVE_STEP_DOC, 0.1, [])
    const audioAssets = [
      { id: 'w', name: 'writing-on-black-board', duration: 0.4 },
      { id: 'e', name: 'dry-erase', duration: 0.4 },
    ]
    for (const slide of result.slides) {
      // Purely sequential: no absolute time placements.
      expect(slide.source).not.toMatch(/\bat\s*:/)
      expect(slide.source).toContain('mark("part-0")')
      // Parse-clean.
      const parsed = parseAnimationScript(slide.source)
      expect(parsed.diagnostics).toEqual([])
      // Every action tied to the owning prompt block with a fraction.
      expect(slide.fractions.length).toBeGreaterThan(0)
      for (const fraction of slide.fractions) {
        expect(fraction.block).toBe(slide.promptBlockId)
        expect(fraction.fraction).toBeGreaterThan(0)
        expect(fraction.fraction).toBeLessThanOrEqual(1)
      }
      // Check-clean in a minimal engine with Chalk, paws, placed art, audio.
      const system = createCommandSystem(() => {})
      const project = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
      if (!project.ok) throw new Error('no project')
      const created = system.dispatcher.dispatch(new CreateSlideCommand({ name: slide.slideName }))
      if (!created.ok) throw created.error
      const slideId = (created.inverse as { slideId: string }).slideId
      system.materialLibrarySync.apply([
        {
          id: 'mat-chalk',
          name: 'Chalk',
          parameters: [...CHALK_PARAMETERS],
          shader_id: 'shader-chalk',
        },
      ])
      system.assetLibrarySync.apply([
        { id: 'paw-chalk', name: 'paw with chalk' },
        { id: 'paw-rag', name: 'paw with rag' },
        { id: 'paw-empty', name: 'paw empty' },
        { id: 'art-oak', name: 'oak-tree' },
        { id: 'art-ice', name: 'melting-ice' },
        { id: 'art-dry', name: 'dry-tree' },
        { id: 'art-green', name: 'green-tree' },
      ])
      system.engine.getSlide(slideId).duration = slide.duration
      const checked = checkAnimationScript(system.engine, slideId, slide.source, {
        globalAudioAssets: audioAssets,
      })
      const errors = checked.diagnostics.filter((d) => d.severity === 'error')
      expect(errors).toEqual([])
      expect(checked.runnable).toBe(true)
    }
  })
})
