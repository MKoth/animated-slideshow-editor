import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  emptyAskDraft,
  extractAskBlocks,
  formatAskAnswer,
  formatAskAnswers,
  hasAskBlocks,
  isAskAnswerEmpty,
  isAskDraftEmpty,
  type AskBlock,
} from '../ai/askBlock'
import { AiAskGroup } from '../components/ai/AiAskBlock'

const SINGLE_MESSAGE = [
  '## Open questions',
  '',
  '```ask',
  'id: landing-xy',
  'question: Mid-sofa landing XY for the Cat root?',
  'kind: single',
  'options:',
  '- id: use-sofa-center',
  '  label: Sofa center from live context',
  '  detail: world XY + shape-bounds offset',
  '- id: keep-current',
  '  label: Keep current Cat XY',
  'allowCustom: true',
  '```',
].join('\n')

describe('extractAskBlocks', () => {
  it('extracts a single-choice block with options and custom flag', () => {
    const blocks = extractAskBlocks(SINGLE_MESSAGE)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      id: 'landing-xy',
      question: 'Mid-sofa landing XY for the Cat root?',
      kind: 'single',
      allowCustom: true,
    })
    expect(blocks[0]?.options).toHaveLength(2)
    expect(blocks[0]?.options[0]).toMatchObject({
      id: 'use-sofa-center',
      label: 'Sofa center from live context',
      detail: 'world XY + shape-bounds offset',
    })
    expect(blocks[0]?.options[1]).toMatchObject({
      id: 'keep-current',
      label: 'Keep current Cat XY',
      detail: null,
    })
    expect(hasAskBlocks(SINGLE_MESSAGE)).toBe(true)
  })

  it('extracts multi and text kinds plus several blocks in order', () => {
    const content = [
      '```ask',
      'id: layers',
      'question: Which layers?',
      'kind: multi',
      'options:',
      '- id: a',
      '  label: Aye',
      '- id: b',
      '  label: Bee',
      '```',
      '',
      '```ask',
      'id: notes',
      'question: Anything else?',
      'kind: text',
      'allowCustom: true',
      '```',
    ].join('\n')
    const blocks = extractAskBlocks(content)
    expect(blocks.map((b) => b.id)).toEqual(['layers', 'notes'])
    expect(blocks[0]?.kind).toBe('multi')
    expect(blocks[1]?.kind).toBe('text')
    expect(blocks[1]?.options).toHaveLength(0)
  })

  it('ignores malformed blocks but keeps the well-formed ones', () => {
    expect(extractAskBlocks('## Open questions\n- yawn in or silent?')).toEqual([])
    expect(extractAskBlocks('```typescript\nconst x = 1\n```')).toEqual([])
    // Missing question.
    expect(extractAskBlocks('```ask\nid: nope\nkind: single\n```')).toEqual([])
    // Missing id.
    expect(extractAskBlocks('```ask\nquestion: What?\nkind: text\n```')).toEqual([])
    // Single without options.
    expect(extractAskBlocks('```ask\nid: x\nquestion: What?\nkind: single\n```')).toEqual([])
    // Unknown kind.
    expect(extractAskBlocks('```ask\nid: x\nquestion: What?\nkind: ranked\n```')).toEqual([])
    expect(hasAskBlocks('just prose')).toBe(false)
    // One bad block does not sink a good one.
    const mixed = ['```ask', 'id: bad', 'kind: single', '```', '', SINGLE_MESSAGE].join('\n')
    expect(extractAskBlocks(mixed).map((b) => b.id)).toEqual(['landing-xy'])
  })
})

describe('formatAskAnswer', () => {
  const block: AskBlock = {
    id: 'landing-xy',
    question: 'Q?',
    kind: 'single',
    options: [
      { id: 'use-sofa-center', label: 'Sofa center from live context', detail: null },
      { id: 'keep-current', label: 'Keep current Cat XY', detail: null },
    ],
    allowCustom: true,
  }

  it('formats selections by label', () => {
    expect(formatAskAnswer(block, ['keep-current'], '')).toBe('Q (landing-xy): Keep current Cat XY')
  })

  it('appends custom text with the custom prefix', () => {
    expect(formatAskAnswer(block, ['keep-current'], 'nudge left')).toBe(
      'Q (landing-xy): Keep current Cat XY + custom: nudge left',
    )
    expect(formatAskAnswer(block, [], 'from scratch')).toBe('Q (landing-xy): custom: from scratch')
  })

  it('carries raw text for text-kind answers', () => {
    const text: AskBlock = { ...block, kind: 'text', options: [] }
    expect(formatAskAnswer(text, [], 'three seconds')).toBe('Q (landing-xy): three seconds')
  })

  it('detects empty answers', () => {
    expect(isAskAnswerEmpty([], '')).toBe(true)
    expect(isAskAnswerEmpty([], '  ')).toBe(true)
    expect(isAskAnswerEmpty(['a'], '')).toBe(false)
    expect(isAskAnswerEmpty([], 'x')).toBe(false)
  })

  it('joins per-question drafts into one newline message', () => {
    const second: AskBlock = { ...block, id: 'timing', kind: 'text', options: [] }
    expect(
      formatAskAnswers(
        [block, second],
        [
          { ...emptyAskDraft(), selected: ['keep-current'] },
          { ...emptyAskDraft(), freeText: 'three seconds' },
        ],
      ),
    ).toBe('Q (landing-xy): Keep current Cat XY\nQ (timing): three seconds')
  })

  it('detects empty drafts per kind', () => {
    const text: AskBlock = { ...block, kind: 'text', options: [] }
    expect(isAskDraftEmpty(block, emptyAskDraft())).toBe(true)
    expect(isAskDraftEmpty(text, emptyAskDraft())).toBe(true)
    expect(isAskDraftEmpty(text, { ...emptyAskDraft(), freeText: 'hi' })).toBe(false)
    expect(
      isAskDraftEmpty(block, { ...emptyAskDraft(), customSelected: true, customText: '  ' }),
    ).toBe(true)
  })
})

describe('AiAskGroup', () => {
  const block: AskBlock = {
    id: 'landing-xy',
    question: 'Mid-sofa landing XY for the Cat root?',
    kind: 'single',
    options: [
      { id: 'use-sofa-center', label: 'Sofa center from live context', detail: null },
      { id: 'keep-current', label: 'Keep current Cat XY', detail: null },
    ],
    allowCustom: true,
  }
  const base = 'ai-ask-m-1-landing-xy'
  const groupAnswer = 'ai-ask-m-1-answer'

  it('disables Answer until a choice is made, then appends the exact message', async () => {
    const onAnswer = vi.fn()
    render(<AiAskGroup blocks={[block]} messageId="m-1" onAnswer={onAnswer} />)
    const answer = screen.getByTestId(groupAnswer)
    expect(answer).toBeDisabled()
    expect(onAnswer).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId(`${base}-option-keep-current`))
    expect(answer).not.toBeDisabled()
    await userEvent.click(answer)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith('Q (landing-xy): Keep current Cat XY')
  })

  it('sends custom text alongside or instead of a selection', async () => {
    const onAnswer = vi.fn()
    render(<AiAskGroup blocks={[block]} messageId="m-1" onAnswer={onAnswer} />)
    await userEvent.click(screen.getByTestId(`${base}-option-custom`))
    // Custom selected but empty is still a no-op.
    expect(screen.getByTestId(groupAnswer)).toBeDisabled()
    await userEvent.type(screen.getByTestId(`${base}-custom`), 'nudge left')
    await userEvent.click(screen.getByTestId(groupAnswer))
    expect(onAnswer).toHaveBeenCalledWith('Q (landing-xy): custom: nudge left')
  })

  it('supports multi-select answers joined by label', async () => {
    const onAnswer = vi.fn()
    const multi: AskBlock = { ...block, kind: 'multi' }
    render(<AiAskGroup blocks={[multi]} messageId="m-1" onAnswer={onAnswer} />)
    expect(screen.getByTestId(groupAnswer)).toBeDisabled()
    await userEvent.click(screen.getByTestId(`${base}-option-use-sofa-center`))
    await userEvent.click(screen.getByTestId(`${base}-option-keep-current`))
    await userEvent.type(screen.getByTestId(`${base}-custom`), 'nudge left')
    await userEvent.click(screen.getByTestId(groupAnswer))
    expect(onAnswer).toHaveBeenCalledWith(
      'Q (landing-xy): Sofa center from live context, Keep current Cat XY + custom: nudge left',
    )
  })

  it('renders text-kind answers from the textarea', async () => {
    const onAnswer = vi.fn()
    const text: AskBlock = { ...block, kind: 'text', options: [] }
    render(<AiAskGroup blocks={[text]} messageId="m-1" onAnswer={onAnswer} />)
    expect(screen.getByTestId(groupAnswer)).toBeDisabled()
    await userEvent.type(screen.getByTestId(`${base}-text`), 'three seconds')
    await userEvent.click(screen.getByTestId(groupAnswer))
    expect(onAnswer).toHaveBeenCalledWith('Q (landing-xy): three seconds')
  })

  it('forces every question answered before the shared send', async () => {
    const onAnswer = vi.fn()
    const timing: AskBlock = {
      id: 'timing',
      question: 'Hold how long?',
      kind: 'text',
      options: [],
      allowCustom: false,
    }
    render(<AiAskGroup blocks={[block, timing]} messageId="m-1" onAnswer={onAnswer} />)
    const answer = screen.getByTestId(groupAnswer)
    expect(answer).toBeDisabled()
    expect(answer).toHaveTextContent('Answer all (2)')

    // Answering only the first question keeps the shared button inactive.
    await userEvent.click(screen.getByTestId(`${base}-option-keep-current`))
    expect(answer).toBeDisabled()
    expect(onAnswer).not.toHaveBeenCalled()

    await userEvent.type(screen.getByTestId('ai-ask-m-1-timing-text'), 'three seconds')
    expect(answer).not.toBeDisabled()
    await userEvent.click(answer)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith(
      'Q (landing-xy): Keep current Cat XY\nQ (timing): three seconds',
    )
  })
})
