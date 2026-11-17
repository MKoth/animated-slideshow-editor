import { describe, expect, it } from 'vitest'
import { getScenarioBlockDeletionRange, splitScenarioDocBlocks } from '../../engine/scenarioBlocks'

const DOC = [
  '# Lesson',
  '',
  '## Step 1 — One',
  '',
  '**Narrator:** First voice.',
  '',
  '![Oak tree](asset:oak-tree)',
  '',
  '> Brief: A sturdy oak.',
  '',
  '[place: oak-tree]',
  '',
  'Reader text.',
  '',
  '## Step 2 — Two',
  '',
  '**Narrator:** Second voice.',
  '',
  '![Melting ice](asset:melting-ice)',
  '',
  '> Brief: Melting.',
  '',
].join('\n')

describe('getScenarioBlockDeletionRange', () => {
  it('deletes a whole step when its heading is removed', () => {
    const blocks = splitScenarioDocBlocks(DOC)
    const headingIndex = blocks.findIndex((b) => b.trim().startsWith('## Step 1'))
    expect(headingIndex).toBeGreaterThanOrEqual(0)
    const range = getScenarioBlockDeletionRange(blocks, headingIndex)
    const remaining = blocks.filter((_, i) => i < range.start || i > range.end)
    const joined = remaining.join('\n\n')
    expect(joined).not.toContain('First voice')
    expect(joined).not.toContain('oak-tree')
    expect(joined).toContain('## Step 2')
    expect(joined).toContain('Second voice')
  })

  it('deletes a visual together with its brief and matching place', () => {
    const blocks = splitScenarioDocBlocks(DOC)
    const visualIndex = blocks.findIndex((b) => b.includes('![Oak tree]'))
    expect(visualIndex).toBeGreaterThanOrEqual(0)
    const range = getScenarioBlockDeletionRange(blocks, visualIndex)
    const remaining = blocks.filter((_, i) => i < range.start || i > range.end)
    const joined = remaining.join('\n\n')
    expect(joined).not.toContain('oak-tree')
    expect(joined).not.toContain('A sturdy oak')
    expect(joined).not.toContain('[place: oak-tree]')
    // Unrelated body text of the same step survives.
    expect(joined).toContain('First voice')
    expect(joined).toContain('Reader text.')
  })

  it('deletes exactly one block for narrator and board actions', () => {
    const blocks = splitScenarioDocBlocks(DOC)
    const narratorIndex = blocks.findIndex((b) => b.includes('First voice'))
    expect(getScenarioBlockDeletionRange(blocks, narratorIndex)).toEqual({
      start: narratorIndex,
      end: narratorIndex,
    })
  })
})
