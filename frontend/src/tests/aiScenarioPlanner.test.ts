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
    // Voice sizes from length; the slide pads past the voice when the
    // fixture-paced board (carry + title + gaps) outruns the narration.
    for (const slide of result.slides) {
      const sum = slide.prompterParts.reduce((total, part) => total + part.duration, 0)
      expect(sum).toBeCloseTo(slide.prompterDuration, 9)
      expect(slide.duration).toBeGreaterThanOrEqual(slide.prompterDuration - 1e-9)
      expect(slide.duration).toBeCloseTo(slide.boardCost, 9)
    }
    // The fixture-paced board (title + carry + approach flights) outruns the
    // 2.2s voice, so the slide pads past it. Space-between per block: the
    // carry (span 2.3) starts at board end − round(2.3), plus a 1s tail, so
    // the slide runs to 5.7s with the last action ending 1s before the end.
    expect(result.slides[0]?.padded).toBe(true)
    expect(result.slides[0]?.duration).toBeCloseTo(5.7, 9)
  })

  it('board sources reuse backdrop, park performers, keep names verbatim, anchored absolute times', () => {
    const result = planScenarioDraft(TWO_STEP_DOC, 0.1, [])
    for (const slide of result.slides) {
      // Backdrop reuse: single board group per slide, lesson backdrop first.
      expect(slide.source).toContain('create group "Board" as board')
      expect(slide.source).toContain('create asset "blackboar-background" as background')
      // Parked performers off-screen.
      expect(slide.source).toMatch(/at\s*\(\s*1500\s*,\s*1200\s*\)/)
      // Verbatim scenario names.
      // (Slide 1 carries oak-tree, slide 2 carries melting-ice.)
      // Absolute `at:` anchors reference the owning prompt block so voice
      // retiming shifts the board; overs stay short and content-sized.
      expect(slide.source).toMatch(/at: markTime\("part-\d+"\)/)
      expect(slide.source).toMatch(/visualAnchor: "top-center"/)
      expect(slide.source).toContain('mark("part-0")')
      expect(slide.source).toMatch(/^script "Step \d+ — /m)
      expect(slide.source).toContain('from 0')
      for (const over of [...slide.source.matchAll(/over: ([\d.]+)/g)].map((m) => Number(m[1]))) {
        expect(over).toBeLessThanOrEqual(4.0 + 1e-9)
      }
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

  it('reveals the table border alone before chained cell-text reveals', () => {
    const result = planScenarioDraft(TABLE_DOC, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    expect(slide?.source).toContain('create table "table1"')
    // Empty cells plus per-cell text (fixture style): the border draws first.
    expect(slide?.source).toContain('rows: [["", ""], ["", ""], ["", ""]]')
    expect(slide?.source).toContain('inside table1.cell(0, 0)')
    expect(slide?.source).toMatch(
      /reveal\(nodeOnly\(table1\), at: markTime\("part-0"\), over: 1\.2/,
    )
    // Border wobble scales with row count (3 rows → 1.5x the {8-18} base);
    // cells scale with their text.
    expect(slide?.source).toMatch(/reveal\(nodeOnly\(table1\),.*wobbleY: \{ from: 12, to: 27 \}/)
    expect(slide?.source).toMatch(/reveal\(table1c00,.*over: 0\.7,.*sound: writeSfx\)/)
    expect(slide?.source).toMatch(/reveal\(table1c10,.*over: 0\.4,.*sound: writeSfx\)/)
    // Each cell's reveal mask keeps it hidden until its narration-timed sweep;
    // no table-wide border effect or setup wipe pre-reveals its text.
    expect(slide?.source).not.toContain('wipe(table1c00')
    // Chained order: table-only border, then individual cells.
    const actions = slide?.fractions.map((f) => f.action) ?? []
    expect(actions.filter((a) => a.startsWith('reveal('))).toHaveLength(7)
    expect(actions.filter((a) => a.startsWith('wipe('))).toHaveLength(0)
    expect(actions[0]).toBe('reveal(nodeOnly(table1))')
    expect(actions[1]).toBe('reveal(table1c00)')
    // Overs stay short and content-sized.
    for (const over of [...(slide?.source ?? '').matchAll(/over: ([\d.]+)/g)].map((m) =>
      Number(m[1]),
    )) {
      expect(over).toBeLessThanOrEqual(4.0 + 1e-9)
    }
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
    // Fixture order: title, carry(oaktree), reveal(label), mark(text1 alias),
    // then kind-grouped teardown: wipe(label), carry-away(oaktree), wipe(title).
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
    // Teardown runs after every build effect.
    expect(wipeIndices[0]).toBeGreaterThan(markIndex)
    // Title opens the choreography; the title wipe closes it.
    expect(actions[0]).toBe('reveal(text1)')
    expect(actions[actions.length - 1]).toBe('wipe(text1)')

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

  it('pads the slide past the voice when the board outruns the narrator', () => {
    // Tiny narrator ("Hi" after `!` stripped → 0.2s) with a 2x2 table: border
    // 1.2s plus chained mask/cell sweeps and gaps need several seconds.
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
    expect(slide?.prompterDuration).toBeCloseTo(0.2, 6)
    // Parts stay voice-sized; the slide extends to the board end instead.
    const partsSum = (slide?.prompterParts ?? []).reduce((sum, part) => sum + part.duration, 0)
    expect(partsSum).toBeCloseTo(0.2, 6)
    expect(slide?.padded).toBe(true)
    expect(slide?.duration).toBeGreaterThan(0.2)
    expect(slide?.duration).toBeCloseTo(slide?.boardCost ?? 0, 9)
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
      // Fractions ascend in script order (midpoints of board windows).
      const values = slide.fractions.map((f) => f.fraction)
      const sorted = [...values].sort((a, b) => a - b)
      expect(values).toEqual(sorted)
    }
    // Absolute `at:` anchors reference the owning prompt block symbolically.
    for (const slide of result.slides) {
      expect(slide.source).toMatch(/at: markTime\("part-\d+"\)/)
    }
  })
})

describe('Scenario planner space-between board timing', () => {
  const TWO_EFFECT_DOC = [
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
  ].join('\n')

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

  /** `at:` placements in script order: owning part, in-window offset, overs/spans, raw lines. */
  function placements(
    source: string,
  ): { part: number; offset: number; over: number; span: number; line: string }[] {
    const out: { part: number; offset: number; over: number; span: number; line: string }[] = []
    for (const line of source.split('\n')) {
      const at = line.match(/at: markTime\("part-(\d+)"\)(?: \+ ([\d.]+))?/)
      const over = line.match(/over: ([\d.]+)/)
      if (at && over) {
        const overValue = Number(over[1])
        out.push({
          part: Number(at[1]),
          offset: at[2] !== undefined ? Number(at[2]) : 0,
          over: overValue,
          span: /approachOver/.test(line) ? overValue + 0.8 : overValue,
          line,
        })
      }
    }
    return out
  }

  /** Absolute board time of a placement given the slide's voice part durations. */
  function absoluteOf(
    item: { part: number; offset: number },
    slide: { prompterParts: readonly { duration: number }[] },
  ): number {
    const start = slide.prompterParts
      .slice(0, item.part)
      .reduce((sum, part) => sum + part.duration, 0)
    return start + item.offset
  }

  it('starts the first action at zero and ends the last 1s before the slide end', () => {
    const result = planScenarioDraft(TWO_EFFECT_DOC, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    const items = placements(slide?.source ?? '')
    expect(items.length).toBe(2)
    // First action starts at zero seconds: bare markTime anchor, no offset.
    expect(items[0]?.offset).toBeCloseTo(0, 9)
    expect(slide?.source).toMatch(/reveal\(text1, at: markTime\("part-0"\), over:/)
    // Carry span is over 1.5 + 0.8 approach = 2.3; the user rule reads the
    // 1.5s over as two seconds before the board end (round(1.5) = 2), and a
    // 1s tail follows the last sweep.
    const last = items[items.length - 1]!
    const span = 1.5 + 0.8
    expect(last.offset).toBeCloseTo(2.4, 6)
    expect(slide?.duration).toBeCloseTo(5.7, 6)
    // The last action finishes one second before the slide end.
    expect(last.offset + span).toBeCloseTo((slide?.duration ?? 0) - 1, 6)
  })

  it('spreads table border and cell reveals evenly without setup wipes', () => {
    const result = planScenarioDraft(TABLE_DOC, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    const items = placements(slide?.source ?? '')
    expect(items.length).toBeGreaterThan(3)
    // First action starts at zero.
    expect(items[0]?.offset).toBeCloseTo(0, 9)
    // Last cell reveal (over 0.7) ends one second before the slide end.
    const last = items[items.length - 1]!
    expect(last.offset + last.over).toBeCloseTo((slide?.duration ?? 0) - 1, 6)
    // The table-only border does not uncover its cell text. Each cell's own
    // future reveal mask keeps it hidden until its turn; no setup wipe can
    // flash it visible before that reveal.
    expect(slide?.source).toContain('reveal(nodeOnly(table1)')
    expect(slide?.source).not.toContain('visual: none')
    // Even spacing: the table-only border and each cell reveal are chained.
    const reveals = items
    const gaps: number[] = []
    for (let i = 1; i < reveals.length; i += 1) {
      const prevItem = reveals[i - 1]!
      const cur = reveals[i]!
      gaps.push(cur.offset - (prevItem.offset + prevItem.span))
    }
    expect(gaps.length).toBeGreaterThan(1)
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(-1e-9)
      expect(gap).toBeCloseTo(gaps[0]!, 2)
    }
  })

  it('pins the global first to part-0 at zero even when proportional ownership lands late', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Welcome',
      '',
      '**Narrator:** Hi. Yo. Ser is for lasting identity through every single day of our lives. Estar is for temporary states that change all the time around us. Lets begin together now friends.',
      '',
      '[reveal: text1]',
      '',
      'Ser and Estar.',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    expect(slide!.prompterParts.length).toBeGreaterThanOrEqual(3)
    // Without the pin, proportional ownership would open this slide at
    // markTime("part-2"); the opening action must start at zero instead.
    expect(slide?.source).toMatch(/reveal\(text1, at: markTime\("part-0"\), over:/)
    const items = placements(slide?.source ?? '')
    expect(items[0]?.offset).toBeCloseTo(0, 9)
    // The single wipe stacks at the tail: it ends one second before the
    // slide end (the board plus tail pads past the voice here).
    const last = items[items.length - 1]!
    expect(absoluteOf(last, slide!) + last.span).toBeCloseTo((slide?.duration ?? 0) - 1, 6)
  })

  it('stacks teardown sweeps at the tail with 1s padding between them', () => {
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
    // Builds keep their spread: the title opens at zero.
    expect(slide?.source).toMatch(/reveal\(text1, at: markTime\("part-0"\), over:/)
    const items = placements(slide?.source ?? '')
    // Single-part slide, so offsets are absolute times in script order.
    const isTeardownLine = (line: string): boolean =>
      /^wipe\(/.test(line) || /^carry\(.*to: \{ x: 1500, y: 1200 \}/.test(line)
    const builds = items.filter((item) => !isTeardownLine(item.line))
    const teardown = items.filter((item) => isTeardownLine(item.line))
    expect(builds.length).toBeGreaterThan(0)
    // Full wipe: label clear, card fly-home, title wipe — in fixture order.
    expect(teardown.length).toBe(3)
    expect(builds[0]?.offset).toBeCloseTo(0, 9)
    // Teardown sweeps chain with exactly 1s padding between them...
    for (let i = 1; i < teardown.length; i += 1) {
      const prev = teardown[i - 1]!
      const cur = teardown[i]!
      expect(cur.offset - (prev.offset + prev.span)).toBeCloseTo(1, 6)
    }
    // ...and the last one ends one second before the slide end.
    const last = teardown[teardown.length - 1]!
    expect(last.offset + last.span).toBeCloseTo((slide?.duration ?? 0) - 1, 6)
    // Read time: the finished board lingers briefly before teardown starts.
    const buildEnd = Math.max(...builds.map((b) => b.offset + b.span))
    expect(teardown[0]!.offset - buildEnd).toBeCloseTo(0.5, 6)
    // No overlaps anywhere in script order.
    for (let i = 1; i < items.length; i += 1) {
      const prev = items[i - 1]!
      const cur = items[i]!
      expect(cur.offset).toBeGreaterThanOrEqual(prev.offset + prev.span - 1e-9)
    }
  })

  it('anchors stacked teardown by time so offsets stay non-negative', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Two parts',
      '',
      '**Narrator:** Hello world today. Goodbye world today.',
      '',
      '![Oak tree](asset:oak-tree)',
      '',
      '> Brief: A sturdy oak.',
      '',
      '[place: oak-tree]',
      '',
      '[reveal: text1]',
      '',
      'Hello chalk here.',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    expect(slide?.prompterParts.length).toBeGreaterThanOrEqual(2)
    // Every teardown anchors to a declared mark of its time window...
    const lastPart = (slide?.prompterParts.length ?? 1) - 1
    const teardownAt = [
      ...(slide?.source ?? '').matchAll(
        /(?:wipe\(|carry\(.*to: \{ x: 1500, y: 1200 \}).*?at: markTime\("part-(\d+)"\)(?: \+ ([\d.]+))?/g,
      ),
    ]
    expect(teardownAt.length).toBe(2)
    for (const match of teardownAt) {
      const part = Number(match[1])
      expect(part).toBeGreaterThanOrEqual(0)
      expect(part).toBeLessThanOrEqual(lastPart)
      expect(Number(match[2] ?? 0)).toBeGreaterThanOrEqual(-1e-9)
    }
    // ...with 1s padding between sweeps and the last ending 1s before the end.
    const items = placements(slide?.source ?? '')
    const teardown = items.slice(-2)
    const firstEnd = absoluteOf(teardown[0]!, slide!) + teardown[0]!.span
    expect(absoluteOf(teardown[1]!, slide!) - firstEnd).toBeCloseTo(1, 6)
    const last = items[items.length - 1]!
    expect(absoluteOf(last, slide!) + last.span).toBeCloseTo((slide?.duration ?? 0) - 1, 6)
  })

  it('anchors each block first at its window start and the global last 1s before the slide end', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Two parts',
      '',
      '**Narrator:** Hello world today. Goodbye world today.',
      '',
      '![Oak tree](asset:oak-tree)',
      '',
      '> Brief: A sturdy oak.',
      '',
      '[place: oak-tree]',
      '',
      '[reveal: text1]',
      '',
      'Hello chalk here.',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    expect(slide?.prompterParts.length).toBeGreaterThanOrEqual(2)
    // First block opens at zero with a bare markTime anchor.
    expect(slide?.source).toMatch(/reveal\(text1, at: markTime\("part-0"\), over:/)
    // The global last action is owned by the final block and ends one second
    // before the slide end.
    const lastAt = (slide?.source ?? '').match(
      /carry\(oakTree,.*at: markTime\("part-(\d+)"\)(?: \+ ([\d.]+))?, over: ([\d.]+)/,
    )
    expect(lastAt).not.toBeNull()
    expect(Number(lastAt?.[1])).toBe((slide?.prompterParts.length ?? 1) - 1)
    const lastOffset = lastAt?.[2] !== undefined ? Number(lastAt[2]) : 0
    const lastOver = Number(lastAt?.[3])
    const lastPartStart =
      slide?.prompterParts.slice(0, -1).reduce((sum, part) => sum + part.duration, 0) ?? 0
    const lastStart = lastPartStart + lastOffset
    // Carry span includes the 0.8s approach flight on top of `over:`, plus the
    // 1s end tail.
    expect(lastStart + lastOver + 0.8).toBeCloseTo((slide?.duration ?? 0) - 1, 6)
  })
})

describe('Scenario planner bound asset names', () => {
  const FOX_DOC = [
    '# Ser and Estar',
    '',
    '## Step 1 — Fox',
    '',
    '**Narrator:** A quick red fox jumps over the sleepy brown suitcase today.',
    '',
    '![Red fox](asset:red-fox)',
    '',
    '> Brief: A quick red fox.',
    '',
    '[place: red-fox]',
    '',
    '[reveal: text1]',
    '',
    'Fox and case.',
    '',
  ].join('\n')

  it('names create asset from the bound library asset, not the md slug', () => {
    const result = planScenarioDraft(FOX_DOC, 0.1, [], {
      bindings: { 'red-fox': 'asset-fox' },
      assetNames: { 'asset-fox': 'fox' },
    })
    const source = result.slides[0]?.source ?? ''
    expect(source).toContain('create asset "fox" as redFox')
    expect(source).not.toContain('create asset "red-fox"')
  })

  it('falls back to the md slug when nothing is bound', () => {
    const result = planScenarioDraft(FOX_DOC, 0.1, [])
    expect(result.slides[0]?.source).toContain('create asset "red-fox" as redFox')
  })

  it('check-clean resolves the bound name against the asset library', () => {
    const result = planScenarioDraft(FOX_DOC, 0.1, [], {
      bindings: { 'red-fox': 'asset-fox' },
      assetNames: { 'asset-fox': 'fox' },
    })
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    expect(result.blocked).toBe(false)
    const parsed = parseAnimationScript(slide?.source ?? '')
    expect(parsed.diagnostics).toEqual([])

    const system = createCommandSystem(() => {})
    const project = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
    if (!project.ok) throw new Error('no project')
    const created = system.dispatcher.dispatch(new CreateSlideCommand({ name: slide!.slideName }))
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
    // The library holds the user's actual name ("fox") — never the md slug.
    system.assetLibrarySync.apply([
      { id: 'bg-board', name: 'blackboar-background' },
      { id: 'paw-chalk', name: 'paw with chalk' },
      { id: 'paw-rag', name: 'paw with rag' },
      { id: 'paw-empty', name: 'paw empty' },
      { id: 'asset-fox', name: 'fox' },
    ])
    system.engine.getSlide(slideId).duration = slide!.duration
    const checked = checkAnimationScript(system.engine, slideId, slide!.source, {
      globalAudioAssets: [
        { id: 'w', name: 'writing-on-black-board', duration: 0.4 },
        { id: 'e', name: 'dry-erase', duration: 0.4 },
      ],
    })
    expect(checked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(checked.runnable).toBe(true)
  })
})

describe('Scenario planner table layout', () => {
  const TWO_TABLE_DOC = [
    '# Lesson',
    '',
    '## Step 5 — Recap',
    '',
    '**Narrator:** So now you know the rule you can trust every single day.',
    '',
    '[reveal: table1]',
    '',
    '| Use ser for | Use estar for |',
    '|---|---|',
    '| identity and traits | feelings now |',
    '| origin and material | location now |',
    '| es listo = clever | está listo = ready |',
    '',
    '[wipe: table1]',
    '',
    '[reveal: table2]',
    '',
    '| Person | ser | estar |',
    '|---|---|---|',
    '| yo | soy | estoy |',
    '| tú | eres | estás |',
    '| él / ella | es | está |',
    '| nosotros | somos | estamos |',
    '| vosotros | sois | estáis |',
    '',
  ].join('\n')

  function tableCreates(source: string): { name: string; x: number; y: number; rows: number }[] {
    const out: { name: string; x: number; y: number; rows: number }[] = []
    for (const line of source.split('\n')) {
      const match = line.match(/create table "([^"]+)" as \S+ at \(([\d.]+), ([\d.]+)\)/)
      if (!match) continue
      const rows = (line.match(/\[(""|"(?:[^"\\]|\\.)*")(, ""|,"(?:[^"\\]|\\.)*")*\]/g) ?? [])
        .length
      out.push({ name: match[1]!, x: Number(match[2]), y: Number(match[3]), rows })
    }
    return out
  }

  it('cascades stacked tables down so they never share the same area', () => {
    const result = planScenarioDraft(TWO_TABLE_DOC, 0.1, [])
    const slide = result.slides[0]
    expect(slide).toBeDefined()
    const tables = tableCreates(slide?.source ?? '')
    expect(tables.map((t) => t.name)).toEqual(['table1', 'table2'])
    // table1: 2 cols x 150 = 300 wide → centered at 545; 4 rows.
    expect(tables[0]?.rows).toBe(4)
    expect(tables[0]?.x + 300 / 2).toBeCloseTo(545, 6)
    // table2: 3 cols x 150 = 450 wide → centered at 545; 6 rows.
    expect(tables[1]?.rows).toBe(6)
    expect(tables[1]?.x + 450 / 2).toBeCloseTo(545, 6)
    // No vertical overlap: table2 starts below table1's estimated band plus gap.
    expect(tables[1]!.y).toBeGreaterThan(tables[0]!.y + 4 * 34)
  })

  it('scales table border wobbleY with the row count', () => {
    const result = planScenarioDraft(TWO_TABLE_DOC, 0.1, [])
    const source = result.slides[0]?.source ?? ''
    // 4-row table → 2x the {8-18} base; 6-row table → 3x.
    expect(source).toMatch(/reveal\(nodeOnly\(table1\),.*wobbleY: \{ from: 16, to: 36 \}/)
    expect(source).toMatch(/reveal\(nodeOnly\(table2\),.*wobbleY: \{ from: 24, to: 54 \}/)
    // The subtree wipes ride their own table's wobble.
    expect(source).toMatch(/wipe\(subtree\(table1\).*wobbleY: \{ from: 16, to: 36 \}/)
  })

  it('keeps small tables calm: 2-row border uses the base wobble', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Small',
      '',
      '**Narrator:** A narrator line long enough to cover the board work here today.',
      '',
      '| A | B |',
      '| --- | --- |',
      '| C | D |',
      '',
      '[reveal: table1]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    expect(result.slides[0]?.source).toMatch(
      /reveal\(nodeOnly\(table1\),.*wobbleY: \{ from: 8, to: 18 \}/,
    )
  })

  it('drops the teardown wipe of a table already cleared mid-slide', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 5 — Recap',
      '',
      '**Narrator:** So now you know the rule you can trust every single day.',
      '',
      '[reveal: table1]',
      '',
      '| Use ser for | Use estar for |',
      '|---|---|',
      '| identity and traits | feelings now |',
      '| origin and material | location now |',
      '| es listo = clever | está listo = ready |',
      '',
      '[wipe: table1]',
      '',
      '[reveal: text2]',
      '',
      'How you conjugate ser and estar',
      '',
      '[reveal: table2]',
      '',
      '| Person | ser | estar |',
      '|---|---|---|',
      '| yo | soy | estoy |',
      '| tú | eres | estás |',
      '| él / ella | es | está |',
      '| nosotros | somos | estamos |',
      '| vosotros | sois | estáis |',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const source = result.slides[0]?.source ?? ''
    // One mid-recap clear before table2 draws; the targeted end wipe is
    // redundant (re-wiping hidden content flashes it back) and must go.
    expect(source.match(/wipe\(subtree\(table1\)/g)).toHaveLength(1)
  })

  it('keeps one wipe per table under a full wipe: mid-recap for the first, teardown for the last', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 5 — Recap',
      '',
      '**Narrator:** So now you know the rule you can trust every single day.',
      '',
      '[reveal: table1]',
      '',
      '| Use ser for | Use estar for |',
      '|---|---|',
      '| identity and traits | feelings now |',
      '| origin and material | location now |',
      '| es listo = clever | está listo = ready |',
      '',
      '[reveal: table2]',
      '',
      '| Person | ser | estar |',
      '|---|---|---|',
      '| yo | soy | estoy |',
      '| tú | eres | estás |',
      '| él / ella | es | está |',
      '| nosotros | somos | estamos |',
      '| vosotros | sois | estáis |',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const source = result.slides[0]?.source ?? ''
    // table1: cleared once mid-slide before table2 draws, never again.
    expect(source.match(/wipe\(subtree\(table1\)/g)).toHaveLength(1)
    // table2: cleared once in the end cluster.
    expect(source.match(/wipe\(subtree\(table2\)/g)).toHaveLength(1)
    // The end cluster wipes table2 after table1's mid clear, never the reverse.
    const mid = source.indexOf('wipe(subtree(table1)')
    const tail = source.indexOf('wipe(subtree(table2)')
    expect(mid).toBeGreaterThan(-1)
    expect(tail).toBeGreaterThan(mid)
  })

  it('lets a bare wipe clear the board even when a targeted wipe is also present', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 5 — Recap',
      '',
      '**Narrator:** So now you know the rule you can trust every single day.',
      '',
      '[reveal: table1]',
      '',
      '| Use ser for | Use estar for |',
      '|---|---|',
      '| identity and traits | feelings now |',
      '| origin and material | location now |',
      '| es listo = clever | está listo = ready |',
      '',
      '[wipe: table1]',
      '',
      '[reveal: text2]',
      '',
      'How you conjugate ser and estar',
      '',
      '[reveal: table2]',
      '',
      '| Person | ser | estar |',
      '|---|---|---|',
      '| yo | soy | estoy |',
      '| tú | eres | estás |',
      '| él / ella | es | está |',
      '| nosotros | somos | estamos |',
      '| vosotros | sois | estáis |',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const result = planScenarioDraft(doc, 0.1, [])
    const source = result.slides[0]?.source ?? ''
    // table1: cleared once mid-slide; the targeted end duplicate stays gone.
    expect(source.match(/wipe\(subtree\(table1\)/g)).toHaveLength(1)
    // table2 + title: cleared once in the end cluster (bare wipe is not
    // swallowed by the targeted entry).
    expect(source.match(/wipe\(subtree\(table2\)/g)).toHaveLength(1)
    expect(source).toMatch(/wipe\(text2, at: markTime/)
    // End cluster order: the last table, then the title.
    const table2Wipe = source.indexOf('wipe(subtree(table2)')
    const titleWipe = source.indexOf('wipe(text2,')
    expect(table2Wipe).toBeGreaterThan(-1)
    expect(titleWipe).toBeGreaterThan(table2Wipe)
  })
})
