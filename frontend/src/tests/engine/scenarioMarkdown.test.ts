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
    expect(parsed.warnings).toEqual([])
  })
})
