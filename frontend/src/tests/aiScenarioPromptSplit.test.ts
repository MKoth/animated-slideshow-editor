import { describe, expect, it } from 'vitest'
import {
  extractForeignWordsFromHtml,
  resolveForeignWords,
  splitNarratorToPromptParts,
} from '../ai/scenarioPromptSplit'
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
    // 4 sentences, first split further by 2 foreign words → 7 blocks.
    expect(slide?.prompterParts).toHaveLength(7)
    expect(slide?.prompterParts.map((p) => p.text)).toEqual([
      'In this lesson you will understand when to use',
      'ser',
      'and when to use',
      'estar',
      'Both mean to be',
      'but you use them for very different reasons',
      'and I will give you a simple way to choose correctly every time you speak about yourself and others',
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
})
