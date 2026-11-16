import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScenarioDocMarkdown } from '../../ai/markdown'
import { splitScenarioDocBlocks } from '../../engine/scenarioBlocks'

function renderedBlockCount(content: string): number {
  const { container } = render(<ScenarioDocMarkdown content={content} />)
  const md = container.querySelector('.ai-markdown')
  if (!md) throw new Error('ScenarioDocMarkdown rendered no .ai-markdown root')
  return Array.from(md.children).filter((el) => el instanceof HTMLElement).length
}

const GLUED_BOARD_LINES = [
  '**Narrator:** You will learn ser and estar.',
  '[reveal: text1]',
  'Ser and Estar',
  '[wipe]',
  '',
].join('\n')

const GLUED_VISUAL = [
  '## Step 1 — Intro',
  '',
  '**Narrator:** Meet Ana.',
  '[place: ana-smiling]',
  '![Ana smiling](asset:ana-smiling)',
  '> Brief: Warm portrait.',
  'Ana waves hello.',
  '',
].join('\n')

const BLANK_SEPARATED = [
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

const REUSE_GLUED = [
  '## Step 1 — Room',
  '',
  '![Empty classroom chairs](asset:empty-classroom-chairs)',
  '<!-- reuse: Classroom Chairs -->',
  'Estamos en clase.',
  '',
].join('\n')

const FENCED_DOC = ['```markdown', ...BLANK_SEPARATED.trimEnd().split('\n'), '```'].join('\n')

const CODE_WITH_BLANKS = [
  '## Step 1 — Code',
  '',
  '```glsl',
  'void main() {',
  '',
  '  gl_FragColor = vec4(1.0);',
  '}',
  '```',
  '',
  'After the code.',
  '',
].join('\n')

const LOOSE_LIST = ['## Step 1 — Words', '', '- ser', '', '- estar', '', 'Done.', ''].join('\n')

const TIGHT_LIST = ['## Step 1 — Words', '', '- ser', '- estar', '', 'Done.', ''].join('\n')

describe('splitScenarioDocBlocks', () => {
  it('agrees with the rendered top-level block count on every fixture', () => {
    const fixtures: Array<[string, string]> = [
      ['blank separated', BLANK_SEPARATED],
      ['glued board lines', GLUED_BOARD_LINES],
      ['glued visual block', GLUED_VISUAL],
      ['glued reuse comment', REUSE_GLUED],
      ['whole-doc fence', FENCED_DOC],
      ['fenced code with inner blanks', CODE_WITH_BLANKS],
      ['loose list', LOOSE_LIST],
      ['tight list', TIGHT_LIST],
      ['empty doc', ''],
    ]
    for (const [name, content] of fixtures) {
      const expected = renderedBlockCount(content)
      expect(splitScenarioDocBlocks(content).length, `fixture: ${name}`).toBe(expected)
    }
  })

  it('splits glued board lines into one block per rendered block', () => {
    expect(splitScenarioDocBlocks(GLUED_BOARD_LINES)).toEqual([
      '**Narrator:** You will learn ser and estar.',
      '[reveal: text1]',
      'Ser and Estar',
      '[wipe]',
    ])
  })

  it('returns original source text per block so markdown syntax survives an edit round-trip', () => {
    const blocks = splitScenarioDocBlocks(GLUED_VISUAL)
    expect(blocks).toContain('![Ana smiling](asset:ana-smiling)')
    expect(blocks).toContain('> Brief: Warm portrait.')
    expect(blocks).toContain('[place: ana-smiling]')
    expect(blocks).toContain('## Step 1 — Intro')
    // The reuse comment stays a comment (the doc parser only reads `<!-- reuse: -->`).
    // Glued to the next line it shares one rendered block with it (CommonMark
    // lazy continuation) — the split mirrors the DOM either way.
    expect(splitScenarioDocBlocks(REUSE_GLUED)).toContain(
      '<!-- reuse: Classroom Chairs -->\nEstamos en clase.',
    )
    const separated = splitScenarioDocBlocks(
      [
        '![Empty classroom chairs](asset:empty-classroom-chairs)',
        '',
        '<!-- reuse: Classroom Chairs -->',
        '',
        'Estamos en clase.',
        '',
      ].join('\n'),
    )
    expect(separated).toContain('<!-- reuse: Classroom Chairs -->')
  })

  it('unwraps a whole-doc markdown fence instead of keeping it as a code block', () => {
    const blocks = splitScenarioDocBlocks(FENCED_DOC)
    expect(blocks[0]).toBe('# Lesson')
    expect(blocks.some((block) => block.startsWith('```'))).toBe(false)
  })

  it('keeps fenced code with inner blank lines as a single block', () => {
    const blocks = splitScenarioDocBlocks(CODE_WITH_BLANKS)
    expect(blocks).toHaveLength(3)
    expect(blocks[1]).toContain('void main()')
  })

  it('round-trips a blank-separated doc through join', () => {
    const blocks = splitScenarioDocBlocks(BLANK_SEPARATED)
    expect(blocks.join('\n\n')).toBe(BLANK_SEPARATED.trimEnd())
  })

  it('deleting the middle block removes exactly that source chunk', () => {
    const blocks = splitScenarioDocBlocks(GLUED_BOARD_LINES)
    blocks.splice(1, 1)
    expect(blocks.join('\n\n')).toBe(
      ['**Narrator:** You will learn ser and estar.', 'Ser and Estar', '[wipe]'].join('\n\n'),
    )
  })
})
