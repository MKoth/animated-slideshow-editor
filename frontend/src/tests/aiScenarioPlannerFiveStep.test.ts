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
    // Voice parts stay estimate-sized; padded slides extend past the voice
    // only when the absolute board choreography needs more time.
    for (const slide of result.slides) {
      const voice = slide.prompterParts.reduce((sum, part) => sum + part.duration, 0)
      expect(voice).toBeCloseTo(slide.prompterDuration, 9)
      expect(slide.duration).toBeGreaterThanOrEqual(voice - 1e-9)
      expect(slide.duration).toBeCloseTo(slide.boardCost, 9)
      expect(slide.padded).toBe(slide.boardCost > slide.prompterDuration + 1e-9)
    }
  })

  it('produces checker-clean absolute sources with per-action block fractions', () => {
    const result = planScenarioDraft(FIVE_STEP_DOC, 0.1, [])
    const audioAssets = [
      { id: 'w', name: 'writing-on-black-board', duration: 0.4 },
      { id: 'e', name: 'dry-erase', duration: 0.4 },
    ]
    for (const slide of result.slides) {
      // Absolute `at:` anchors reference the owning prompt block; overs stay
      // short and content-sized like the fixture.
      expect(slide.source).toMatch(/at: markTime\("part-\d+"\)/)
      expect(slide.source).toContain('mark("part-0")')
      for (const over of [...slide.source.matchAll(/over: ([\d.]+)/g)].map((m) => Number(m[1]))) {
        expect(over).toBeLessThanOrEqual(4.0 + 1e-9)
      }
      // Split narrators keep sentence-level blocks with sub-block ids.
      expect(slide.prompterParts.length).toBeGreaterThan(0)
      const ownedBlocks = new Set(slide.prompterParts.map((part) => part.promptBlockId))
      // Parse-clean.
      const parsed = parseAnimationScript(slide.source)
      expect(parsed.diagnostics).toEqual([])
      // Every action tied to the owning prompt block with a fraction.
      expect(slide.fractions.length).toBeGreaterThan(0)
      for (const fraction of slide.fractions) {
        expect(ownedBlocks.has(fraction.block)).toBe(true)
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
        { id: 'bg-board', name: 'blackboar-background' },
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
