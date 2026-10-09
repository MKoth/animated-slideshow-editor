import { describe, expect, it } from 'vitest'
import { parseSseText } from '../ai/sse'

describe('AI SSE tolerant client', () => {
  it('parses start/token/done events', () => {
    const text =
      'event: start\ndata: {"conversationId":"c-1","messageId":"m-1"}\n\n' +
      'event: token\ndata: {"delta":"Hello"}\n\n' +
      'event: done\ndata: {"messageId":"m-1","content":"Hello"}\n\n'

    const events = parseSseText(text)

    expect(events.map((e) => e.type)).toEqual(['start', 'token', 'done'])
    expect(events[1].data.delta).toBe('Hello')
  })

  it('ignores non-standard chunks without breaking the stream', () => {
    const text =
      'event: message\ndata: not-json\n\n' +
      'event: token\ndata: {"delta":"Hi"}\n\n' +
      ': keep-alive\n\n' +
      'event: error\ndata: {"code":"rate_limited","message":"Rate-limited"}\n\n'

    const events = parseSseText(text)

    expect(events.map((e) => e.type)).toEqual(['token', 'error'])
    expect(events[1].data.code).toBe('rate_limited')
  })

  it('returns empty for garbage input', () => {
    expect(parseSseText('garbage without events')).toEqual([])
    expect(parseSseText('')).toEqual([])
  })
})
