import type { AiMessage } from '../api/aiApi'

export interface ConversationUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  trackedMessages: number
  untrackedMessages: number
}

function toNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Real provider token usage summed over one conversation's messages.
 * Messages without reported usage count as untracked — never estimated,
 * so the counter stays honest about what the provider actually reported.
 */
export function sumConversationUsage(messages: readonly AiMessage[]): ConversationUsage {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let trackedMessages = 0
  let untrackedMessages = 0
  for (const message of messages) {
    const prompt = toNonNegative(message.promptTokens)
    const completion = toNonNegative(message.completionTokens)
    const total = toNonNegative(message.totalTokens)
    if (prompt === null && completion === null && total === null) {
      untrackedMessages += 1
      continue
    }
    trackedMessages += 1
    promptTokens += prompt ?? 0
    completionTokens += completion ?? 0
    totalTokens += total ?? (prompt ?? 0) + (completion ?? 0)
  }
  return { promptTokens, completionTokens, totalTokens, trackedMessages, untrackedMessages }
}

export function formatTokenCount(value: number): string {
  return value.toLocaleString('en-US')
}
