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
})
