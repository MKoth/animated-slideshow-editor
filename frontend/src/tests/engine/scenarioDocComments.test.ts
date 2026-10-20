import { describe, expect, it } from 'vitest'
import { buildScenarioCommentsMessage } from '../../engine/scenarioDocComments'

describe('buildScenarioCommentsMessage', () => {
  it('builds an edit:-prefixed message with step, quote, and comment', () => {
    const message = buildScenarioCommentsMessage([
      {
        id: 'c-1',
        step: 1,
        stepTitle: 'Who you are',
        blockKind: 'narrator',
        quote: 'Ser is for who you are.',
        comment: 'Make it warmer.',
        blockIndex: 1,
      },
    ])
    expect(message.startsWith('edit:')).toBe(true)
    expect(message).toContain('Step 1 — Who you are')
    expect(message).toContain('narrator')
    expect(message).toContain('Ser is for who you are.')
    expect(message).toContain('Make it warmer.')
  })

  it('falls back to General and spells out table cells', () => {
    const message = buildScenarioCommentsMessage([
      {
        id: 'c-1',
        blockKind: 'paragraph',
        quote: 'plain words',
        comment: 'Fix this.',
        blockIndex: 0,
      },
      {
        id: 'c-2',
        step: 2,
        blockKind: 'table cell',
        quote: 'silla',
        comment: 'Wrong word.',
        blockIndex: 3,
        cell: { row: 2, col: 1, cellText: 'silla' },
      },
    ])
    expect(message).toContain('General · paragraph')
    expect(message).toContain('Step 2 · table cell (row 2, column 1)')
  })
})
