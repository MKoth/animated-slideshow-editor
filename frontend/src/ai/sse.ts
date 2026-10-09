export type SseEventType = 'start' | 'token' | 'done' | 'error'

export interface SseEvent {
  type: SseEventType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

/** Tolerant SSE parser: non-standard chunks never break the stream. */
export function parseSseText(text: string): SseEvent[] {
  const events: SseEvent[] = []
  for (const chunk of text.split('\n\n')) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    let type: SseEventType | null = null
    let rawData: string | null = null
    for (const line of trimmed.split('\n')) {
      const clean = line.trim()
      if (clean.startsWith('event:')) {
        const name = clean.slice('event:'.length).trim()
        if (name === 'start' || name === 'token' || name === 'done' || name === 'error') {
          type = name
        }
      } else if (clean.startsWith('data:')) {
        rawData = clean.slice('data:'.length).trim()
      }
    }
    if (!type || rawData === null) continue
    try {
      events.push({ type, data: JSON.parse(rawData) })
    } catch {
      // Non-JSON data chunks are ignored per tolerant-client rule.
      continue
    }
  }
  return events
}

export interface StreamHandlers {
  onStart?: (messageId: string) => void
  onToken?: (delta: string) => void
  onDone?: (content: string) => void
  onError?: (code: string, message: string) => void
}

/** Stream POST /api/ai/chat SSE events, tolerating non-standard chunks. */
export async function streamAiChat(
  input: {
    conversationId: string
    message?: string
    mode: 'send' | 'regenerate'
    context: unknown
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok || !response.body) {
    let detail: string | null = null
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = typeof body.detail === 'string' ? body.detail : null
    } catch {
      detail = null
    }
    handlers.onError?.('provider_error', detail ?? `Request failed with status ${response.status}`)
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const event of parseSseText(`${part}\n\n`)) {
          dispatchSseEvent(event, handlers)
        }
      }
      if (signal?.aborted) break
    }
    buffer += decoder.decode()
    for (const event of parseSseText(buffer)) {
      dispatchSseEvent(event, handlers)
    }
  } finally {
    reader.releaseLock()
  }
}

function dispatchSseEvent(event: SseEvent, handlers: StreamHandlers): void {
  if (event.type === 'start') {
    const id = typeof event.data?.messageId === 'string' ? event.data.messageId : ''
    handlers.onStart?.(id)
  } else if (event.type === 'token') {
    const delta = typeof event.data?.delta === 'string' ? event.data.delta : ''
    if (delta) handlers.onToken?.(delta)
  } else if (event.type === 'done') {
    const content = typeof event.data?.content === 'string' ? event.data.content : ''
    handlers.onDone?.(content)
  } else {
    const code = typeof event.data?.code === 'string' ? event.data.code : 'provider_error'
    const message =
      typeof event.data?.message === 'string' ? event.data.message : 'Provider error — retry.'
    handlers.onError?.(code, message)
  }
}
