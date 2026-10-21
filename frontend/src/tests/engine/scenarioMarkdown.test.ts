import { describe, expect, it } from 'vitest'
import {
  normalizeAssetKey,
  parseScenarioMarkdown,
  upgradeLegacyScenarioToMarkdown,
} from '../../engine/scenarioMarkdown'

describe('normalizeAssetKey', () => {
  it('trims, collapses whitespace, lowercases, and hyphenates spaces', () => {
    expect(normalizeAssetKey('  Young   Doctor SMILING  ')).toBe('young-doctor-smiling')
  })

  it('collapses tabs and newlines to single hyphens', () => {
    expect(normalizeAssetKey('Empty\tclassroom\nchairs')).toBe('empty-classroom-chairs')
  })
})

describe('parseScenarioMarkdown', () => {
  it('splits sequential Step headings from one with titles', () => {
    const md = [
      '# Ser vs Estar — Mini Lesson',
      '',
      '## Step 1 — Who you are',
      '',
      '**Narrator:** Ser is for who you are.',
      '',
      'You say **soy** when true tomorrow.',
      '',
      '## Step 2 — Where you are',
      '',
      '**Narrator:** Estar is for where you are.',
      '',
      'Estamos en clase.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps).toHaveLength(2)
    expect(parsed.steps[0]?.index).toBe(1)
    expect(parsed.steps[0]?.title).toBe('Who you are')
    expect(parsed.steps[1]?.index).toBe(2)
    expect(parsed.warnings).toEqual([])
  })

  it('reads narrator as voiceover and text as chalk wording without confusion', () => {
    const md = [
      '## Step 1 — Who you are',
      '',
      '**Narrator:** Ser is for who you are.',
      '',
      'You say **soy** tomorrow.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.narrator).toBe('Ser is for who you are.')
    expect(parsed.steps[0]?.text).toContain('soy')
    expect(parsed.steps[0]?.text).not.toContain('Ser is for who you are.')
  })

  it('pairs visuals with normalized keys and brief plus optional reuse', () => {
    const md = [
      '# Who you are',
      '',
      '## Step 1 — Who you are',
      '',
      '**Narrator:** Hello.',
      '',
      '![Young doctor smiling](asset:young-doctor-smiling)',
      '',
      '> Brief: Warm portrait.',
      '',
      'Some chalk text.',
      '',
      '## Step 2 — Where you are',
      '',
      '**Narrator:** Hi.',
      '',
      '![Empty classroom chairs](asset:empty-classroom-chairs)',
      '',
      '<!-- reuse: Classroom Chairs -->',
      '',
      'Estamos.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.title).toBe('Who you are')
    expect(parsed.steps[0]?.visuals).toHaveLength(1)
    expect(parsed.steps[0]?.visuals[0]).toMatchObject({
      alt: 'Young doctor smiling',
      key: 'young-doctor-smiling',
      brief: 'Warm portrait.',
    })
    expect(parsed.steps[1]?.visuals[0]).toMatchObject({
      alt: 'Empty classroom chairs',
      key: 'empty-classroom-chairs',
      reuse: 'Classroom Chairs',
    })
    expect(parsed.warnings).toEqual([])
  })

  it('warns on bare headings without blocking', () => {
    const md = ['## Step 1 — Empty', '', '## Step 2 — Full', '', '**Narrator:** Hi.', ''].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps).toHaveLength(2)
    expect(parsed.warnings.some((w) => w.code === 'bare-heading' && w.step === 1)).toBe(true)
  })

  it('warns on non-sequential headings without blocking', () => {
    const md = [
      '## Step 1 — One',
      '',
      '**Narrator:** Hi.',
      '',
      '## Step 3 — Three',
      '',
      '**Narrator:** Ho.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps).toHaveLength(2)
    expect(parsed.warnings.some((w) => w.code === 'non-sequential-heading')).toBe(true)
  })

  it('warns on duplicate keys, empty alts, and visuals with neither brief nor reuse', () => {
    const md = [
      '## Step 1 — One',
      '',
      '![Cat](asset:cat)',
      '',
      'Text here.',
      '',
      '## Step 2 — Two',
      '',
      '![cat](asset:cat)',
      '',
      '> Brief: Second cat.',
      '',
      'More text.',
      '',
      '## Step 3 — Three',
      '',
      '![](asset:empty)',
      '',
      '> Brief: Empty alt.',
      '',
      'Text.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    const codes = parsed.warnings.map((w) => w.code)
    expect(codes).toContain('missing-brief-and-reuse')
    expect(codes).toContain('duplicate-key')
    expect(codes).toContain('empty-alt')
  })

  it('passes tables through and warns on malformed tables', () => {
    const good = [
      '## Step 1 — One',
      '',
      '| Spanish | English |',
      '| --- | --- |',
      '| Soy | I am |',
      '',
      'Text.',
      '',
    ].join('\n')
    expect(parseScenarioMarkdown(good).steps[0]?.table).toContain('| Spanish | English |')
    expect(
      parseScenarioMarkdown(good).warnings.filter((w) => w.code === 'malformed-table'),
    ).toHaveLength(0)

    const bad = [
      '## Step 1 — One',
      '',
      '| Spanish | English |',
      '| Soy | I am |',
      '',
      'Text.',
      '',
    ].join('\n')
    const parsedBad = parseScenarioMarkdown(bad)
    expect(parsedBad.warnings.some((w) => w.code === 'malformed-table')).toBe(true)
  })

  it('warns when slug does not mirror normalized alt', () => {
    const md = [
      '## Step 1 — One',
      '',
      '![Young doctor](asset:wrong-slug)',
      '',
      '> Brief: Portrait.',
      '',
      'Text.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.warnings.some((w) => w.code === 'slug-mismatch')).toBe(true)
    expect(parsed.steps[0]?.visuals[0]?.key).toBe('young-doctor')
  })

  it('keeps a second narrator line in narrator, never in text', () => {
    const md = [
      '## Step 1 — One',
      '',
      '**Narrator:** First line.',
      '',
      '**Narrator:** Second line.',
      '',
      'Chalk text.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.narrator).toContain('First line.')
    expect(parsed.steps[0]?.narrator).toContain('Second line.')
    expect(parsed.steps[0]?.text).not.toContain('Narrator:')
  })

  it('passes through multiple tables without silent demotion', () => {
    const md = [
      '## Step 1 — One',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '| C | D |',
      '| --- | --- |',
      '| 3 | 4 |',
      '',
      'Text.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.table).toContain('| A | B |')
    expect(parsed.steps[0]?.table).toContain('| C | D |')
  })

  it('captures the H1 lesson title and warns when it is missing', () => {
    const titled = [
      '# Ser and estar usage',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Hi.',
      '',
    ].join('\n')
    const withTitle = parseScenarioMarkdown(titled)
    expect(withTitle.title).toBe('Ser and estar usage')
    expect(withTitle.warnings.map((w) => w.code)).not.toContain('missing-title')

    const untitled = ['## Step 1 — One', '', '**Narrator:** Hi.', ''].join('\n')
    const withoutTitle = parseScenarioMarkdown(untitled)
    expect(withoutTitle.title).toBeUndefined()
    expect(withoutTitle.warnings.some((w) => w.code === 'missing-title')).toBe(true)
  })

  it('tracks content blocks in document order for ordered rendering', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — Mixed',
      '',
      '![First](asset:first)',
      '',
      '> Brief: First brief.',
      '',
      'Text after first.',
      '',
      '| Spanish | English |',
      '| --- | --- |',
      '| Hola | Hello |',
      '',
      '![Second](asset:second)',
      '',
      '> Brief: Second brief.',
      '',
      'Text after second.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    const kinds = parsed.steps[0]?.blocks.map((b) => b.kind)
    expect(kinds).toEqual(['visual', 'text', 'table', 'visual', 'text'])
    // Grouped views stay intact for checklist/zip consumers.
    expect(parsed.steps[0]?.visuals).toHaveLength(2)
    expect(parsed.steps[0]?.table).toContain('Hola')
    expect(parsed.steps[0]?.text).toContain('Text after first.')
  })

  it('keeps orphan label content as text without the marker and drops orphan briefs', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
      'Some text.',
      '',
      '> Label: Stray caption without an open visual',
      '',
      '> Brief: Stray brief that must never render',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    // The visual keeps only its attached brief; the orphan lines never
    // attach anywhere.
    expect(parsed.steps[0]?.visuals[0]).toMatchObject({ brief: 'A tree.' })
    expect(parsed.steps[0]?.text).toContain('Some text.')
    // Orphan label content survives as reader text, marker word gone.
    expect(parsed.steps[0]?.text).toContain('Stray caption without an open visual')
    expect(parsed.steps[0]?.text).not.toContain('Label:')
    // Orphan briefs stay in markdown only and never leak into text.
    expect(parsed.steps[0]?.text).not.toContain('Brief:')
    expect(parsed.steps[0]?.text).not.toContain('Stray brief')
    expect(parsed.steps[0]?.blocks.map((b) => b.kind)).toEqual(['visual', 'text', 'text'])
  })

  it('attaches chalk labels to visuals without leaking into text', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
      '> Label: El árbol ES verde',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.visuals[0]).toMatchObject({
      alt: 'Green tree',
      key: 'green-tree',
      brief: 'A tree.',
      label: 'El árbol ES verde',
    })
    expect(parsed.steps[0]?.text ?? '').not.toContain('Label:')
    expect(parsed.warnings).toEqual([])
  })

  it('parses remove and wipe markers as board actions, never as text', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
      '## Step 2 — Two',
      '',
      '[remove: green-tree]',
      '',
      '![Dry tree](asset:dry-tree)',
      '',
      '> Brief: A dry tree.',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.wiped).toBe(false)
    expect(parsed.steps[0]?.removes).toEqual([])
    expect(parsed.steps[1]?.removes).toEqual(['green-tree'])
    expect(parsed.steps[1]?.wiped).toBe(true)
    expect(parsed.steps[0]?.text ?? '').not.toContain('wipe')
    expect(parsed.steps[1]?.text ?? '').not.toContain('remove')
    expect(parsed.warnings).toEqual([])
  })

  it('warns when a wipe closes an empty board', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Just talking, nothing shown.',
      '',
      '[wipe]',
      '',
      '## Step 2 — Two',
      '',
      '**Narrator:** Still nothing on the board.',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.warnings.filter((w) => w.code === 'dangling-wipe').map((w) => w.step)).toEqual([
      1, 2,
    ])
  })

  it('warns when a remove targets an image already wiped away', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
      '[wipe]',
      '',
      '## Step 2 — Two',
      '',
      '[remove: green-tree]',
      '',
      '**Narrator:** Gone already.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.warnings.some((w) => w.code === 'unknown-remove' && w.step === 2)).toBe(true)
  })

  it('warns on removes pointing at unknown keys', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '[remove: ghost-tree]',
      '',
      '**Narrator:** Hi.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.bare).toBe(false)
    expect(parsed.warnings.some((w) => w.code === 'unknown-remove' && w.step === 1)).toBe(true)
  })

  it('parses place and reveal markers as board actions, never as text', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '[place: green-tree]',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
      '[reveal: text]',
      '',
      'Ser is identity.',
      '',
      '[reveal: table]',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '[remove: green-tree]',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.placed).toEqual(['green-tree'])
    expect(parsed.steps[0]?.reveals).toEqual(['text', 'table'])
    expect(parsed.steps[0]?.removes).toEqual(['green-tree'])
    expect(parsed.steps[0]?.wiped).toBe(true)
    const text = parsed.steps[0]?.text ?? ''
    expect(text).not.toContain('place:')
    expect(text).not.toContain('reveal:')
    expect(text).toContain('Ser is identity.')
    expect(parsed.warnings).toEqual([])
  })

  it('warns when a place declares an image with no visual in the doc', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '[place: ghost-tree]',
      '',
      '**Narrator:** Hi.',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.warnings.some((w) => w.code === 'dangling-place' && w.step === 1)).toBe(true)
  })

  it('tracks text and table ids so targeted wipe and remove pair up', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '[reveal: text1]',
      '',
      'Ser is identity.',
      '',
      '[reveal: table1]',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '[remove: text1]',
      '',
      '[wipe: table1]',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps[0]?.reveals).toEqual(['text1', 'table1'])
    expect(parsed.steps[0]?.removes).toEqual(['text1'])
    expect(parsed.steps[0]?.wipeTargets).toEqual(['table1'])
    expect(parsed.steps[0]?.wiped).toBe(true)
    expect(parsed.warnings).toEqual([])
  })

  it('warns when a targeted wipe names an id never shown', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '**Narrator:** Hi.',
      '',
      '[wipe: ghost-text]',
      '',
    ].join('\n')
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.warnings.some((w) => w.code === 'unknown-remove' && w.step === 1)).toBe(true)
    expect(parsed.warnings.some((w) => w.code === 'dangling-wipe')).toBe(false)
  })
})

describe('upgradeLegacyScenarioToMarkdown', () => {
  it('maps spokenLine to narrator and onScreenAction to text plus brief seed', () => {
    const md = upgradeLegacyScenarioToMarkdown([
      {
        partTag: 'intro',
        spokenLine: 'Hello friends!',
        onScreenAction: 'Cat waves at camera',
        assetHints: ['cat'],
      },
    ])
    const parsed = parseScenarioMarkdown(md)
    expect(parsed.steps).toHaveLength(1)
    expect(parsed.steps[0]?.narrator).toBe('Hello friends!')
    expect(parsed.steps[0]?.text).toContain('Cat waves at camera')
    expect(parsed.steps[0]?.visuals[0]?.alt).toBe('cat')
    expect(parsed.steps[0]?.visuals[0]?.brief).toContain('Cat waves at camera')
    // Legacy output carries no H1 — warns instead of blocking.
    expect(parsed.warnings.map((w) => w.code)).toEqual(['missing-title'])
  })
})
