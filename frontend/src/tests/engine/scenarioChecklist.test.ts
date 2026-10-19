import { describe, expect, it } from 'vitest'
import {
  buildScenarioAvailableIds,
  buildScenarioChecklistRows,
  getScenarioHtmlState,
  getScenarioUnboundCount,
  isScenarioGenerateBlocked,
  updateScenarioBrief,
} from '../../engine/scenarioChecklist'

const MD = [
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Young doctor smiling](asset:young-doctor-smiling)',
  '',
  '> Brief: Warm portrait.',
  '',
  'You say soy.',
  '',
  '## Step 2 — Where you are',
  '',
  '![Empty classroom chairs](asset:empty-classroom-chairs)',
  '',
  '<!-- reuse: Classroom Chairs -->',
  '',
  'Estamos en clase.',
  '',
  '## Step 3 — Table',
  '',
  '![Chalkboard table](asset:chalkboard-table)',
  '',
  'No brief, no reuse.',
  '',
].join('\n')

describe('scenarioChecklist pure seam (issue #463)', () => {
  it('builds one row per normalized key in doc order with bound derived from available ids', () => {
    const rows = buildScenarioChecklistRows(
      MD,
      { 'young-doctor-smiling': 'def-doctor' },
      new Set(['def-doctor']),
    )
    expect(rows.map((r) => r.key)).toEqual([
      'young-doctor-smiling',
      'empty-classroom-chairs',
      'chalkboard-table',
    ])
    expect(rows[0]).toMatchObject({
      alt: 'Young doctor smiling',
      bound: true,
      bindingAssetId: 'def-doctor',
      hasBrief: true,
    })
    // Reuse row without a binding is unbound: reuse alone never unblocks.
    expect(rows[1]).toMatchObject({ bound: false, reuse: 'Classroom Chairs' })
    // Neither brief nor reuse is still a row, unbound.
    expect(rows[2]).toMatchObject({ bound: false, hasBrief: false })
  })

  it('brief text alone never unblocks; missing binding or unknown id stays unbound', () => {
    const rows = buildScenarioChecklistRows(
      MD,
      { 'young-doctor-smiling': 'def-missing' },
      new Set(['def-other']),
    )
    expect(rows[0]).toMatchObject({ hasBrief: true, bound: false })
    expect(getScenarioUnboundCount(rows)).toBe(3)
    expect(isScenarioGenerateBlocked(rows)).toBe(true)
  })

  it('empty doc yields no rows and never blocks Generate', () => {
    const rows = buildScenarioChecklistRows('', {}, new Set())
    expect(rows).toEqual([])
    expect(getScenarioUnboundCount(rows)).toBe(0)
    expect(isScenarioGenerateBlocked(rows)).toBe(false)
  })

  it('skips empty alts and dedupes normalized keys keeping first alt', () => {
    const md = [
      '## Step 1 — One',
      '',
      '![](asset:)',
      '',
      '![Cat](asset:cat)',
      '',
      '> Brief: First.',
      '',
      '## Step 2 — Two',
      '',
      '![  CAT  ](asset:cat)',
      '',
      '> Brief: Second.',
      '',
    ].join('\n')
    const rows = buildScenarioChecklistRows(md, { cat: 'def-cat' }, new Set(['def-cat']))
    expect(rows.map((r) => r.key)).toEqual(['cat'])
    expect(rows[0]).toMatchObject({ alt: 'Cat', bound: true })
  })

  it('derives View lifecycle empty / ready / stale from stored HTML and generation pointer', () => {
    expect(
      getScenarioHtmlState({
        lastHtml: undefined,
        currentMarkdown: MD,
        generatedFromVersionId: null,
        versions: [],
      }),
    ).toBe('empty')
    const versions = [{ id: 'v-1', content: MD }]
    expect(
      getScenarioHtmlState({
        lastHtml: '<html>old</html>',
        currentMarkdown: MD,
        generatedFromVersionId: 'v-1',
        versions,
      }),
    ).toBe('ready')
    expect(
      getScenarioHtmlState({
        lastHtml: '<html>old</html>',
        currentMarkdown: `${MD}\n\nEdited.`,
        generatedFromVersionId: 'v-1',
        versions,
      }),
    ).toBe('stale')
    // Stored HTML with no pointer can never prove freshness.
    expect(
      getScenarioHtmlState({
        lastHtml: '<html>old</html>',
        currentMarkdown: MD,
        generatedFromVersionId: null,
        versions,
      }),
    ).toBe('stale')
    // Unknown pointer is stale, never ready.
    expect(
      getScenarioHtmlState({
        lastHtml: '<html>old</html>',
        currentMarkdown: MD,
        generatedFromVersionId: 'v-missing',
        versions,
      }),
    ).toBe('stale')
  })

  it('edits the brief line for every visual with the key, inserting when absent', () => {
    const edited = updateScenarioBrief(MD, 'young-doctor-smiling', 'New brief text.')
    expect(edited).toContain('> Brief: New brief text.')
    expect(edited).not.toContain('Warm portrait.')
    // Insert path: chalkboard-table has no brief line.
    const inserted = updateScenarioBrief(MD, 'chalkboard-table', 'Table brief.')
    expect(inserted).toContain('![Chalkboard table](asset:chalkboard-table)')
    expect(inserted).toContain('> Brief: Table brief.')
  })

  it('combines embedded and library ids into the bound-check set', () => {
    const ids = buildScenarioAvailableIds(['emb-1'], [{ id: 'lib-1' }], [{ id: 'lib-2' }])
    expect(ids.has('emb-1')).toBe(true)
    expect(ids.has('lib-1')).toBe(true)
    expect(ids.has('lib-2')).toBe(true)
    expect(ids.has('missing')).toBe(false)
  })
})
