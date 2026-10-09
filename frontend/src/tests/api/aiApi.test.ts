import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { AiApi } from '../../api/aiApi'

describe('AiApi', () => {
  const api = new AiApi(new ApiClient())

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads settings with masked key only', async () => {
    const settings = {
      endpoint: 'https://opencode.ai/zen/v1',
      model: 'anthropic/claude-sonnet-4-5',
      temperature: 0.7,
      maxTokens: 2000,
      streaming: true,
      systemPrompt: 'sys',
      keyMasked: '••••••••1234',
      hasKey: true,
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(settings), { status: 200 }))

    const result = await api.getSettings()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/settings')
    expect(result.keyMasked).toBe('••••••••1234')
    expect(result).not.toHaveProperty('apiKey')
  })

  it('saves settings with empty key to keep existing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ hasKey: true, keyMasked: '••••••••9999' }), { status: 200 }),
    )

    await api.updateSettings({ temperature: 0.5, apiKey: '' })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.method).toBe('PUT')
    expect(init?.body).toContain('"apiKey":""')
  })

  it('lists models with fallback flag', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          models: ['anthropic/claude-sonnet-4-5'],
          selected: 'anthropic/claude-sonnet-4-5',
          fallback: true,
        }),
        { status: 200 },
      ),
    )

    const result = await api.listModels()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/models')
    expect(result.fallback).toBe(true)
    expect(result.models).toHaveLength(1)
  })

  it('creates conversations with project scope', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'c-1', projectId: 'p-1', title: 'Conversation 1' }), {
        status: 201,
      }),
    )

    const result = await api.createConversation('p-1')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/ai/conversations')
    expect(init?.method).toBe('POST')
    expect(init?.body).toContain('p-1')
    expect(result.title).toBe('Conversation 1')
  })

  it('renames and deletes conversations', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'c-1', title: 'Intro ideas' }), { status: 200 }),
    )
    await api.renameConversation('c-1', 'Intro ideas')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/conversations/c-1')

    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await api.deleteConversation('c-1')
    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(url).toBe('/api/ai/conversations/c-1')
    expect(init?.method).toBe('DELETE')
  })
})
