import { describe, expect, it } from 'vitest'
import { planScenarioDraft } from '../ai/scenarioPlanner'

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

describe('Scenario planner core (issue #469)', () => {
  it('yields one slide per non-table step with strict identity', () => {
    const result = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    expect(result.slides).toHaveLength(2)
    expect(result.slides[0]?.slideName).toBe('Step 1 — Who you are')
    expect(result.slides[1]?.slideName).toBe('Step 2 — Where you are')
    expect(result.slides[0]?.stepIndex).toBe(1)
    expect(result.slides[1]?.stepIndex).toBe(2)
    expect(result.ops.creates).toHaveLength(2)
    expect(result.ops.deletes).toHaveLength(0)
    expect(result.ops.renames).toHaveLength(0)
  })

  it('is idempotent: re-runs converge without duplicates, renames match', () => {
    const first = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    // Simulate applied state: middles now match desired names.
    const existing = first.slides.map((s, i) => ({ id: `slide-${i}`, name: s.slideName }))
    const second = planScenarioDraft(TWO_STEP_DOC, 0.1, existing)
    expect(second.ops.creates).toHaveLength(0)
    expect(second.ops.deletes).toHaveLength(0)
    expect(second.ops.renames).toHaveLength(0)
    expect(second.slides.map((s) => s.slideName)).toEqual(first.slides.map((s) => s.slideName))

    // Rename convergence: stale names get renamed, not duplicated.
    const stale = [
      { id: 'a', name: 'Old name' },
      { id: 'b', name: 'Step 2 — Where you are' },
    ]
    const renamed = planScenarioDraft(TWO_STEP_DOC, 0.1, stale)
    expect(renamed.ops.creates).toHaveLength(0)
    expect(renamed.ops.deletes).toHaveLength(0)
    expect(renamed.ops.renames).toEqual([{ id: 'a', from: 'Old name', to: 'Step 1 — Who you are' }])
  })

  it('converges inserts and deletes positionally, leaving intro/outro to the caller', () => {
    const three = planScenarioDraft(TWO_STEP_DOC, 0.1, [
      { id: 'x', name: 'Step 1 — Who you are' },
      { id: 'y', name: 'Middle extra' },
      { id: 'z', name: 'Step 2 — Where you are' },
    ])
    // Positional: existing[1] renamed to Step 2, existing[2] deleted, plus one create? No —
    // desired is 2 slides: keep x, rename y to Step 2, delete z.
    expect(three.ops.keeps).toHaveLength(2)
    expect(three.ops.deletes).toHaveLength(1)

    const grown = planScenarioDraft(TWO_STEP_DOC, 0.1, [
      { id: 'only', name: 'Step 1 — Who you are' },
    ])
    expect(grown.ops.creates).toHaveLength(1)
    expect(grown.ops.deletes).toHaveLength(0)
  })

  it('gives each slide its step narrator verbatim with duration from length times secondsPerCharacter', () => {
    const result = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    expect(result.slides[0]?.prompterText).toBe('Ser is for who you are.')
    expect(result.slides[1]?.prompterText).toBe('Estar is for where you are.')
    expect(result.slides[0]?.duration).toBeCloseTo('Ser is for who you are.'.length * 0.1)
    expect(result.slides[1]?.duration).toBeCloseTo('Estar is for where you are.'.length * 0.1)
  })

  it('board sources reuse backdrop, park performers, keep names verbatim, no absolute times', () => {
    const result = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    for (const slide of result.slides) {
      // Backdrop reuse: single board group per slide.
      expect(slide.source).toContain('create group "Board" as board')
      // Parked performers off-screen.
      expect(slide.source).toMatch(/at\s*\(\s*1500\s*,\s*1200\s*\)/)
      // Verbatim scenario names.
      // (Slide 1 carries oak-tree, slide 2 carries melting-ice.)
      // No absolute time placements: no `at:` time args, only sequential `over:`.
      expect(slide.source).not.toMatch(/\bat\s*:/)
      expect(slide.source).toContain('mark("part-0")')
      expect(slide.source).toMatch(/^script "Step \d+ — /m)
      expect(slide.source).toContain('from 0')
    }
    expect(result.slides[0]?.source).toContain('"oak-tree"')
    expect(result.slides[1]?.source).toContain('"melting-ice"')
    // Reveal ids verbatim.
    expect(result.slides[0]?.source).toContain('text1')
    expect(result.slides[1]?.source).toContain('text2')
  })

  it('reports unknown verbs and dangling references as blocking diagnostics', () => {
    const unknownVerb = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Hi there.',
      '',
      '[dance: oak-tree]',
      '',
    ].join('\n')
    const unknown = planScenarioDraft(unknownVerb, 0.1, [])
    expect(
      unknown.diagnostics.some((d) => d.severity === 'error' && /dance/i.test(d.message)),
    ).toBe(true)
    expect(unknown.blocked).toBe(true)

    const danglingPlace = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Hi there.',
      '',
      '[place: ghost-tree]',
      '',
    ].join('\n')
    const dangling = planScenarioDraft(danglingPlace, 0.1, [])
    expect(
      dangling.diagnostics.some((d) => d.severity === 'error' && /ghost-tree/.test(d.message)),
    ).toBe(true)
    expect(dangling.blocked).toBe(true)

    const danglingRemove = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Hi there.',
      '',
      '[remove: ghost-text]',
      '',
    ].join('\n')
    const removed = planScenarioDraft(danglingRemove, 0.1, [])
    expect(removed.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    expect(removed.blocked).toBe(true)

    // Clean doc is not blocked.
    const clean = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    expect(clean.blocked).toBe(false)
    expect(clean.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
  })
})
