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
    // Split like manual paste: delimiters stripped, so single-sentence
    // narrators lose their trailing period for duration math.
    expect(result.slides[0]?.prompterParts).toHaveLength(1)
    expect(result.slides[0]?.prompterParts[0]?.text).toBe('Ser is for who you are')
    expect(result.slides[0]?.prompterParts[0]?.promptBlockId).toBe('prompt-1-1')
    expect(result.slides[0]?.prompterParts[0]?.markName).toBe('part-0')
    expect(result.slides[0]?.duration).toBeCloseTo('Ser is for who you are'.length * 0.1)
    expect(result.slides[1]?.duration).toBeCloseTo('Estar is for where you are'.length * 0.1)
    // Slide length stays the sum of parts.
    for (const slide of result.slides) {
      const sum = slide.prompterParts.reduce((total, part) => total + part.duration, 0)
      expect(slide.duration).toBeCloseTo(sum, 9)
      expect(slide.duration).toBeCloseTo(slide.prompterDuration, 9)
    }
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

describe('Scenario planner tables, teardown, overflow, fractions (issue #470)', () => {
  const TABLE_DOC = [
    '# Lesson',
    '',
    '## Step 1 — Table',
    '',
    '**Narrator:** A long enough narrator line to cover the board work here today.',
    '',
    '| Spanish | English |',
    '| --- | --- |',
    '| Soy | I am |',
    '| Eres | You are |',
    '',
    '[reveal: table1]',
    '',
  ].join('\n')

  it('costs short cells 1s, long cells 2s, border fixed, mask setup free', () => {
    const result = planScenarioDraft(TABLE_DOC, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    // Cells: Spanish(7)→2, English(7)→2, Soy(3)→1, I am(4)→1,
    // Eres(4)→1, You are(7)→2 = 9 + border 1 = 10s.
    expect(slide?.boardCost).toBeCloseTo(10, 6)
    expect(slide?.source).toContain('create table "table1"')
    expect(slide?.source).toContain('reveal(table1')
    // Border is a fixed budget inside the table reveal, not a separate action.
    expect(slide?.fractions.filter((f) => f.action.startsWith('reveal('))).toHaveLength(1)
    // Invisible mask-setup wipes are free and uncounted: none emitted.
    expect(slide?.source).not.toMatch(/wipe\(.*visual:\s*none/)
    // The table reveal carries the full honest budget.
    expect(slide?.source).toMatch(/reveal\(table1, over: 10/)
  })

  it('expands full wipe in reverse kind-matched order; targeted only listed ids; marks need no removal', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Mixed',
      '',
      '**Narrator:** A narrator line long enough to cover every board effect evenly today.',
      '',
      '![Oak tree](asset:oak-tree)',
      '',
      '> Brief: A sturdy oak.',
      '',
      '> Label: El roble',
      '',
      '[place: oak-tree]',
      '',
      '[reveal: text1]',
      '',
      'Chalk words here.',
      '',
      '[mark: text1]',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    const actions = slide?.fractions.map((f) => f.action) ?? []
    // Appearance: carry(oaktree), reveal(label), reveal(text1), mark(text1 alias),
    // then full wipe reverses: wipe(text1), wipe(label), carry-away(oaktree).
    expect(actions.filter((a) => a.startsWith('carry('))).toHaveLength(2)
    expect(actions.filter((a) => a.startsWith('reveal('))).toHaveLength(2)
    expect(actions.filter((a) => a.startsWith('mark('))).toHaveLength(1)
    expect(actions.filter((a) => a.startsWith('wipe('))).toHaveLength(2)
    // Marks are overlays: no wipe/mark removal for the mark itself.
    const markIndex = actions.findIndex((a) => a.startsWith('mark('))
    const wipeIndices = actions
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.startsWith('wipe('))
      .map(({ i }) => i)
    expect(markIndex).toBeGreaterThan(-1)
    // Full wipe reverses appearance: last revealed wiped first.
    expect(wipeIndices[0]).toBeGreaterThan(markIndex)

    // Targeted removals expand only listed ids.
    const targeted = [
      '# Lesson',
      '',
      '## Step 1 — Targeted',
      '',
      '**Narrator:** A narrator line long enough to cover the targeted teardown path today.',
      '',
      '![Oak tree](asset:oak-tree)',
      '',
      '> Brief: A sturdy oak.',
      '',
      '[place: oak-tree]',
      '',
      '[reveal: text1]',
      '',
      'Chalk words here.',
      '',
      '[remove: text1]',
      '',
    ].join('\n')
    const tResult = planScenarioDraft(targeted, 0.1, [])
    const tActions = tResult.slides[0]?.fractions.map((f) => f.action) ?? []
    // One carry-in, one reveal, one wipe (text1 only) — the carried oak stays.
    expect(tActions.filter((a) => a.startsWith('carry('))).toHaveLength(1)
    expect(tActions.filter((a) => a.startsWith('wipe('))).toHaveLength(1)
    expect(tResult.blocked).toBe(false)
  })

  it('pads the owning prompter part on overflow while slide length stays the sum of parts', () => {
    // Tiny narrator ("Hi" after `!` stripped → 0.2s) with a 2x2 table needing 5s+.
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Overflow',
      '',
      '**Narrator:** Hi!',
      '',
      '| A | B |',
      '| --- | --- |',
      '| C | D |',
      '',
      '[reveal: table1]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    // 4 cells × 1s + border 1s = 5s > 0.2s narrator ("Hi" without `!`).
    expect(slide?.prompterDuration).toBeCloseTo(0.2, 6)
    expect(slide?.boardCost).toBeCloseTo(5, 6)
    expect(slide?.padded).toBe(true)
    expect(slide?.duration).toBeCloseTo(5, 6)
    // Slide length stays the sum of parts: padded total equals the parts sum.
    expect(slide?.duration).toBe(slide?.boardCost)
    const partsSum = (slide?.prompterParts ?? []).reduce((sum, part) => sum + part.duration, 0)
    expect(slide?.duration).toBeCloseTo(partsSum, 9)
    const paddedDiag = result.diagnostics.find((d) => d.code === 'overflow-padded')
    expect(paddedDiag?.severity).toBe('warning')
    expect(paddedDiag?.step).toBe(1)
    expect(result.blocked).toBe(false)
  })

  it('does not misclassify tableau-style text ids as tables', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Almost a table',
      '',
      '**Narrator:** A narrator line long enough to cover the board work here today.',
      '',
      '| A | B |',
      '| --- | --- |',
      '| C | D |',
      '',
      '[reveal: tableau1]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const slide = result.slides[0]
    // The grid auto-reveals as a table; tableau1 falls back to a text reveal.
    expect(slide?.source).toContain('create table')
    expect(slide?.source).toContain('create text "tableau1"')
    expect(result.blocked).toBe(false)
  })

  it('emits per-action block fractions on the owning prompt block', () => {
    const result = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    for (const slide of result.slides) {
      expect(slide.fractions.length).toBeGreaterThan(0)
      const ownedBlocks = new Set(slide.prompterParts.map((part) => part.promptBlockId))
      for (const fraction of slide.fractions) {
        // Each action ties to its owning split block (`prompt-N-M`).
        expect(ownedBlocks.has(fraction.block)).toBe(true)
        expect(fraction.fraction).toBeGreaterThan(0)
        expect(fraction.fraction).toBeLessThanOrEqual(1)
      }
      // Fractions ascend in script order (midpoints of sequential windows).
      const values = slide.fractions.map((f) => f.fraction)
      const sorted = [...values].sort((a, b) => a - b)
      expect(values).toEqual(sorted)
    }
    // No absolute time placements in any source.
    for (const slide of result.slides) {
      expect(slide.source).not.toMatch(/\bat\s*:/)
    }
  })
})
