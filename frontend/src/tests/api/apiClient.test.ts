import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from '../../api/apiClient'

describe('ApiClient', () => {
  const client = new ApiClient()

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws an ApiError carrying the backend detail from a JSON error body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ detail: 'parameter uRepeatCount: int default must be an integer' }),
        {
          status: 422,
        },
      ),
    )

    const error = await client.get('/api/shaders').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
    expect((error as ApiError).detail).toBe(
      'parameter uRepeatCount: int default must be an integer',
    )
  })

  it('keeps the generic message when the error body carries no detail', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 500 }))

    const error = await client.get('/api/shaders').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).detail).toBeNull()
  })

  it('preserves structured validation errors and includes them in the message', async () => {
    const validation = [
      { loc: ['body', 'slides', 0, 'duration'], msg: 'field required', type: 'missing' },
    ]
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: validation }), { status: 422 }),
    )

    const error = await client.post('/api/export/jobs', '{}').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).detail).toContain('field required')
    expect((error as Error).message).toContain('field required')
  })

  it('surfaces structured object detail with log id from AI endpoints', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: 'provider_error',
            message: 'model did not return usable commands',
            logId: 'draft-abc123',
          },
        }),
        {
          status: 502,
        },
      ),
    )

    const error = await client.get('/api/ai/proposals/draft').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).detail).toBe(
      'provider_error: model did not return usable commands (log draft-abc123)',
    )
  })
})
