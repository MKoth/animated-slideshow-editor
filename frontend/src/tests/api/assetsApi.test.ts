import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { AssetsApi } from '../../api/assetsApi'

describe('AssetsApi', () => {
  const api = new AssetsApi(new ApiClient())

  function expectQuery(url: unknown, expected: Record<string, string>): void {
    expect(String(url).startsWith('/api/assets?')).toBe(true)
    const params = new URLSearchParams(String(url).split('?')[1])
    expect(Object.fromEntries(params)).toEqual(expected)
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists assets with search, sort, and order query parameters', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'a1' }]), { status: 200 }),
    )

    await api.listAssets({ search: 'boy', sort: 'name', order: 'asc' })

    expectQuery(vi.mocked(fetch).mock.calls[0][0], {
      search: 'boy',
      sort: 'name',
      order: 'asc',
    })
  })

  it('lists assets with the default sort and order when not provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'a1' }]), { status: 200 }),
    )

    await api.listAssets({})

    expectQuery(vi.mocked(fetch).mock.calls[0][0], { sort: 'import_date', order: 'desc' })
  })

  it('returns the parsed definitions from the list response', async () => {
    const definition = { id: 'a1', name: 'Boy' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([definition]), { status: 200 }))

    const result = await api.listAssets({})

    expect(result).toEqual([definition])
  })

  it('uploads files as multipart form data', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ created: [], errors: [] }), { status: 200 }),
    )
    const file = new File(['image-bytes'], 'boy.png', { type: 'image/png' })

    await api.uploadAssets([file])

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/assets')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    const entries = Array.from((init?.body as FormData).getAll('files'))
    expect(entries).toHaveLength(1)
    expect((entries[0] as File).name).toBe('boy.png')
  })

  it('returns created definitions and per-file errors from an upload', async () => {
    const created = { id: 'a1', name: 'Boy' }
    const uploadError = { filename: 'broken.png', error: 'corrupt or unreadable image file' }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ created: [created], errors: [uploadError] }), {
        status: 200,
      }),
    )

    const result = await api.uploadAssets([new File(['x'], 'boy.png')])

    expect(result.created).toEqual([created])
    expect(result.errors).toEqual([uploadError])
  })

  it('deletes an asset with a DELETE request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))

    await api.deleteAsset('a1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/assets/a1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
