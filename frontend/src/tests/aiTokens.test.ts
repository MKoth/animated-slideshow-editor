import { describe, expect, it } from 'vitest'
import { formatTokenCount, sumConversationUsage } from '../ai/tokens'

describe('sumConversationUsage', () => {
  it('sums real provider usage and counts untracked messages', () => {
    const usage = sumConversationUsage([
      {
        id: 'm-1',
        role: 'user',
        content: 'hi',
        stopped: false,
        errorCode: null,
        created: new Date().toISOString(),
      },
      {
        id: 'm-2',
        role: 'assistant',
        content: 'hello',
        stopped: false,
        errorCode: null,
        promptTokens: 11,
        completionTokens: 22,
        totalTokens: 33,
        created: new Date().toISOString(),
      },
    ])
    expect(usage.totalTokens).toBe(33)
    expect(usage.promptTokens).toBe(11)
    expect(usage.completionTokens).toBe(22)
    expect(usage.trackedMessages).toBe(1)
    expect(usage.untrackedMessages).toBe(1)
  })

  it('falls back to prompt + completion when total is missing', () => {
    const usage = sumConversationUsage([
      {
        id: 'm-1',
        role: 'assistant',
        content: 'hi',
        stopped: false,
        errorCode: null,
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: null,
        created: new Date().toISOString(),
      },
    ])
    expect(usage.totalTokens).toBe(12)
  })

  it('formats counts with grouping', () => {
    expect(formatTokenCount(1234567)).toBe('1,234,567')
  })
})
