import { describe, expect, it } from 'vitest'
import {
  buildRestoreSummary,
  classifyScenarioIntent,
  diffScenarioLines,
  extractEditContent,
  parseAssistantReply,
  parseSummary,
  parseTouchedSteps,
  touchedStepsFromMarkdown,
} from '../../engine/scenarioVersions'

describe('scenarioVersions pure seam', () => {
  it('prefixes override the self-label', () => {
    expect(classifyScenarioIntent('ask: x', 'intent: edit\n## Step 1')).toBe('question-only')
    expect(classifyScenarioIntent('edit: x', 'intent: question')).toBe('edit')
    expect(classifyScenarioIntent('hi', 'intent: edit\n## Step 1')).toBe('edit')
    expect(classifyScenarioIntent('hi', 'intent: question-only\nq')).toBe('question-only')
  })

  it('infers edit from Step headings when unlabelled', () => {
    expect(classifyScenarioIntent('hi', '## Step 1 — Hi')).toBe('edit')
    expect(classifyScenarioIntent('hi', 'what do you think?')).toBe('question-only')
  })

  it('parses summary and touched steps with fallbacks', () => {
    expect(parseSummary('Summary: Add intro\nbody')).toBe('Add intro')
    expect(parseTouchedSteps('Touched-steps: 1, 2-3')).toEqual([1, 2, 3])
    expect(touchedStepsFromMarkdown('## Step 2 — B\n\n## Step 1 — A')).toEqual([2, 1])
  })

  it('mixed replies apply the edit part and keep the question', () => {
    const parsed = parseAssistantReply(
      'go',
      'intent: edit\nSummary: Add intro\nTouched-steps: 1\n\n## Step 1 — Hi\n\nHello\n\nQuestion: Should step 2 mention cats?',
    )
    expect(parsed.intent).toBe('edit')
    expect(parsed.summary).toBe('Add intro')
    expect(parsed.touchedSteps).toEqual([1])
    expect(parsed.editContent).toContain('## Step 1')
    expect(parsed.editContent).not.toContain('Should step 2')
    expect(parsed.questionText).toContain('Should step 2')
  })

  it('pure questions create no edit content', () => {
    const parsed = parseAssistantReply('ask: ideas?', 'intent: question-only\nWhat if cats?')
    expect(parsed.intent).toBe('question-only')
    expect(parsed.editContent).toBe('')
    expect(parsed.summary).toBeNull()
  })

  it('strips metadata from edit content', () => {
    const content = extractEditContent(
      'intent: edit\nSummary: S\nTouched-steps: 1\n\n## Step 1 — Hi\n\nBody',
    )
    expect(content).toBe('## Step 1 — Hi\n\nBody')
  })

  it('diffs line-or-block with same/add/del', () => {
    expect(diffScenarioLines('x', 'x')).toEqual([
      { type: 'same', line: 'x', oldLineNo: 1, newLineNo: 1 },
    ])
    const diff = diffScenarioLines('a\nb\nc', 'a\nB\nc')
    expect(diff.map((d) => d.type)).toEqual(['same', 'del', 'add', 'same'])
  })

  it('builds restore summaries', () => {
    expect(buildRestoreSummary('First', 'abcdef123456')).toBe('Restore abcdef12: First')
  })
})
