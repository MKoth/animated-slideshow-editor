import { describe, expect, it } from 'vitest'
import {
  extractForeignWordsFromHtml,
  resolveForeignWords,
  splitNarratorToPromptParts,
} from '../ai/scenarioPromptSplit'
import { parseAnimationScript } from '../engine/animationScriptParser'
import { planScenarioDraft } from '../ai/scenarioPlanner'

const SPLIT = ['.', ',', ';', ':', '!', '?', '\n', '—']

describe('scenarioPromptSplit', () => {
  it('extracts foreign words from chalk HTML highlights', () => {
    const html = [
      '<p class="narrator">Say <strong class="foreign">ser</strong>',
      'and <strong class="other foreign foo">estar</strong>!</p>',
      '<td><strong class="foreign">Soy doctora</strong></td>',
    ].join('\n')
    expect(extractForeignWordsFromHtml(html)).toEqual(['ser', 'estar', 'Soy doctora'])
  })

  it('returns empty for HTML without foreign highlights', () => {
    expect(extractForeignWordsFromHtml('<p>Hello</p>')).toEqual([])
    expect(extractForeignWordsFromHtml('')).toEqual([])
  })

  it('splits sentences like manual prompter paste', () => {
    const parts = splitNarratorToPromptParts(
      'In this lesson you will understand. Both mean to be! Really?',
      SPLIT,
      [],
    )
    expect(parts).toEqual(['In this lesson you will understand', 'Both mean to be', 'Really'])
  })

  it('isolates foreign words as their own blocks', () => {
    const parts = splitNarratorToPromptParts('Ser is for who you are.', SPLIT, ['Ser'])
    expect(parts).toEqual(['Ser', 'is for who you are'])
  })

  it('isolates multi-word foreign phrases as single blocks', () => {
    const parts = splitNarratorToPromptParts('The tree de roble stands tall.', SPLIT, [
      'de roble',
      'roble',
    ])
    expect(parts).toEqual(['The tree', 'de roble', 'stands tall'])
  })

  it('drops punctuation-only gaps orphaned between foreign phrases', () => {
    const parts = splitNarratorToPromptParts(
      'Call it árbol de roble, duradero y sólido today.',
      SPLIT,
      ['árbol de roble', 'duradero y sólido'],
    )
    expect(parts).toEqual(['Call it', 'árbol de roble', 'duradero y sólido', 'today'])
    expect(parts.some((part) => !/[A-Za-z0-9\u00c0-\u024f]/u.test(part))).toBe(false)
  })
  it('strips leading commas orphaned next to foreign phrases', () => {
    const parts = splitNarratorToPromptParts(
      'Think of ser, because it lasts.',
      ['.', '!', '?', '\n'],
      ['ser'],
    )
    expect(parts).toEqual(['Think of', 'ser', 'because it lasts'])
  })

  it('combines HTML extraction with the stored fallback list', () => {
    const html = '<strong class="foreign">ser</strong>'
    expect(resolveForeignWords(html, ['estar'])).toEqual(['ser', 'estar'])
    expect(resolveForeignWords('', ['estar'])).toEqual(['estar'])
  })
})

describe('planner prompt-block splitting', () => {
  it('splits the lesson intro into sentence blocks with foreign isolates', () => {
    const narrator =
      'In this lesson you will understand when to use ser and when to use estar. ' +
      'Both mean to be, but you use them for very different reasons, and I will give you a simple way to choose correctly every time you speak about yourself and others.'
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Intro',
      '',
      `**Narrator:** ${narrator}`,
      '',
      '[reveal: text1]',
      '',
      'Some chalk.',
      '',
    ].join('\n')
    const html =
      '<p class="narrator">when to use <strong class="foreign">ser</strong> ' +
      'and <strong class="foreign">estar</strong>.</p>'
    const plan = planScenarioDraft(doc, 0.1, [], { splitChars: SPLIT, html })
    const slide = plan.slides[0]
    expect(slide).toBeDefined()
    // Sentence-level only: commas never split generated blocks. Sentence 1
    // splits further by 2 foreign words → 4 blocks; sentence 2 keeps its
    // commas → 1 block.
    expect(slide?.prompterParts).toHaveLength(5)
    expect(slide?.prompterParts.map((p) => p.text)).toEqual([
      'In this lesson you will understand when to use',
      'ser',
      'and when to use',
      'estar',
      'Both mean to be, but you use them for very different reasons, and I will give you a simple way to choose correctly every time you speak about yourself and others',
    ])
    for (const [index, part] of (slide?.prompterParts ?? []).entries()) {
      expect(part.promptBlockId).toBe(`prompt-1-${index + 1}`)
      expect(part.markName).toBe(`part-${index}`)
    }
    const sum = (slide?.prompterParts ?? []).reduce((total, part) => total + part.duration, 0)
    expect(slide?.duration).toBeCloseTo(sum, 9)
    // Board fractions point at owning sub-blocks, source carries every mark.
    for (const fraction of slide?.fractions ?? []) {
      expect(fraction.block).toMatch(/^prompt-1-\d+$/)
    }
    for (const part of slide?.prompterParts ?? []) {
      expect(slide?.source).toContain(`mark("${part.markName}")`)
    }
  })

  it('never splits generated blocks on commas', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Commas',
      '',
      '**Narrator:** You use ser for identity, origin, material, and lasting traits.',
      '',
      '[reveal: text1]',
      '',
      'Chalk.',
      '',
    ].join('\n')
    const plan = planScenarioDraft(doc, 0.1, [], { splitChars: SPLIT })
    const slide = plan.slides[0]
    expect(slide?.prompterParts).toHaveLength(1)
    expect(slide?.prompterParts[0]?.text).toBe(
      'You use ser for identity, origin, material, and lasting traits',
    )
  })

  it('gives each chalk paragraph its own single-line board node', () => {
    const doc = [
      '# Lesson',
      '',
      '## Step 1 — Paragraphs',
      '',
      '**Narrator:** Hello world.',
      '',
      '[reveal: text1]',
      '',
      'Ser = lasting identity',
      '',
      'Oak tree - lasting and solid',
      '',
      'Árbol de roble - duradero y sólido',
      '',
      '[wipe]',
      '',
    ].join('\n')
    const plan = planScenarioDraft(doc, 0.1, [], {})
    const slide = plan.slides[0]
    expect(slide).toBeDefined()
    // First paragraph keeps the reveal id, surplus paragraphs auto-reveal.
    expect(slide?.source).toContain('create text "text1"')
    expect(slide?.source).toContain('create text "text1-2"')
    expect(slide?.source).toContain('create text "text1-3"')
    // No quoted string spans a raw newline — the grammar ends strings there.
    for (const line of (slide?.source ?? '').split('\n')) {
      if (line.includes('content: "')) {
        expect(line.trim().endsWith('}')).toBe(true)
      }
    }
    const parsed = parseAnimationScript(slide?.source ?? '')
    expect(parsed.diagnostics).toEqual([])
  })
})
